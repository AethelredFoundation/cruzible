/**
 * IndexerService
 *
 * Production-grade live blockchain indexer for the Aethelred EVM chain.
 *
 * Responsibilities:
 *  - Subscribe to new blocks via WebSocket (ethers.js WebSocketProvider)
 *  - Fall back to polling when the WebSocket connection drops
 *  - Index all Cruzible vault contract events:
 *      Staked, Unstaked, Withdrawn, RewardsClaimed
 *  - Index StAETHEL (ERC-20) Transfer events for balance tracking
 *  - Store blocks, transactions, and domain events in PostgreSQL (Prisma)
 *  - Detect and handle chain reorgs by comparing parent hashes
 *  - Backfill historical blocks on demand or at startup
 *  - Retry with exponential backoff on transient RPC failures
 *  - Idempotent writes — reprocessing a block never creates duplicates
 *  - Expose indexing-lag metrics for health-check / observability
 *  - Graceful shutdown with in-flight work completion
 */

import { singleton } from "tsyringe";
import { Prisma, PrismaClient } from "@prisma/client";
import {
  WebSocketProvider,
  JsonRpcProvider,
  TransactionReceipt,
  TransactionResponse,
  Log,
  Interface,
  Contract,
} from "ethers";
import { logger } from "../utils/logger";
import { BlockchainService } from "./BlockchainService";
import { config } from "../config";
import { errorContext } from "../utils/errorContext";
import { redactUrlForLogs } from "../utils/urlRedaction";
import {
  buildIndexerNetworkKeys,
  LEGACY_INDEXER_CURSOR_KEY,
  type IndexerNetworkKeys,
} from "../lib/indexerNetworkIdentity";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** How often we poll for new blocks when WebSocket is unavailable (ms). */
const POLL_INTERVAL_MS = 2_000;

/** Minimum delay between polls when caught up (ms). */
const IDLE_POLL_INTERVAL_MS = 5_000;

/** Maximum number of blocks to process in a single tick. */
const MAX_BLOCKS_PER_TICK = 100;

/** Maximum retry attempts before giving up on a single RPC call. */
const MAX_RETRIES = 10;

/** Base delay for exponential backoff (ms). */
const BASE_RETRY_DELAY_MS = 500;

/** Cap for backoff delay (ms). */
const MAX_RETRY_DELAY_MS = 30_000;

/** How many blocks of confirmations before considering finalized. */
const CONFIRMATION_DEPTH = 2;

/** Maximum reorg depth we will handle before halting. */
const MAX_REORG_DEPTH = 64;

/** Cursor key used in the IndexerCursor table. */
const CURSOR_KEY = LEGACY_INDEXER_CURSOR_KEY;

/** WebSocket reconnect delay (ms). */
const WS_RECONNECT_DELAY_MS = 3_000;

/** Maximum WebSocket reconnect attempts before falling back to polling. */
const WS_MAX_RECONNECT_ATTEMPTS = 20;

/**
 * Upper bound on waiting for the WebSocket provider to become ready.
 * connectWebSocket() is awaited on the server-boot path, and ethers v6's
 * getNetwork() never settles against a dead endpoint — without this bound a
 * misconfigured WS URL would keep the API from ever listening.
 */
const WS_READY_TIMEOUT_MS = 15_000;

/** Public Aethelred EVM deployments use block 1 as the immutable anchor. */
const NETWORK_ANCHOR_BLOCK = 1;

/** Fixed primary key for the singleton VaultState row. */
const VAULT_STATE_ID = "cruzible-vault-state";

/** Default unbonding period (days) — matches the Cosmos SDK default. */

/**
 * Cruzible Vault view functions used to materialize VaultState.
 * These must match the canonical ICruzible.sol interface.
 */
// Getter names must match the DEPLOYED backend/contracts-evm/src/Cruzible.sol:
// totalPooledAethel/currentEpoch/unbondingPeriod are public variables,
// totalShares/getExchangeRate are explicit views. There is no validator-count
// getter on the vault (validator selection lives off-vault on this line).
const VAULT_VIEW_ABI = [
  "function totalPooledAethel() view returns (uint256)",
  "function totalShares() view returns (uint256)",
  "function getExchangeRate() view returns (uint256)",
  "function currentEpoch() view returns (uint256)",
  "function unbondingPeriod() view returns (uint256)",
  "function effectiveAPY() view returns (uint256)",
];

/**
 * InstitutionalStablecoinBridge view functions used to materialize
 * StablecoinConfig after a StablecoinConfigured event.
 *
 * Must match the real contract at contracts/InstitutionalStablecoinBridge.sol:
 *
 * The `stablecoins(bytes32)` auto-generated getter returns the StablecoinConfig struct:
 *   (bool enabled, bool mintPaused, uint8 routingType, address token,
 *    address tokenMessengerV2, address messageTransmitterV2,
 *    address proofOfReserveFeed,
 *    uint256 mintCeilingPerEpoch, uint256 dailyTxLimit,
 *    uint16 hourlyOutflowBps, uint16 dailyOutflowBps,
 *    uint16 porDeviationBps, uint48 porHeartbeatSeconds)
 *
 * The `epochUsage(bytes32)` auto-generated getter returns:
 *   (uint64 epochId, uint256 mintedAmount, uint256 txVolume)
 *
 * Note: symbol, name, decimals, cctpDomain are NOT on-chain —
 * they are resolved from the frontend STABLECOIN_ASSETS registry.
 */
const BRIDGE_VIEW_ABI = [
  "function stablecoins(bytes32 assetId) view returns (bool enabled, bool mintPaused, uint8 routingType, address token, address tokenMessengerV2, address messageTransmitterV2, address proofOfReserveFeed, uint256 mintCeilingPerEpoch, uint256 dailyTxLimit, uint16 hourlyOutflowBps, uint16 dailyOutflowBps, uint16 porDeviationBps, uint48 porHeartbeatSeconds)",
  "function epochUsage(bytes32 assetId) view returns (uint64 epochId, uint256 mintedAmount, uint256 txVolume)",
];

/** 1e18 as a bigint constant for fixed-point arithmetic. */
const FIXED_POINT_SCALE = 10n ** 18n;

/** Largest Unix-second value representable by JavaScript Date. */
const MAX_DATE_UNIX_SECONDS = 8_640_000_000_000n;

/**
 * Convert a 1e18 fixed-point bigint to a lossless decimal string.
 *
 * Pure bigint arithmetic — never passes through `Number`, so no
 * precision is lost for values above `Number.MAX_SAFE_INTEGER`.
 *
 * Example: 1_050_000_000_000_000_000n → "1.050000000000000000"
 */
function formatFixedPoint18(value: bigint): string {
  const isNegative = value < 0n;
  const abs = isNegative ? -value : value;
  const integerPart = abs / FIXED_POINT_SCALE;
  const fractionalPart = abs % FIXED_POINT_SCALE;
  const sign = isNegative ? "-" : "";
  return `${sign}${integerPart}.${fractionalPart.toString().padStart(18, "0")}`;
}

// ---------------------------------------------------------------------------
// Contract ABIs (event signatures only)
// ---------------------------------------------------------------------------

/**
 * Cruzible Vault contract events — must match the DEPLOYED
 * backend/contracts-evm/src/Cruzible.sol.  The signatures below determine
 * topic hashes; any drift means the indexer silently misses or misparses
 * on-chain events.  (An earlier revision of this file described a different
 * contract line — UnstakeRequested/RewardsDistributed with extra fields —
 * and indexed nothing against the shipped vault; verified live 2026-07-14.)
 *
 *   event Staked(address indexed user, uint256 amount, uint256 shares)
 *   event Unstaked(address indexed user, uint256 shares, uint256 amount, uint256 withdrawalId, uint256 completionTime)
 *   event Withdrawn(address indexed user, uint256 withdrawalId, uint256 amount)
 *   event RewardsAdded(uint256 amount, uint256 newTotalPooled)
 *   event RewardsClaimed(address indexed user, uint256 indexed epoch, uint256 amount)
 */
export const CRUZIBLE_VAULT_ABI = [
  "event Staked(address indexed user, uint256 amount, uint256 shares)",
  "event Unstaked(address indexed user, uint256 shares, uint256 amount, uint256 withdrawalId, uint256 completionTime)",
  "event Withdrawn(address indexed user, uint256 withdrawalId, uint256 amount)",
  "event RewardsAdded(uint256 amount, uint256 newTotalPooled)",
  "event RewardsClaimed(address indexed user, uint256 indexed epoch, uint256 amount)",
];

/**
 * stAETHEL emits both the rebasing AETHEL-denominated Transfer value and the
 * invariant share movement. TransferShares is the canonical accounting unit.
 */
const STAETHEL_ABI = [
  "event Transfer(address indexed from, address indexed to, uint256 value)",
  "event TransferShares(address indexed from, address indexed to, uint256 sharesValue)",
];

/**
 * InstitutionalStablecoinBridge events — must match the deployed contract.
 *
 *   event StablecoinConfigured(bytes32 indexed assetId, address indexed token, uint8 routingType, bool enabled)
 *   event CCTPBurnInitiated(bytes32 indexed assetId, address indexed sender, uint32 indexed destinationDomain, uint256 amount, uint64 cctpNonce)
 *   event MintExecuted(bytes32 indexed assetId, bytes32 indexed mintOperationId, address indexed recipient, uint256 amount)
 *   event CircuitBreakerTriggered(bytes32 indexed assetId, bytes32 indexed reasonCode, uint256 observed, uint256 threshold)
 */
const STABLECOIN_BRIDGE_ABI = [
  "event StablecoinConfigured(bytes32 indexed assetId, address indexed token, uint8 routingType, bool enabled)",
  "event CCTPBurnInitiated(bytes32 indexed assetId, address indexed sender, uint32 indexed destinationDomain, uint256 amount, uint64 cctpNonce)",
  "event MintExecuted(bytes32 indexed assetId, bytes32 indexed mintOperationId, address indexed recipient, uint256 amount)",
  "event CircuitBreakerTriggered(bytes32 indexed assetId, bytes32 indexed reasonCode, uint256 observed, uint256 threshold)",
];

const cruzibleIface = new Interface(CRUZIBLE_VAULT_ABI);
const staethelIface = new Interface(STAETHEL_ABI);
const bridgeIface = new Interface(STABLECOIN_BRIDGE_ABI);

// Topic hashes for fast log filtering
const TOPIC_STAKED = cruzibleIface.getEvent("Staked")!.topicHash;
const TOPIC_UNSTAKED = cruzibleIface.getEvent("Unstaked")!.topicHash;
const TOPIC_WITHDRAWN = cruzibleIface.getEvent("Withdrawn")!.topicHash;
const TOPIC_REWARDS_ADDED = cruzibleIface.getEvent("RewardsAdded")!.topicHash;
const TOPIC_REWARDS_CLAIMED =
  cruzibleIface.getEvent("RewardsClaimed")!.topicHash;
const TOPIC_TRANSFER = staethelIface.getEvent("Transfer")!.topicHash;
const TOPIC_TRANSFER_SHARES =
  staethelIface.getEvent("TransferShares")!.topicHash;

// Stablecoin bridge event topics
const TOPIC_STABLECOIN_CONFIGURED = bridgeIface.getEvent(
  "StablecoinConfigured",
)!.topicHash;
const TOPIC_CCTP_BURN_INITIATED =
  bridgeIface.getEvent("CCTPBurnInitiated")!.topicHash;
const TOPIC_MINT_EXECUTED = bridgeIface.getEvent("MintExecuted")!.topicHash;
const TOPIC_CIRCUIT_BREAKER_TRIGGERED = bridgeIface.getEvent(
  "CircuitBreakerTriggered",
)!.topicHash;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface IndexerConfig {
  wsUrl: string;
  rpcUrl: string;
  cruzibleVaultAddress: string;
  staethelAddress: string;
  stablecoinBridgeAddress: string;
  startBlock: number;
  expectedChainId?: string;
  expectedGenesisHash?: string;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

@singleton()
export class IndexerService {
  private prisma: PrismaClient;
  private wsProvider: WebSocketProvider | null = null;
  private httpProvider: JsonRpcProvider | null = null;
  private running = false;
  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private wsReconnectAttempts = 0;
  private wsReconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private wsConnectPromise: Promise<void> | null = null;
  private wsDisconnectHandledProvider: WebSocketProvider | null = null;
  private shutdownPromiseResolve: (() => void) | null = null;
  private processingLock = false;
  private materializedStateRebuildRequired = false;
  private materializedStateRebuildCompleted = false;
  private materializedStateRecoveryTarget: number | null = null;
  private pendingBlockNumber: number | null = null;
  private verifiedHttpChainId: string | null = null;
  private verifiedHttpAnchorHash: string | null = null;
  private networkKeys: IndexerNetworkKeys | null = null;
  private wsChainRejected = false;

  // Config — populated from env in initialize()
  private cfg: IndexerConfig = {
    wsUrl: "",
    rpcUrl: "",
    cruzibleVaultAddress: "",
    staethelAddress: "",
    stablecoinBridgeAddress: "",
    startBlock: 0,
    expectedChainId: undefined,
    expectedGenesisHash: undefined,
  };

  // Metrics (in-memory, exposed via getMetrics())
  private _chainHead = 0;
  private _indexedHead = 0;
  private _blocksIndexedTotal = 0;
  private _txIndexedTotal = 0;
  private _eventsIndexedTotal = 0;
  private _reorgsDetected = 0;
  private _consecutiveErrors = 0;
  private _wsConnected = false;
  private _lastIndexedAt: Date | null = null;

  constructor(private blockchainService: BlockchainService) {
    this.prisma = new PrismaClient();
  }

  // -----------------------------------------------------------------------
  // Lifecycle
  // -----------------------------------------------------------------------

  async initialize(): Promise<void> {
    logger.info("IndexerService initializing...");

    this.cfg = {
      wsUrl: config.indexerWsUrl,
      rpcUrl: config.indexerRpcUrl,
      cruzibleVaultAddress: config.cruzibleVaultAddress,
      staethelAddress: config.staethelAddress,
      stablecoinBridgeAddress: config.stablecoinBridgeAddress,
      startBlock: config.indexerStartBlock,
      expectedChainId: config.indexerExpectedChainId,
      expectedGenesisHash: config.indexerExpectedGenesisHash,
    };

    if (!this.cfg.cruzibleVaultAddress) {
      logger.warn(
        "CRUZIBLE_VAULT_ADDRESS not set — vault event indexing disabled. " +
          "Set this env var to enable Staked/Unstaked/Withdrawn/RewardsClaimed indexing.",
      );
    }
    if (!this.cfg.staethelAddress) {
      logger.warn(
        "STAETHEL_ADDRESS not set — StAETHEL transfer indexing disabled. " +
          "Set this env var to enable Transfer event indexing.",
      );
    }
    if (!this.cfg.stablecoinBridgeAddress) {
      logger.warn(
        "STABLECOIN_BRIDGE_ADDRESS not set — stablecoin bridge event indexing disabled. " +
          "Set this env var to enable CCTPBurnInitiated/StablecoinConfigured/MintExecuted indexing.",
      );
    }

    // Create HTTP provider (always available as fallback)
    this.httpProvider = new JsonRpcProvider(this.cfg.rpcUrl);
    await this.assertExpectedChainId();

    // Recover sync state
    await this.ensureCursor();

    // A process may have stopped after atomically rolling back a reorg but
    // before rebuilding derived projections. Repair those projections before
    // the indexer can accept another block.
    if (this.materializedStateRebuildRequired) {
      logger.warn(
        "Resuming an incomplete materialized-state rebuild from a prior reorg",
      );
      await this.rebuildMaterializedState();
    }

    // Start the indexer
    this.running = true;

    // Attempt WebSocket connection first
    await this.connectWebSocket();

    // If WS failed, fall back to polling immediately
    if (!this._wsConnected) {
      logger.info("WebSocket not available, starting in polling mode");
      this.schedulePollTick(0);
    }

    logger.info("IndexerService started", {
      wsUrl: redactUrlForLogs(this.cfg.wsUrl),
      rpcUrl: redactUrlForLogs(this.cfg.rpcUrl),
      cruzibleVault: this.cfg.cruzibleVaultAddress || "(disabled)",
      staethel: this.cfg.staethelAddress || "(disabled)",
      stablecoinBridge: this.cfg.stablecoinBridgeAddress || "(disabled)",
      indexedHead: this._indexedHead,
      expectedChainId: this.cfg.expectedChainId ?? "(not enforced)",
      expectedGenesisHash: this.cfg.expectedGenesisHash ?? "(not enforced)",
    });
  }

  private async assertExpectedChainId(): Promise<void> {
    if (!this.httpProvider) {
      throw new Error(
        "Cannot verify indexer chain ID without an HTTP provider",
      );
    }

    const [network, anchorBlock] = await Promise.all([
      this.httpProvider.getNetwork(),
      this.httpProvider.getBlock(NETWORK_ANCHOR_BLOCK),
    ]);
    const actualChainId = network.chainId.toString();
    const actualAnchorHash = anchorBlock?.hash?.toLowerCase();
    if (!actualAnchorHash || anchorBlock?.number !== NETWORK_ANCHOR_BLOCK) {
      throw new Error(
        `Refusing to start indexer without an exact canonical block ${NETWORK_ANCHOR_BLOCK} response`,
      );
    }
    if (
      this.cfg.expectedChainId &&
      actualChainId !== this.cfg.expectedChainId
    ) {
      throw new Error(
        `Refusing to start indexer on chain ${actualChainId}; expected ${this.cfg.expectedChainId}`,
      );
    }
    if (
      this.cfg.expectedGenesisHash &&
      actualAnchorHash !== this.cfg.expectedGenesisHash.toLowerCase()
    ) {
      throw new Error(
        `Refusing to start indexer on network anchor ${actualAnchorHash}; expected ${this.cfg.expectedGenesisHash.toLowerCase()}`,
      );
    }
    this.verifiedHttpChainId = actualChainId;
    this.verifiedHttpAnchorHash = actualAnchorHash;
    // Read-side consumers can only derive a namespace from configured
    // identity. Keep the legacy key when that identity is incomplete (the
    // normal local-development case) so the writer and readers never select
    // different cursors. Production validation requires the complete source
    // identity used below.
    this.networkKeys =
      this.cfg.expectedChainId &&
      this.cfg.expectedGenesisHash &&
      this.cfg.cruzibleVaultAddress
        ? buildIndexerNetworkKeys({
            chainId: actualChainId,
            anchorHash: actualAnchorHash,
            vaultAddress: this.cfg.cruzibleVaultAddress,
            staethelAddress: this.cfg.staethelAddress,
            stablecoinBridgeAddress: this.cfg.stablecoinBridgeAddress,
          })
        : null;

    logger.info("Indexer HTTP network identity verified", {
      expectedChainId: this.cfg.expectedChainId ?? "(not configured)",
      actualChainId,
      expectedAnchorHash: this.cfg.expectedGenesisHash ?? "(not configured)",
      actualAnchorHash,
      anchorBlock: NETWORK_ANCHOR_BLOCK,
    });
  }

  private assertWebSocketNetwork(
    actualChainId: string,
    actualAnchorHash: string,
  ): void {
    if (!this.verifiedHttpChainId || !this.verifiedHttpAnchorHash) {
      this.wsChainRejected = true;
      throw new Error(
        "Refusing WebSocket provider before the HTTP network identity is verified",
      );
    }

    if (actualChainId !== this.verifiedHttpChainId) {
      this.wsChainRejected = true;
      throw new Error(
        `Refusing WebSocket provider on chain ${actualChainId}; verified HTTP provider is chain ${this.verifiedHttpChainId}`,
      );
    }

    if (actualAnchorHash.toLowerCase() !== this.verifiedHttpAnchorHash) {
      this.wsChainRejected = true;
      throw new Error(
        `Refusing WebSocket provider on network anchor ${actualAnchorHash.toLowerCase()}; verified HTTP provider anchor is ${this.verifiedHttpAnchorHash}`,
      );
    }
  }

  async shutdown(): Promise<void> {
    logger.info("IndexerService shutting down...");
    this.running = false;

    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
    if (this.wsReconnectTimer) {
      clearTimeout(this.wsReconnectTimer);
      this.wsReconnectTimer = null;
    }

    // Wait for in-flight processing to complete (up to 10s)
    if (this.processingLock) {
      await new Promise<void>((resolve) => {
        this.shutdownPromiseResolve = resolve;
        setTimeout(resolve, 10_000);
      });
    }

    // Disconnect providers
    if (this.wsProvider) {
      await this.disposeWebSocketProvider(this.wsProvider);
    }

    await this.prisma.$disconnect();
    logger.info("IndexerService stopped");
  }

  // -----------------------------------------------------------------------
  // Metrics
  // -----------------------------------------------------------------------

  get chainHead(): number {
    return this._chainHead;
  }

  get indexedHead(): number {
    return this._indexedHead;
  }

  get lag(): number {
    return Math.max(0, this._chainHead - this._indexedHead);
  }

  get blocksIndexedTotal(): number {
    return this._blocksIndexedTotal;
  }

  get txIndexedTotal(): number {
    return this._txIndexedTotal;
  }

  get eventsIndexedTotal(): number {
    return this._eventsIndexedTotal;
  }

  getMetrics(): Record<string, unknown> {
    return {
      chainHead: this._chainHead,
      indexedHead: this._indexedHead,
      lag: this.lag,
      blocksIndexedTotal: this._blocksIndexedTotal,
      txIndexedTotal: this._txIndexedTotal,
      eventsIndexedTotal: this._eventsIndexedTotal,
      reorgsDetected: this._reorgsDetected,
      consecutiveErrors: this._consecutiveErrors,
      requiresRebuild: this.materializedStateRebuildRequired,
      rebuildCompleted: this.materializedStateRebuildCompleted,
      recoveryTargetBlock: this.materializedStateRecoveryTarget,
      pendingBlockNumber: this.pendingBlockNumber,
      networkChainId: this.verifiedHttpChainId,
      networkAnchorHash: this.verifiedHttpAnchorHash,
      networkNamespace: this.networkKeys?.cacheNamespace ?? null,
      wsConnected: this._wsConnected,
      lastIndexedAt: this._lastIndexedAt?.toISOString() ?? null,
    };
  }

  // -----------------------------------------------------------------------
  // Backfill
  // -----------------------------------------------------------------------

  /**
   * Re-index blocks from `fromBlock` to `toBlock` inclusive.
   * Blocks that already exist are overwritten (upsert), making this
   * idempotent.
   */
  async backfill(fromBlock: number, toBlock: number): Promise<void> {
    logger.info(`Backfill requested: blocks ${fromBlock}..${toBlock}`);

    if (
      this.materializedStateRebuildRequired &&
      !this.materializedStateRebuildCompleted
    ) {
      await this.rebuildMaterializedState();
    }

    for (let blockNum = fromBlock; blockNum <= toBlock; blockNum++) {
      await this.indexBlockWithRetry(blockNum);

      if (blockNum % 100 === 0) {
        logger.info(`Backfill progress: ${blockNum}/${toBlock}`);
      }
    }

    logger.info(`Backfill complete: blocks ${fromBlock}..${toBlock}`);
  }

  // -----------------------------------------------------------------------
  // WebSocket Connection
  // -----------------------------------------------------------------------

  private connectWebSocket(): Promise<void> {
    if (
      !this.cfg.wsUrl ||
      !this.running ||
      this.wsChainRejected ||
      this._wsConnected
    ) {
      return Promise.resolve();
    }
    if (this.wsConnectPromise) {
      return this.wsConnectPromise;
    }

    const connection = this.connectWebSocketOnce();
    this.wsConnectPromise = connection;
    connection.then(
      () => {
        if (this.wsConnectPromise === connection) {
          this.wsConnectPromise = null;
        }
      },
      () => {
        if (this.wsConnectPromise === connection) {
          this.wsConnectPromise = null;
        }
      },
    );
    return connection;
  }

  private async connectWebSocketOnce(): Promise<void> {
    let readyTimeout: NodeJS.Timeout | undefined;
    let provider: WebSocketProvider | null = null;

    try {
      if (this.wsProvider) {
        const previousProvider = this.wsProvider;
        this.wsDisconnectHandledProvider = previousProvider;
        await this.disposeWebSocketProvider(previousProvider);
      }
      if (!this.running || this.wsChainRejected) return;

      provider = new WebSocketProvider(this.cfg.wsUrl);
      this.wsProvider = provider;
      this.wsDisconnectHandledProvider = null;

      // Attach transport-level handlers BEFORE any await: the raw ws socket
      // starts connecting in the constructor, and a refused connection
      // (ECONNREFUSED) emits 'error' on it on the next tick — with no
      // listener attached yet, Node treats that as an unhandled 'error'
      // event and kills the WHOLE process, before getNetwork() ever rejects.
      let failBeforeReady: ((err: Error) => void) | undefined;
      const transportFailure = new Promise<never>((_, reject) => {
        failBeforeReady = reject;
      });
      // Register a no-op handler so a transport failure AFTER readiness (when
      // the race below has already settled) is not an unhandled rejection.
      transportFailure.catch(() => {});

      const ws = (provider as any)._websocket ?? (provider as any).websocket;
      if (ws && typeof ws.on === "function") {
        ws.on("close", () => {
          logger.warn("WebSocket connection closed");
          failBeforeReady?.(new Error("WebSocket closed before ready"));
          this.handleWsDisconnect(provider!);
        });
        ws.on("error", (err: Error) => {
          logger.error("WebSocket transport error", errorContext(err));
          failBeforeReady?.(
            err instanceof Error ? err : new Error(String(err)),
          );
          this.handleWsDisconnect(provider!);
        });
      }

      // Wait for the provider to be ready (ethers v6) — with a bound. On a
      // dead endpoint getNetwork() never settles, and connectWebSocket() is
      // awaited on the server-boot path: an unbounded wait here keeps the
      // whole API from ever listening. WS is best-effort; failing this race
      // lands in the catch below while reconnects/polling proceed.
      const [network, anchorBlock] = await Promise.race([
        Promise.all([
          provider.getNetwork(),
          provider.getBlock(NETWORK_ANCHOR_BLOCK),
        ]),
        transportFailure,
        new Promise<never>((_, reject) => {
          readyTimeout = setTimeout(
            () => reject(new Error("WebSocket ready timeout")),
            WS_READY_TIMEOUT_MS,
          );
        }),
      ]);
      const anchorHash = anchorBlock?.hash?.toLowerCase();
      if (!anchorHash || anchorBlock?.number !== NETWORK_ANCHOR_BLOCK) {
        throw new Error(
          `Refusing WebSocket provider without an exact canonical block ${NETWORK_ANCHOR_BLOCK} response`,
        );
      }
      this.assertWebSocketNetwork(network.chainId.toString(), anchorHash);
      if (!this.running || this.wsProvider !== provider) {
        await this.disposeWebSocketProvider(provider);
        return;
      }
      failBeforeReady = undefined;
      this._wsConnected = true;
      this.wsReconnectAttempts = 0;

      logger.info("WebSocket connected", {
        url: redactUrlForLogs(this.cfg.wsUrl),
        chainId: network.chainId.toString(),
        anchorHash,
        anchorBlock: NETWORK_ANCHOR_BLOCK,
      });

      // Subscribe to new blocks
      provider.on("block", (blockNumber: number) => {
        this.onNewBlock(blockNumber).catch((err) => {
          logger.error(
            "Error processing new block from WebSocket",
            errorContext(err),
          );
        });
      });

      // Handle provider errors (ethers v6 uses 'error' event on the provider)
      provider.on("error", (err: Error) => {
        logger.error("WebSocket provider error", errorContext(err));
        this.handleWsDisconnect(provider!);
      });
    } catch (error) {
      logger.error("Failed to connect WebSocket", errorContext(error));
      if (provider) {
        this.handleWsDisconnect(provider);
      } else {
        this._wsConnected = false;
        this.schedulePollTick(0);
        this.scheduleWsReconnect();
      }
    } finally {
      if (readyTimeout) {
        clearTimeout(readyTimeout);
      }
    }
  }

  private handleWsDisconnect(provider: WebSocketProvider): void {
    if (
      provider !== this.wsProvider ||
      this.wsDisconnectHandledProvider === provider
    ) {
      return;
    }

    this.wsDisconnectHandledProvider = provider;
    this._wsConnected = false;
    this.wsProvider = null;
    void this.disposeWebSocketProvider(provider);

    if (!this.running) return;
    this.schedulePollTick(0);
    if (this.wsChainRejected) {
      return;
    }

    this.scheduleWsReconnect();
  }

  private scheduleWsReconnect(): void {
    if (
      !this.running ||
      this._wsConnected ||
      this.wsChainRejected ||
      this.wsReconnectTimer
    ) {
      return;
    }

    this.wsReconnectAttempts++;

    if (this.wsReconnectAttempts > WS_MAX_RECONNECT_ATTEMPTS) {
      logger.warn(
        `WebSocket reconnect attempts exhausted (${WS_MAX_RECONNECT_ATTEMPTS}), ` +
          "falling back to polling mode",
      );
      return;
    }

    const delay = Math.min(
      WS_RECONNECT_DELAY_MS * Math.pow(1.5, this.wsReconnectAttempts - 1),
      MAX_RETRY_DELAY_MS,
    );

    logger.info(
      `WebSocket reconnect attempt ${this.wsReconnectAttempts}/${WS_MAX_RECONNECT_ATTEMPTS} ` +
        `in ${Math.round(delay)}ms`,
    );

    this.wsReconnectTimer = setTimeout(() => {
      this.wsReconnectTimer = null;
      if (this.running && !this._wsConnected && !this.wsChainRejected) {
        void this.connectWebSocket();
      }
    }, delay);
  }

  private async disposeWebSocketProvider(
    provider: WebSocketProvider,
  ): Promise<void> {
    if (this.wsProvider === provider) {
      this.wsProvider = null;
    }
    try {
      provider.removeAllListeners();
      await provider.destroy();
    } catch {
      // Cleanup is idempotent and must never make a rejected provider usable.
    }
  }

  // -----------------------------------------------------------------------
  // Block Processing — WebSocket Mode
  // -----------------------------------------------------------------------

  private async onNewBlock(blockNumber: number): Promise<void> {
    if (!this.running) return;

    this._chainHead = blockNumber;

    // Process all blocks from indexed head + 1 to the new block
    // (handles catching up after brief disconnects)
    const startBlock = this._indexedHead + 1;
    const safeTarget = blockNumber - CONFIRMATION_DEPTH;

    if (safeTarget < startBlock) return;

    try {
      await this.processBlockRange(startBlock, safeTarget);
      this._consecutiveErrors = 0;
    } catch (error) {
      this._consecutiveErrors++;
      logger.error(
        `Error processing block range ${startBlock}..${safeTarget}:`,
        error,
      );
    }
  }

  // -----------------------------------------------------------------------
  // Block Processing — Polling Mode
  // -----------------------------------------------------------------------

  private schedulePollTick(delayMs: number): void {
    if (!this.running || this._wsConnected || this.pollTimer) return;

    this.pollTimer = setTimeout(async () => {
      this.pollTimer = null;
      await this.pollTick();
    }, delayMs);
  }

  private async pollTick(): Promise<void> {
    if (!this.running) return;

    // If WebSocket has reconnected, stop polling
    if (this._wsConnected) return;

    try {
      const provider = this.getProvider();
      this._chainHead = await this.withRetry(() => provider.getBlockNumber());

      const startBlock = this._indexedHead + 1;
      const safeTarget = Math.min(
        this._chainHead - CONFIRMATION_DEPTH,
        this._indexedHead + MAX_BLOCKS_PER_TICK,
      );

      if (safeTarget >= startBlock) {
        await this.processBlockRange(startBlock, safeTarget);
      }

      this._consecutiveErrors = 0;

      // Schedule next tick — faster if behind, slower if caught up
      const delay =
        this.lag > CONFIRMATION_DEPTH + 1
          ? POLL_INTERVAL_MS
          : IDLE_POLL_INTERVAL_MS;
      this.schedulePollTick(delay);
    } catch (error) {
      this._consecutiveErrors++;
      const backoff = Math.min(
        BASE_RETRY_DELAY_MS * 2 ** this._consecutiveErrors,
        MAX_RETRY_DELAY_MS,
      );
      logger.error(
        `Indexer poll tick failed (attempt ${this._consecutiveErrors}), ` +
          `retrying in ${backoff}ms:`,
        error,
      );
      this.schedulePollTick(backoff);
    }
  }

  // -----------------------------------------------------------------------
  // Block Range Processing
  // -----------------------------------------------------------------------

  private async processBlockRange(
    fromBlock: number,
    toBlock: number,
  ): Promise<void> {
    if (this.processingLock) return;
    this.processingLock = true;

    try {
      if (
        this.materializedStateRebuildRequired &&
        !this.materializedStateRebuildCompleted
      ) {
        await this.rebuildMaterializedState();
      }

      for (let blockNum = fromBlock; blockNum <= toBlock; blockNum++) {
        if (!this.running) break;

        // Check for reorg before processing
        const reorgBlock = await this.detectReorg(blockNum);
        if (reorgBlock !== null) {
          await this.handleReorg(reorgBlock, blockNum);
          // After reorg handling, restart from the reorg point
          return;
        }

        await this.indexBlockWithRetry(blockNum);
      }
    } finally {
      this.processingLock = false;

      if (this.shutdownPromiseResolve) {
        this.shutdownPromiseResolve();
        this.shutdownPromiseResolve = null;
      }
    }
  }

  // -----------------------------------------------------------------------
  // Reorg Detection & Handling
  // -----------------------------------------------------------------------

  /**
   * Detect a reorg by comparing the parent hash of the incoming block
   * against the hash we stored for the previous block.
   *
   * Returns the block number where the reorg diverged, or null if no reorg.
   */
  private async detectReorg(blockNumber: number): Promise<number | null> {
    if (blockNumber <= 1) return null;

    const previousBlock = await this.prisma.block.findUnique({
      where: { height: BigInt(blockNumber - 1) },
      select: { hash: true },
    });

    // No previous block stored — nothing to compare against
    if (!previousBlock) return null;

    const provider = this.getProvider();
    const incomingBlock = await this.withRetry(() =>
      provider.getBlock(blockNumber),
    );

    if (!incomingBlock) return null;

    if (
      incomingBlock.parentHash.toLowerCase() !==
      previousBlock.hash.toLowerCase()
    ) {
      // Reorg detected! Walk back to find the divergence point
      logger.warn(
        `Reorg detected at block ${blockNumber}: ` +
          `expected parent ${previousBlock.hash}, ` +
          `got ${incomingBlock.parentHash}`,
      );

      let divergenceBlock = blockNumber - 1;
      let foundCommonAncestor = false;
      for (let depth = 1; depth <= MAX_REORG_DEPTH; depth++) {
        const checkBlockNum = blockNumber - 1 - depth;
        if (checkBlockNum < 0) break;

        const storedBlock = await this.prisma.block.findUnique({
          where: { height: BigInt(checkBlockNum) },
          select: { hash: true },
        });

        if (!storedBlock) break;

        const chainBlock = await this.withRetry(() =>
          provider.getBlock(checkBlockNum),
        );

        if (!chainBlock) break;

        if (storedBlock.hash.toLowerCase() === chainBlock.hash!.toLowerCase()) {
          // Found the common ancestor
          divergenceBlock = checkBlockNum + 1;
          foundCommonAncestor = true;
          break;
        }

        divergenceBlock = checkBlockNum;
      }

      if (!foundCommonAncestor) {
        throw new Error(
          `Reorg at block ${blockNumber} has no proven common ancestor within ${MAX_REORG_DEPTH} blocks`,
        );
      }

      return divergenceBlock;
    }

    return null;
  }

  /**
   * Handle a detected reorg by rolling back indexed data from the
   * divergence point and re-indexing.
   */
  private async handleReorg(
    fromBlock: number,
    currentTarget: number,
  ): Promise<void> {
    const depth = currentTarget - fromBlock + 1;
    this._reorgsDetected++;

    logger.warn(
      `Handling reorg: rolling back blocks ${fromBlock}..${currentTarget} (depth=${depth})`,
    );

    // Log the reorg event
    const storedBlock = await this.prisma.block.findUnique({
      where: { height: BigInt(fromBlock) },
      select: { hash: true },
    });

    const provider = this.getProvider();
    const chainBlock = await this.withRetry(() => provider.getBlock(fromBlock));

    await this.prisma.reorgEvent.create({
      data: {
        fromBlock: BigInt(fromBlock),
        toBlock: BigInt(currentTarget),
        expectedHash: storedBlock?.hash ?? "0x0",
        actualHash: chainBlock?.hash ?? "0x0",
        depth,
      },
    });

    // Delete all indexed data from the reorg point onwards
    await this.rollbackFromBlock(fromBlock, currentTarget);

    const newHead = fromBlock - 1;
    logger.info(`Reorg rollback complete. Resuming from block ${newHead + 1}`);

    // Re-index directly while the outer range owns processingLock. Calling
    // processBlockRange() here would return immediately because of that lock.
    for (
      let blockNumber = fromBlock;
      blockNumber <= currentTarget;
      blockNumber++
    ) {
      if (!this.running) break;
      await this.indexBlockWithRetry(blockNumber);
    }
  }

  /**
   * Delete all indexed data at or after the given block number.
   */
  private async rollbackFromBlock(
    fromBlock: number,
    currentTarget: number,
  ): Promise<void> {
    const fromHeight = BigInt(fromBlock);
    const newHead = fromBlock - 1;
    const rollbackTime = new Date();
    const syncStateKey = this.getSyncStateKey();

    // Set this before starting the transaction so any local retry is also
    // fail-closed. The durable flag is written in the same transaction as the
    // deletes and cursor rollback below.
    this.materializedStateRebuildRequired = true;
    this.materializedStateRebuildCompleted = false;
    this.materializedStateRecoveryTarget = currentTarget;

    // Delete reorged rows and rewind the cursor atomically. A cursor must never
    // continue to point beyond rows that have already been removed.
    await this.prisma.$transaction([
      // Delete StAETHEL transfers
      this.prisma.stAethelTransfer.deleteMany({
        where: { blockNumber: { gte: fromHeight } },
      }),
      // Delete stablecoin bridge events from the orphaned branch
      this.prisma.stablecoinBridgeEvent.deleteMany({
        where: { blockNumber: { gte: fromHeight } },
      }),
      // A configuration row is a latest-value projection. Rows whose latest
      // configuring event was orphaned must be reconstructed from surviving
      // generic events below.
      this.prisma.stablecoinConfig.deleteMany({
        where: { blockNumber: { gte: fromHeight } },
      }),
      // VaultState is also a latest-value projection, not event history.
      this.prisma.vaultState.deleteMany({}),
      // Delete vault withdrawals
      this.prisma.vaultWithdrawal.deleteMany({
        where: { blockNumber: { gte: fromHeight } },
      }),
      // Delete vault rewards by block
      this.prisma.vaultReward.deleteMany({
        where: { blockNumber: { gte: fromHeight } },
      }),
      // Delete vault unstakes by block
      this.prisma.vaultUnstake.deleteMany({
        where: { blockNumber: { gte: fromHeight } },
      }),
      // Delete vault stakes by block
      this.prisma.vaultStake.deleteMany({
        where: { blockNumber: { gte: fromHeight } },
      }),
      // Delete events
      this.prisma.event.deleteMany({
        where: { blockHeight: { gte: fromHeight } },
      }),
      // Delete messages (via transactions)
      this.prisma.message.deleteMany({
        where: {
          transaction: { blockHeight: { gte: fromHeight } },
        },
      }),
      // Delete transactions
      this.prisma.transaction.deleteMany({
        where: { blockHeight: { gte: fromHeight } },
      }),
      // Delete blocks
      this.prisma.block.deleteMany({
        where: { height: { gte: fromHeight } },
      }),
      this.prisma.indexerCursor.update({
        where: { cursorKey: this.getCursorKey() },
        data: {
          blockNumber: BigInt(newHead),
          blockHash: "0x0",
          timestamp: rollbackTime,
          requiresRebuild: true,
          recoveryTargetBlock: BigInt(currentTarget),
          pendingBlockNumber: null,
        },
      }),
      this.prisma.syncState.upsert({
        where: { chainId: syncStateKey },
        update: {
          lastBlockHeight: BigInt(newHead),
          lastBlockTime: rollbackTime,
          isSyncing: true,
        },
        create: {
          chainId: syncStateKey,
          lastBlockHeight: BigInt(newHead),
          lastBlockTime: rollbackTime,
          isSyncing: true,
        },
      }),
    ]);

    this._indexedHead = newHead;
    this._lastIndexedAt = rollbackTime;
    this.pendingBlockNumber = null;

    await this.rebuildMaterializedState();
  }

  /**
   * Rebuild all latest-value and aggregate projections after a reorg.
   * A completed rebuild is necessary but not sufficient to clear the durable
   * recovery marker. During a reorg, the marker remains set until the cursor
   * also reaches the persisted canonical replay target. That prevents a crash
   * between projection repair and replay from making the API ready early.
   */
  private async rebuildMaterializedState(): Promise<void> {
    // The stAETHEL share ledger and its holder aggregate are rebuilt from the
    // surviving raw TransferShares events. This also upgrades old databases
    // that incorrectly materialized rebasing ERC-20 Transfer values.
    await this.rebuildStAethelBalances();
    await this.rebuildVaultUnstakeStatuses();
    await this.rebuildStablecoinConfigs();
    await this.refreshVaultState(this._indexedHead);

    this.materializedStateRebuildCompleted = true;
    await this.completeMaterializedStateRecoveryIfReady(this._indexedHead);
  }

  /**
   * Clear the fail-closed marker only after both phases of recovery complete:
   * (1) derived projections were rebuilt from surviving events, and
   * (2) the durable cursor reached the canonical replay target.
   *
   * A null target is used by one-time projection migrations. Those require a
   * rebuild at the current cursor but do not have a missing canonical range.
   */
  private async completeMaterializedStateRecoveryIfReady(
    indexedBlock: number,
  ): Promise<void> {
    if (
      !this.materializedStateRebuildRequired ||
      !this.materializedStateRebuildCompleted
    ) {
      return;
    }

    if (
      this.materializedStateRecoveryTarget !== null &&
      indexedBlock < this.materializedStateRecoveryTarget
    ) {
      return;
    }

    await this.prisma.indexerCursor.update({
      where: { cursorKey: this.getCursorKey() },
      data: {
        requiresRebuild: false,
        recoveryTargetBlock: null,
      },
    });
    this.materializedStateRebuildRequired = false;
    this.materializedStateRebuildCompleted = false;
    this.materializedStateRecoveryTarget = null;
  }

  /**
   * Rebuild the canonical stAETHEL share transfer ledger and holder aggregate
   * from surviving generic TransferShares events. Shares do not change during
   * a reward rebase, unlike the AETHEL-denominated ERC-20 balance.
   */
  private async rebuildStAethelBalances(): Promise<void> {
    logger.info(
      "Rebuilding stAETHEL share ledger from surviving TransferShares events…",
    );

    const shareEvents = await this.prisma.event.findMany({
      where: {
        type: "TransferShares",
        blockHeight: { not: null },
        transactionHash: { not: null },
        logIndex: { not: null },
      },
      select: {
        blockHeight: true,
        transactionHash: true,
        logIndex: true,
        attributes: true,
        timestamp: true,
      },
      orderBy: [
        { blockHeight: "asc" },
        { logIndex: "asc" },
        { timestamp: "asc" },
      ],
    });

    await this.prisma.$transaction([
      this.prisma.stAethelTransfer.deleteMany({}),
      this.prisma.stAethelBalance.deleteMany({}),
    ]);

    const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
    const balances = new Map<string, bigint>();
    const lastTx = new Map<string, { txHash: string; blockNumber: bigint }>();
    const transferCreates: ReturnType<
      PrismaClient["stAethelTransfer"]["create"]
    >[] = [];

    for (const event of shareEvents) {
      const attributes = event.attributes as {
        address?: unknown;
        topics?: unknown;
        data?: unknown;
      };
      if (
        event.blockHeight === null ||
        event.transactionHash === null ||
        event.logIndex === null ||
        typeof attributes.address !== "string" ||
        (this.cfg.staethelAddress !== "" &&
          attributes.address.toLowerCase() !==
            this.cfg.staethelAddress.toLowerCase()) ||
        !Array.isArray(attributes.topics) ||
        !attributes.topics.every((topic) => typeof topic === "string") ||
        typeof attributes.data !== "string"
      ) {
        throw new Error("Invalid surviving TransferShares event payload");
      }

      const parsed = staethelIface.parseLog({
        topics: attributes.topics as string[],
        data: attributes.data,
      });
      if (!parsed || parsed.name !== "TransferShares") {
        throw new Error("Unable to decode surviving TransferShares event");
      }

      const from = (parsed.args[0] as string).toLowerCase();
      const to = (parsed.args[1] as string).toLowerCase();
      const shares = parsed.args[2] as bigint;
      transferCreates.push(
        this.prisma.stAethelTransfer.create({
          data: {
            from,
            to,
            shares: shares.toString(),
            txHash: event.transactionHash,
            blockNumber: event.blockHeight,
            logIndex: event.logIndex,
            timestamp: event.timestamp,
          },
        }),
      );

      if (from !== ZERO_ADDRESS) {
        const next = (balances.get(from) ?? 0n) - shares;
        if (next < 0n) {
          throw new Error(
            `Surviving TransferShares history underflows ${from} at ${event.transactionHash}:${event.logIndex}`,
          );
        }
        balances.set(from, next);
        lastTx.set(from, {
          txHash: event.transactionHash,
          blockNumber: event.blockHeight,
        });
      }

      if (to !== ZERO_ADDRESS) {
        balances.set(to, (balances.get(to) ?? 0n) + shares);
        lastTx.set(to, {
          txHash: event.transactionHash,
          blockNumber: event.blockHeight,
        });
      }
    }

    for (let i = 0; i < transferCreates.length; i += 100) {
      await this.prisma.$transaction(transferCreates.slice(i, i + 100));
    }

    const balanceCreates = [...balances.entries()]
      .filter(([, shares]) => shares > 0n)
      .map(([holder, shares]) => {
        const meta = lastTx.get(holder)!;
        return this.prisma.stAethelBalance.create({
          data: {
            holder,
            shares: shares.toString(),
            lastTxHash: meta.txHash,
            lastBlockNumber: meta.blockNumber,
          },
        });
      });

    for (let i = 0; i < balanceCreates.length; i += 100) {
      await this.prisma.$transaction(balanceCreates.slice(i, i + 100));
    }

    logger.info(
      `stAETHEL share ledger rebuilt: ${shareEvents.length} transfers, ` +
        `${balanceCreates.length} holders with non-zero shares`,
    );
  }

  /** Rebuild claim state from surviving withdrawal events after a reorg. */
  private async rebuildVaultUnstakeStatuses(): Promise<void> {
    const withdrawals = await this.prisma.vaultWithdrawal.findMany({
      select: {
        withdrawalId: true,
        txHash: true,
        timestamp: true,
      },
      orderBy: [{ blockNumber: "asc" }, { logIndex: "asc" }],
    });

    await this.prisma.vaultUnstake.updateMany({
      data: {
        status: "PENDING",
        claimTxHash: null,
        claimedAt: null,
      },
    });

    for (const withdrawal of withdrawals) {
      await this.prisma.vaultUnstake.updateMany({
        where: { withdrawalId: withdrawal.withdrawalId },
        data: {
          status: "CLAIMED",
          claimTxHash: withdrawal.txHash,
          claimedAt: withdrawal.timestamp,
        },
      });
    }
  }

  /**
   * Rebuild StablecoinConfig from surviving StablecoinConfigured events, then
   * refresh every asset from the authoritative contract views. Existing rows
   * whose configuring event predates retained generic history are preserved
   * and refreshed as well.
   */
  private async rebuildStablecoinConfigs(): Promise<void> {
    if (!this.cfg.stablecoinBridgeAddress) return;

    const configurationEvents = await this.prisma.event.findMany({
      where: {
        type: "StablecoinConfigured",
        blockHeight: { not: null },
      },
      select: {
        blockHeight: true,
        attributes: true,
      },
      orderBy: [{ blockHeight: "asc" }, { timestamp: "asc" }],
    });

    for (const event of configurationEvents) {
      const attributes = event.attributes as {
        address?: unknown;
        topics?: unknown;
        data?: unknown;
      };
      if (
        typeof attributes.address !== "string" ||
        attributes.address.toLowerCase() !==
          this.cfg.stablecoinBridgeAddress.toLowerCase() ||
        !Array.isArray(attributes.topics) ||
        !attributes.topics.every((topic) => typeof topic === "string") ||
        typeof attributes.data !== "string" ||
        event.blockHeight === null
      ) {
        throw new Error("Invalid surviving StablecoinConfigured event payload");
      }

      const parsed = bridgeIface.parseLog({
        topics: attributes.topics as string[],
        data: attributes.data,
      });
      if (!parsed || parsed.name !== "StablecoinConfigured") {
        throw new Error(
          "Unable to decode surviving StablecoinConfigured event",
        );
      }

      const assetId = parsed.args[0] as string;
      const tokenAddress = (parsed.args[1] as string).toLowerCase();
      const routingType = Number(parsed.args[2]);
      const enabled = parsed.args[3] as boolean;

      await this.prisma.stablecoinConfig.upsert({
        where: { assetId },
        update: {
          tokenAddress,
          routingType,
          active: enabled,
          blockNumber: event.blockHeight,
        },
        create: {
          assetId,
          symbol: "",
          tokenAddress,
          routingType,
          maxBridgeAmount: "0",
          dailyLimit: "0",
          dailyUsed: "0",
          active: enabled,
          blockNumber: event.blockHeight,
        },
      });
    }

    const configs = await this.prisma.stablecoinConfig.findMany({
      select: { assetId: true },
    });
    for (const stablecoin of configs) {
      await this.refreshStablecoinConfig(stablecoin.assetId, this._indexedHead);
    }

    logger.info(
      `StablecoinConfig rebuilt: ${configs.length} assets refreshed from contract state`,
    );
  }

  // -----------------------------------------------------------------------
  // Cursor Persistence
  // -----------------------------------------------------------------------

  private async ensureCursor(): Promise<void> {
    const networkBinding = this.getVerifiedNetworkBinding();
    const cursorKey = this.getCursorKey();
    let cursor = await this.prisma.indexerCursor.findUnique({
      where: { cursorKey },
    });

    // One-time adoption path for the pre-namespace cursor. Migration 02000
    // may have rewound this row before the runtime knows the configured
    // network anchor. Copy its recovery state into the verified namespace;
    // never consult the legacy key again after the namespaced row exists.
    if (!cursor && cursorKey !== CURSOR_KEY) {
      cursor = await this.prisma.$transaction(
        async (tx) => {
          const legacyCursor = await tx.indexerCursor.findUnique({
            where: { cursorKey: CURSOR_KEY },
          });
          if (!legacyCursor) return null;

          if (
            (legacyCursor.networkChainId &&
              legacyCursor.networkChainId !== networkBinding.chainId) ||
            (legacyCursor.networkAnchorHash &&
              legacyCursor.networkAnchorHash.toLowerCase() !==
                networkBinding.anchorHash) ||
            (legacyCursor.networkVaultAddress &&
              legacyCursor.networkVaultAddress.toLowerCase() !==
                networkBinding.vaultAddress) ||
            (legacyCursor.networkStaethelAddress &&
              legacyCursor.networkStaethelAddress.toLowerCase() !==
                networkBinding.staethelAddress) ||
            (legacyCursor.networkStablecoinBridgeAddress &&
              legacyCursor.networkStablecoinBridgeAddress.toLowerCase() !==
                networkBinding.stablecoinBridgeAddress)
          ) {
            throw new Error(
              "Refusing to adopt a legacy cursor bound to another indexed source identity",
            );
          }

          // A cursor without vault provenance may only be adopted once. If a
          // namespace already exists for this chain/anchor, guessing that the
          // legacy projections belong to another vault could skip that
          // vault's complete history.
          if (
            !legacyCursor.networkVaultAddress ||
            !legacyCursor.networkStaethelAddress ||
            !legacyCursor.networkStablecoinBridgeAddress
          ) {
            const existingNamespace = await tx.indexerCursor.findFirst({
              where: {
                cursorKey: { startsWith: `${CURSOR_KEY}:` },
                networkChainId: networkBinding.chainId,
                networkAnchorHash: networkBinding.anchorHash,
              },
              select: { cursorKey: true },
            });
            if (existingNamespace) {
              throw new Error(
                "Refusing ambiguous legacy cursor adoption after this network already has a namespaced vault cursor; replay from a clean cursor",
              );
            }
          }

          await tx.indexerCursor.update({
            where: { cursorKey: CURSOR_KEY },
            data: {
              networkChainId: networkBinding.chainId,
              networkAnchorHash: networkBinding.anchorHash,
              networkVaultAddress: networkBinding.vaultAddress,
              networkStaethelAddress: networkBinding.staethelAddress,
              networkStablecoinBridgeAddress:
                networkBinding.stablecoinBridgeAddress,
            },
          });

          return tx.indexerCursor.create({
            data: {
              cursorKey,
              blockNumber: legacyCursor.blockNumber,
              blockHash: legacyCursor.blockHash,
              timestamp: legacyCursor.timestamp,
              requiresRebuild: legacyCursor.requiresRebuild,
              recoveryTargetBlock: legacyCursor.recoveryTargetBlock,
              pendingBlockNumber: legacyCursor.pendingBlockNumber,
              networkChainId: networkBinding.chainId,
              networkAnchorHash: networkBinding.anchorHash,
              networkVaultAddress: networkBinding.vaultAddress,
              networkStaethelAddress: networkBinding.staethelAddress,
              networkStablecoinBridgeAddress:
                networkBinding.stablecoinBridgeAddress,
            },
          });
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    }

    if (cursor) {
      if (
        (cursor.networkChainId &&
          cursor.networkChainId !== networkBinding.chainId) ||
        (cursor.networkAnchorHash &&
          cursor.networkAnchorHash.toLowerCase() !==
            networkBinding.anchorHash) ||
        (cursor.networkVaultAddress &&
          cursor.networkVaultAddress.toLowerCase() !==
            networkBinding.vaultAddress) ||
        (cursor.networkStaethelAddress &&
          cursor.networkStaethelAddress.toLowerCase() !==
            networkBinding.staethelAddress) ||
        (cursor.networkStablecoinBridgeAddress &&
          cursor.networkStablecoinBridgeAddress.toLowerCase() !==
            networkBinding.stablecoinBridgeAddress)
      ) {
        throw new Error(
          `Refusing to reuse cursor bound to ${cursor.networkChainId ?? "unknown"}/${cursor.networkAnchorHash ?? "unknown"}/${cursor.networkVaultAddress ?? "unknown"}/${cursor.networkStaethelAddress ?? "unknown"}/${cursor.networkStablecoinBridgeAddress ?? "unknown"}; verified source identity is ${networkBinding.chainId}/${networkBinding.anchorHash}/${networkBinding.vaultAddress}/${networkBinding.staethelAddress}/${networkBinding.stablecoinBridgeAddress}`,
        );
      }
      if (
        !cursor.networkChainId ||
        !cursor.networkAnchorHash ||
        !cursor.networkVaultAddress ||
        !cursor.networkStaethelAddress ||
        !cursor.networkStablecoinBridgeAddress
      ) {
        await this.prisma.indexerCursor.update({
          where: { cursorKey },
          data: {
            networkChainId: networkBinding.chainId,
            networkAnchorHash: networkBinding.anchorHash,
            networkVaultAddress: networkBinding.vaultAddress,
            networkStaethelAddress: networkBinding.staethelAddress,
            networkStablecoinBridgeAddress:
              networkBinding.stablecoinBridgeAddress,
          },
        });
      }
      this._indexedHead = Number(cursor.blockNumber);
      this.materializedStateRebuildRequired = cursor.requiresRebuild;
      this.materializedStateRebuildCompleted = false;
      this.materializedStateRecoveryTarget =
        cursor.recoveryTargetBlock === null ||
        cursor.recoveryTargetBlock === undefined
          ? null
          : Number(cursor.recoveryTargetBlock);
      this.pendingBlockNumber =
        cursor.pendingBlockNumber === null ||
        cursor.pendingBlockNumber === undefined
          ? null
          : Number(cursor.pendingBlockNumber);
      logger.info(`Resuming from cursor: block ${this._indexedHead}`);
    } else {
      // First run — use configured start block or 0
      const startBlock = Math.max(0, this.cfg.startBlock - 1);
      await this.prisma.indexerCursor.create({
        data: {
          cursorKey,
          blockNumber: BigInt(startBlock),
          blockHash: "0x0",
          timestamp: new Date(0),
          networkChainId: networkBinding.chainId,
          networkAnchorHash: networkBinding.anchorHash,
          networkVaultAddress: networkBinding.vaultAddress,
          networkStaethelAddress: networkBinding.staethelAddress,
          networkStablecoinBridgeAddress:
            networkBinding.stablecoinBridgeAddress,
        },
      });
      this._indexedHead = startBlock;
      logger.info(`Created initial cursor at block ${startBlock}`);
    }

    // SyncState is namespaced by the verified chain and immutable anchor so a
    // database copied between same-chain-id networks cannot resume silently.
    const syncStateKey = this.getSyncStateKey();
    await this.prisma.syncState.upsert({
      where: { chainId: syncStateKey },
      update: {},
      create: {
        chainId: syncStateKey,
        lastBlockHeight: BigInt(this._indexedHead),
        lastBlockTime: new Date(),
        isSyncing: false,
      },
    });
  }

  private async updateCursor(
    blockNumber: number,
    blockHash?: string,
    blockTimestamp?: Date,
  ): Promise<void> {
    const committedAt = blockTimestamp ?? new Date();
    const syncStateKey = this.getSyncStateKey();
    await this.prisma.$transaction([
      this.prisma.indexerCursor.update({
        where: { cursorKey: this.getCursorKey() },
        data: {
          blockNumber: BigInt(blockNumber),
          blockHash: blockHash ?? "0x0",
          timestamp: committedAt,
          pendingBlockNumber: null,
        },
      }),
      // Update legacy SyncState in the same commit boundary.
      this.prisma.syncState.upsert({
        where: { chainId: syncStateKey },
        update: {
          lastBlockHeight: BigInt(blockNumber),
          lastBlockTime: committedAt,
          isSyncing: this.lag > 10,
        },
        create: {
          chainId: syncStateKey,
          lastBlockHeight: BigInt(blockNumber),
          lastBlockTime: committedAt,
          isSyncing: this.lag > 10,
        },
      }),
    ]);

    this._indexedHead = blockNumber;
    this._lastIndexedAt = new Date();
    this.pendingBlockNumber = null;

    await this.completeMaterializedStateRecoveryIfReady(blockNumber);
  }

  // -----------------------------------------------------------------------
  // Block Indexing
  // -----------------------------------------------------------------------

  private async indexBlockWithRetry(blockNumber: number): Promise<void> {
    await this.withRetry(() => this.indexBlock(blockNumber));
  }

  /**
   * Publish a durable visibility barrier before any projection for a block is
   * written. Reconciliation reads this marker and every stake projection from
   * one repeatable-read snapshot, so a process crash can never make a partial
   * block generation look like a committed supply mismatch.
   */
  private async markBlockInProgress(blockNumber: number): Promise<void> {
    await this.prisma.indexerCursor.update({
      where: { cursorKey: this.getCursorKey() },
      data: { pendingBlockNumber: BigInt(blockNumber) },
    });
    this.pendingBlockNumber = blockNumber;
  }

  private async indexBlock(blockNumber: number): Promise<void> {
    const provider = this.getProvider();

    // Fetch block with transactions
    const block = await provider.getBlock(blockNumber, true);
    if (!block) {
      throw new Error(`Block ${blockNumber} not found`);
    }

    const blockTime = new Date(block.timestamp * 1000);
    const blockHash = block.hash!;
    const parentHash = block.parentHash;

    await this.markBlockInProgress(blockNumber);

    // Upsert block (idempotent)
    await this.prisma.block.upsert({
      where: { height: BigInt(blockNumber) },
      update: {
        hash: blockHash,
        parentHash,
        timestamp: blockTime,
        proposer: block.miner ?? "",
        txCount: block.transactions.length,
        gasUsed: BigInt(block.gasUsed),
        gasLimit: BigInt(block.gasLimit),
        size: 0, // EVM blocks don't expose size directly via ethers
        appHash: block.stateRoot ?? "",
        stateRoot: block.stateRoot,
      },
      create: {
        height: BigInt(blockNumber),
        hash: blockHash,
        parentHash,
        timestamp: blockTime,
        proposer: block.miner ?? "",
        txCount: block.transactions.length,
        gasUsed: BigInt(block.gasUsed),
        gasLimit: BigInt(block.gasLimit),
        size: 0,
        appHash: block.stateRoot ?? "",
        stateRoot: block.stateRoot,
      },
    });
    this._blocksIndexedTotal++;

    // Index transactions
    if (
      block.prefetchedTransactions &&
      block.prefetchedTransactions.length > 0
    ) {
      // Fetch all receipts in parallel for this block
      const receiptPromises = block.prefetchedTransactions.map((tx) =>
        this.withRetry(() => provider.getTransactionReceipt(tx.hash)),
      );
      const receipts = await Promise.all(receiptPromises);

      for (let i = 0; i < block.prefetchedTransactions.length; i++) {
        const tx = block.prefetchedTransactions[i];
        const receipt = receipts[i];
        await this.indexTransaction(tx, receipt, blockNumber);
      }
    }

    // Fetch and process contract event logs for this block
    await this.indexContractEvents(blockNumber, blockTime);

    // Update cursor
    await this.updateCursor(blockNumber, blockHash, blockTime);

    if (blockNumber % 50 === 0 || this.lag <= CONFIRMATION_DEPTH + 1) {
      logger.info(
        `Indexed block ${blockNumber}, ` +
          `txs=${block.transactions.length}, ` +
          `chain=${this._chainHead}, lag=${this.lag}`,
      );
    }
  }

  // -----------------------------------------------------------------------
  // Transaction Indexing
  // -----------------------------------------------------------------------

  private async indexTransaction(
    tx: TransactionResponse,
    receipt: TransactionReceipt | null,
    blockNumber: number,
  ): Promise<void> {
    const txHash = tx.hash;
    const status = receipt
      ? receipt.status === 1
        ? "SUCCESS"
        : "FAILED"
      : "PENDING";
    const gasUsed = receipt ? BigInt(receipt.gasUsed) : BigInt(0);

    await this.prisma.transaction.upsert({
      where: { hash: txHash },
      update: {
        status: status as any,
        gasUsed,
        gasWanted: BigInt(tx.gasLimit),
        gasPrice: tx.gasPrice?.toString() ?? null,
        fee: receipt
          ? (
              BigInt(receipt.gasUsed) * (receipt.gasPrice ?? BigInt(0))
            ).toString()
          : null,
        fromAddress: tx.from?.toLowerCase() ?? null,
        toAddress: tx.to?.toLowerCase() ?? null,
        code: receipt?.status ?? 0,
        signers: tx.from ? [tx.from.toLowerCase()] : [],
      },
      create: {
        hash: txHash,
        height: BigInt(blockNumber),
        blockHeight: BigInt(blockNumber),
        blockIndex: tx.index ?? 0,
        status: status as any,
        gasUsed,
        gasWanted: BigInt(tx.gasLimit),
        gasPrice: tx.gasPrice?.toString() ?? null,
        fee: receipt
          ? (
              BigInt(receipt.gasUsed) * (receipt.gasPrice ?? BigInt(0))
            ).toString()
          : null,
        fromAddress: tx.from?.toLowerCase() ?? null,
        toAddress: tx.to?.toLowerCase() ?? null,
        code: receipt?.status ?? 0,
        signers: tx.from ? [tx.from.toLowerCase()] : [],
      },
    });

    this._txIndexedTotal++;
  }

  // -----------------------------------------------------------------------
  // Contract Event Indexing
  // -----------------------------------------------------------------------

  private async indexContractEvents(
    blockNumber: number,
    blockTime: Date,
  ): Promise<void> {
    const provider = this.getProvider();

    // Build filter for the contracts we care about
    const addresses: string[] = [];
    if (this.cfg.cruzibleVaultAddress) {
      addresses.push(this.cfg.cruzibleVaultAddress);
    }
    if (this.cfg.staethelAddress) {
      addresses.push(this.cfg.staethelAddress);
    }
    if (this.cfg.stablecoinBridgeAddress) {
      addresses.push(this.cfg.stablecoinBridgeAddress);
    }

    if (addresses.length === 0) return;

    // Fetch all logs for our contracts in this block
    const logs = await this.withRetry(() =>
      provider.getLogs({
        address: addresses,
        fromBlock: blockNumber,
        toBlock: blockNumber,
      }),
    );

    let sawRelevantEvent = false;
    for (const log of logs) {
      // Track whether any event that affects VaultState was processed in
      // this block.  Vault contract events change totals/exchange rate;
      // stAETHEL TransferShares events change the derived totalStakers count.
      // Either should trigger a VaultState refresh.
      const addr = log.address.toLowerCase();
      if (
        (this.cfg.cruzibleVaultAddress &&
          addr === this.cfg.cruzibleVaultAddress.toLowerCase()) ||
        (this.cfg.staethelAddress &&
          addr === this.cfg.staethelAddress.toLowerCase())
      ) {
        sawRelevantEvent = true;
      }
      await this.processLog(log, blockTime);
    }

    // Refresh the materialized VaultState snapshot after blocks that
    // contained vault events OR stAETHEL share transfers. Vault events
    // change totals/exchange rate; transfers change the derived
    // totalStakers count and the stAETHEL share-balance table. View-function
    // reads are cheap and authoritative, so calling on transfer-only
    // blocks is harmless — the vault totals will be unchanged and the
    // upsert simply updates totalStakers + updatedAt.
    if (sawRelevantEvent) {
      await this.refreshVaultState(blockNumber);
    }
  }

  private async processLog(log: Log, blockTime: Date): Promise<void> {
    const topic0 = log.topics[0];
    const contractAddress = log.address.toLowerCase();

    try {
      // ---- Cruzible Vault Events ----
      if (
        this.cfg.cruzibleVaultAddress &&
        contractAddress === this.cfg.cruzibleVaultAddress.toLowerCase()
      ) {
        if (topic0 === TOPIC_STAKED) {
          await this.handleStakedEvent(log, blockTime);
        } else if (topic0 === TOPIC_UNSTAKED) {
          await this.handleUnstakedEvent(log, blockTime);
        } else if (topic0 === TOPIC_WITHDRAWN) {
          await this.handleWithdrawnEvent(log, blockTime);
        } else if (topic0 === TOPIC_REWARDS_ADDED) {
          await this.handleRewardsAddedEvent(log);
        } else if (topic0 === TOPIC_REWARDS_CLAIMED) {
          await this.handleRewardsClaimedEvent(log, blockTime);
        }
      }

      // ---- stAETHEL invariant share transfers ----
      if (
        this.cfg.staethelAddress &&
        contractAddress === this.cfg.staethelAddress.toLowerCase()
      ) {
        if (topic0 === TOPIC_TRANSFER_SHARES) {
          await this.handleTransferSharesEvent(log, blockTime);
        }
      }

      // ---- Stablecoin Bridge Events ----
      if (
        this.cfg.stablecoinBridgeAddress &&
        contractAddress === this.cfg.stablecoinBridgeAddress.toLowerCase()
      ) {
        if (topic0 === TOPIC_STABLECOIN_CONFIGURED) {
          await this.handleStablecoinConfiguredEvent(log);
        } else if (topic0 === TOPIC_CCTP_BURN_INITIATED) {
          await this.handleCCTPBurnInitiatedEvent(log, blockTime);
        } else if (topic0 === TOPIC_MINT_EXECUTED) {
          await this.handleMintExecutedEvent(log, blockTime);
        } else if (topic0 === TOPIC_CIRCUIT_BREAKER_TRIGGERED) {
          await this.handleCircuitBreakerTriggeredEvent(log, blockTime);
        }
      }

      // Persist generic event record for all logs
      await this.persistEventLog(log, blockTime);

      this._eventsIndexedTotal++;
    } catch (error) {
      logger.error(
        `Error processing log in tx ${log.transactionHash} ` +
          `(block ${log.blockNumber}, logIndex ${log.index}):`,
        error,
      );
      // A block is not complete unless every log is durably materialized.
      // Propagate the failure so indexBlock() never advances the cursor and
      // indexBlockWithRetry() can replay the block safely.
      throw error;
    }
  }

  // -----------------------------------------------------------------------
  // Cruzible Vault Event Handlers
  // -----------------------------------------------------------------------

  /**
   * Handle: Staked(address indexed user, uint256 amount, uint256 shares)
   */
  private async handleStakedEvent(log: Log, blockTime: Date): Promise<void> {
    const parsed = cruzibleIface.parseLog({
      topics: [...log.topics],
      data: log.data,
    });
    if (!parsed) return;

    const staker = parsed.args[0].toLowerCase(); // user (indexed)
    const amount = parsed.args[1].toString(); // amount (native AETHEL)
    const shares = parsed.args[2].toString(); // shares

    await this.prisma.vaultStake.upsert({
      where: {
        txHash_logIndex: {
          txHash: log.transactionHash,
          logIndex: log.index,
        },
      },
      update: {
        delegator: staker,
        amount,
        shares,
        timestamp: blockTime,
        blockNumber: BigInt(log.blockNumber),
        logIndex: log.index,
      },
      create: {
        delegator: staker,
        amount,
        shares,
        txHash: log.transactionHash,
        timestamp: blockTime,
        blockNumber: BigInt(log.blockNumber),
        logIndex: log.index,
      },
    });

    logger.info(
      `Staked: ${staker} amount=${amount} shares=${shares} tx=${log.transactionHash}`,
    );
  }

  /**
   * Handle: Unstaked(address indexed user, uint256 shares, uint256 amount, uint256 withdrawalId, uint256 completionTime)
   *
   * The on-chain `withdrawalId` is the unique identity of each withdrawal
   * request, so we key by `withdrawalId`, not `txHash`. Completion time is
   * emitted from the withdrawal row at request time, making historical replay
   * independent of later governance changes to unbondingPeriod.
   */
  private async handleUnstakedEvent(log: Log, blockTime: Date): Promise<void> {
    const parsed = cruzibleIface.parseLog({
      topics: [...log.topics],
      data: log.data,
    });
    if (!parsed) return;

    const staker = parsed.args[0].toLowerCase(); // user (indexed)
    const shares = parsed.args[1].toString(); // shares
    const amount = parsed.args[2].toString(); // amount (native AETHEL)
    const withdrawalId = BigInt(parsed.args[3].toString()); // withdrawalId
    const completionTimeSeconds = BigInt(parsed.args[4].toString());
    if (completionTimeSeconds > MAX_DATE_UNIX_SECONDS) {
      throw new Error("Unstaked completionTime exceeds Date range");
    }
    const completionTime = new Date(Number(completionTimeSeconds) * 1000);

    await this.prisma.vaultUnstake.upsert({
      where: { withdrawalId },
      update: {
        delegator: staker,
        shares,
        amount,
        startTime: blockTime,
        completionTime,
        sourceProvenance: "CANONICAL_EVENT",
        status: "PENDING",
        blockNumber: BigInt(log.blockNumber),
        logIndex: log.index,
      },
      create: {
        withdrawalId,
        delegator: staker,
        shares,
        amount,
        txHash: log.transactionHash,
        startTime: blockTime,
        completionTime,
        sourceProvenance: "CANONICAL_EVENT",
        status: "PENDING",
        blockNumber: BigInt(log.blockNumber),
        logIndex: log.index,
      },
    });

    logger.info(
      `Unstaked: ${staker} withdrawalId=${withdrawalId} shares=${shares} amount=${amount} tx=${log.transactionHash}`,
    );
  }

  /**
   * Handle: Withdrawn(address indexed user, uint256 withdrawalId, uint256 amount)
   *
   * Each Withdrawn event carries the specific `withdrawalId` that is being
   * claimed.  A single transaction can emit multiple Withdrawn events (via
   * `batchWithdraw()`), so both VaultWithdrawal and the VaultUnstake status
   * update are keyed by `withdrawalId`, not by bulk delegator match.
   */
  private async handleWithdrawnEvent(log: Log, blockTime: Date): Promise<void> {
    const parsed = cruzibleIface.parseLog({
      topics: [...log.topics],
      data: log.data,
    });
    if (!parsed) return;

    const staker = parsed.args[0].toLowerCase(); // user (indexed)
    const withdrawalId = BigInt(parsed.args[1].toString()); // withdrawalId (indexed)
    const amount = parsed.args[2].toString(); // aethelAmount

    await this.prisma.vaultWithdrawal.upsert({
      where: { withdrawalId },
      update: {
        delegator: staker,
        amount,
        timestamp: blockTime,
        blockNumber: BigInt(log.blockNumber),
        logIndex: log.index,
        sourceProvenance: "CANONICAL_EVENT",
      },
      create: {
        withdrawalId,
        delegator: staker,
        amount,
        txHash: log.transactionHash,
        timestamp: blockTime,
        blockNumber: BigInt(log.blockNumber),
        logIndex: log.index,
        sourceProvenance: "CANONICAL_EVENT",
      },
    });

    // Mark the SPECIFIC unstake request as CLAIMED by withdrawalId.
    // Using updateMany avoids throwing if the UnstakeRequested event was
    // missed (e.g. gap in indexing) — it simply updates zero rows.
    await this.prisma.vaultUnstake.updateMany({
      where: { withdrawalId },
      data: {
        status: "CLAIMED",
        claimTxHash: log.transactionHash,
        claimedAt: blockTime,
      },
    });

    logger.info(
      `Withdrawn: ${staker} withdrawalId=${withdrawalId} amount=${amount} tx=${log.transactionHash}`,
    );
  }

  /**
   * Handle: RewardsAdded(uint256 amount, uint256 newTotalPooled)
   *
   * Vault-level rebase event (not per-staker): rewards raise totalPooledAethel
   * and every stAETHEL balance rebases up.  Refresh the materialized
   * VaultState so exchange rate/TVL reflect the rebase immediately.
   */
  private async handleRewardsAddedEvent(log: Log): Promise<void> {
    const parsed = cruzibleIface.parseLog({
      topics: [...log.topics],
      data: log.data,
    });
    if (!parsed) return;

    const amount = parsed.args[0].toString();
    const newTotalPooled = parsed.args[1].toString();

    logger.info(
      `RewardsAdded: amount=${amount} newTotalPooled=${newTotalPooled} tx=${log.transactionHash}`,
    );

    await this.refreshVaultState(log.blockNumber);
  }

  /**
   * Handle: RewardsClaimed(address indexed user, uint256 indexed epoch, uint256 amount)
   *
   * Per-staker Merkle reward claim.  Keyed by (delegator, epoch) — the
   * contract enforces one claim per user per epoch.
   */
  private async handleRewardsClaimedEvent(
    log: Log,
    blockTime: Date,
  ): Promise<void> {
    const parsed = cruzibleIface.parseLog({
      topics: [...log.topics],
      data: log.data,
    });
    if (!parsed) return;

    const staker = parsed.args[0].toLowerCase(); // user (indexed)
    const epoch = BigInt(parsed.args[1].toString()); // epoch (indexed)
    const amount = parsed.args[2].toString();

    await this.prisma.vaultReward.upsert({
      where: { delegator_epoch: { delegator: staker, epoch } },
      update: {
        amount,
        claimed: true,
        claimedAt: blockTime,
        txHash: log.transactionHash,
        blockNumber: BigInt(log.blockNumber),
        logIndex: log.index,
        sourceProvenance: "CANONICAL_EVENT",
      },
      create: {
        delegator: staker,
        epoch,
        amount,
        claimed: true,
        claimedAt: blockTime,
        timestamp: blockTime,
        txHash: log.transactionHash,
        blockNumber: BigInt(log.blockNumber),
        logIndex: log.index,
        sourceProvenance: "CANONICAL_EVENT",
      },
    });

    logger.info(
      `RewardsClaimed: ${staker} epoch=${epoch} amount=${amount} tx=${log.transactionHash}`,
    );
  }

  // -----------------------------------------------------------------------
  // stAETHEL Share Transfer Handling
  // -----------------------------------------------------------------------

  private async handleTransferSharesEvent(
    log: Log,
    blockTime: Date,
  ): Promise<void> {
    const parsed = staethelIface.parseLog({
      topics: [...log.topics],
      data: log.data,
    });
    if (!parsed) return;

    const from = parsed.args[0].toLowerCase();
    const to = parsed.args[1].toLowerCase();
    const shares = parsed.args[2].toString();

    // The transfer identity and both balance deltas must commit atomically.
    // On replay, the existing transfer is authoritative and no deltas are
    // applied again. This also guarantees that a mid-handler failure cannot
    // leave only one side of a transfer updated.
    await this.prisma.$transaction(async (tx) => {
      const existing = await tx.stAethelTransfer.findUnique({
        where: {
          txHash_logIndex: {
            txHash: log.transactionHash,
            logIndex: log.index,
          },
        },
        select: { id: true },
      });

      if (existing) {
        return;
      }

      await tx.stAethelTransfer.create({
        data: {
          from,
          to,
          shares,
          txHash: log.transactionHash,
          logIndex: log.index,
          blockNumber: BigInt(log.blockNumber),
          timestamp: blockTime,
        },
      });

      const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
      if (from !== ZERO_ADDRESS) {
        await this.updateStAethelShareBalance(tx, from, `-${shares}`, log);
      }

      if (to !== ZERO_ADDRESS) {
        await this.updateStAethelShareBalance(tx, to, shares, log);
      }
    });
  }

  private async updateStAethelShareBalance(
    tx: Prisma.TransactionClient,
    holder: string,
    delta: string,
    log: Log,
  ): Promise<void> {
    const existing = await tx.stAethelBalance.findUnique({
      where: { holder },
    });

    const currentShares = existing ? BigInt(existing.shares) : 0n;
    const deltaValue = BigInt(delta);
    const newShares = currentShares + deltaValue;

    if (newShares < 0n) {
      throw new Error(
        `stAETHEL share ledger underflow for ${holder} at ${log.transactionHash}:${log.index}`,
      );
    }

    await tx.stAethelBalance.upsert({
      where: { holder },
      update: {
        shares: newShares.toString(),
        lastTxHash: log.transactionHash,
        lastBlockNumber: BigInt(log.blockNumber),
      },
      create: {
        holder,
        shares: newShares.toString(),
        lastTxHash: log.transactionHash,
        lastBlockNumber: BigInt(log.blockNumber),
      },
    });
  }

  // -----------------------------------------------------------------------
  // Stablecoin Bridge Event Handlers
  // -----------------------------------------------------------------------

  /**
   * Handle: StablecoinConfigured(bytes32 indexed assetId, address indexed token, uint8 routingType, bool enabled)
   *
   * Upserts the StablecoinConfig record whenever the admin (re-)configures
   * a stablecoin asset.  The `assetId` is the primary lookup key.
   */
  private async handleStablecoinConfiguredEvent(log: Log): Promise<void> {
    const parsed = bridgeIface.parseLog({
      topics: [...log.topics],
      data: log.data,
    });
    if (!parsed) return;

    const assetId = parsed.args[0]; // bytes32 (indexed)
    const tokenAddress = parsed.args[1].toLowerCase(); // address (indexed)
    const routingType = Number(parsed.args[2]); // uint8
    const enabled = parsed.args[3] as boolean; // bool

    // First: persist the event-derived fields immediately (fast path)
    await this.prisma.stablecoinConfig.upsert({
      where: { assetId },
      update: {
        tokenAddress,
        routingType,
        active: enabled,
        blockNumber: BigInt(log.blockNumber),
      },
      create: {
        assetId,
        symbol: "", // Placeholder — refreshStablecoinConfig() backfills from on-chain state
        tokenAddress,
        routingType,
        maxBridgeAmount: "0",
        dailyLimit: "0",
        dailyUsed: "0",
        active: enabled,
        blockNumber: BigInt(log.blockNumber),
      },
    });

    logger.info(
      `StablecoinConfigured: assetId=${assetId} token=${tokenAddress} ` +
        `routingType=${routingType} enabled=${enabled} tx=${log.transactionHash}`,
    );

    // Second: read the full on-chain struct to materialize all config fields
    // (symbol, name, limits, cctpDomain, etc.) that the event doesn't carry.
    // A failed authoritative read is retried at the block boundary; the cursor
    // must not advance while this projection is incomplete.
    await this.refreshStablecoinConfig(assetId, log.blockNumber);
  }

  /**
   * Handle: CCTPBurnInitiated(bytes32 indexed assetId, address indexed sender, uint32 indexed destinationDomain, uint256 amount, uint64 cctpNonce)
   *
   * Records a bridge-out event.  Keyed by (txHash, logIndex) for idempotency —
   * a single transaction can contain at most one CCTPBurnInitiated per logIndex.
   */
  private async handleCCTPBurnInitiatedEvent(
    log: Log,
    blockTime: Date,
  ): Promise<void> {
    const parsed = bridgeIface.parseLog({
      topics: [...log.topics],
      data: log.data,
    });
    if (!parsed) return;

    const assetId = parsed.args[0]; // bytes32 (indexed)
    const sender = parsed.args[1].toLowerCase(); // address (indexed)
    const destinationDomain = Number(parsed.args[2]); // uint32 (indexed)
    const amount = parsed.args[3].toString(); // uint256
    const cctpNonce = parsed.args[4].toString(); // uint64

    await this.prisma.stablecoinBridgeEvent.upsert({
      where: {
        txHash_logIndex: {
          txHash: log.transactionHash,
          logIndex: log.index,
        },
      },
      update: {
        assetId,
        eventType: "CCTPBurnInitiated",
        sender,
        amount,
        destDomain: destinationDomain,
        blockNumber: BigInt(log.blockNumber),
        timestamp: blockTime,
        metadata: { cctpNonce },
      },
      create: {
        assetId,
        eventType: "CCTPBurnInitiated",
        sender,
        amount,
        destDomain: destinationDomain,
        txHash: log.transactionHash,
        logIndex: log.index,
        blockNumber: BigInt(log.blockNumber),
        timestamp: blockTime,
        metadata: { cctpNonce },
      },
    });

    // Materialize usage from the authoritative contract view. This is an
    // absolute assignment (not an increment), so replaying this log cannot
    // double-count bridge volume.
    await this.refreshStablecoinConfig(assetId, log.blockNumber);

    logger.info(
      `CCTPBurnInitiated: assetId=${assetId} sender=${sender} amount=${amount} ` +
        `destDomain=${destinationDomain} nonce=${cctpNonce} tx=${log.transactionHash}`,
    );
  }

  /**
   * Handle: MintExecuted(bytes32 indexed assetId, bytes32 indexed mintOperationId, address indexed recipient, uint256 amount)
   *
   * Records an inbound mint event (tokens arriving on Aethelred).
   */
  private async handleMintExecutedEvent(
    log: Log,
    blockTime: Date,
  ): Promise<void> {
    const parsed = bridgeIface.parseLog({
      topics: [...log.topics],
      data: log.data,
    });
    if (!parsed) return;

    const assetId = parsed.args[0]; // bytes32 (indexed)
    const mintOperationId = parsed.args[1]; // bytes32 (indexed)
    const recipient = parsed.args[2].toLowerCase(); // address (indexed)
    const amount = parsed.args[3].toString(); // uint256

    await this.prisma.stablecoinBridgeEvent.upsert({
      where: {
        txHash_logIndex: {
          txHash: log.transactionHash,
          logIndex: log.index,
        },
      },
      update: {
        assetId,
        eventType: "MintExecuted",
        sender: recipient, // recipient is the beneficiary
        amount,
        blockNumber: BigInt(log.blockNumber),
        timestamp: blockTime,
        metadata: { mintOperationId },
      },
      create: {
        assetId,
        eventType: "MintExecuted",
        sender: recipient,
        amount,
        txHash: log.transactionHash,
        logIndex: log.index,
        blockNumber: BigInt(log.blockNumber),
        timestamp: blockTime,
        metadata: { mintOperationId },
      },
    });

    // Minting updates epoch usage as well. Refreshing an absolute on-chain
    // value keeps the projection replay-safe.
    await this.refreshStablecoinConfig(assetId, log.blockNumber);

    logger.info(
      `MintExecuted: assetId=${assetId} recipient=${recipient} amount=${amount} ` +
        `mintOpId=${mintOperationId} tx=${log.transactionHash}`,
    );
  }

  /**
   * Handle: CircuitBreakerTriggered(bytes32 indexed assetId, bytes32 indexed reasonCode, uint256 observed, uint256 threshold)
   *
   * Records a circuit breaker trip and marks the StablecoinConfig as tripped.
   * This is a critical safety event — the alert system picks up the flag from DB.
   */
  private async handleCircuitBreakerTriggeredEvent(
    log: Log,
    blockTime: Date,
  ): Promise<void> {
    const parsed = bridgeIface.parseLog({
      topics: [...log.topics],
      data: log.data,
    });
    if (!parsed) return;

    const assetId = parsed.args[0]; // bytes32 (indexed)
    const reasonCode = parsed.args[1]; // bytes32 (indexed)
    const observed = parsed.args[2].toString(); // uint256
    const threshold = parsed.args[3].toString(); // uint256

    // Record the event
    await this.prisma.stablecoinBridgeEvent.upsert({
      where: {
        txHash_logIndex: {
          txHash: log.transactionHash,
          logIndex: log.index,
        },
      },
      update: {
        assetId,
        eventType: "CircuitBreakerTriggered",
        sender: log.address.toLowerCase(), // bridge contract itself
        amount: observed,
        blockNumber: BigInt(log.blockNumber),
        timestamp: blockTime,
        metadata: { reasonCode, observed, threshold },
      },
      create: {
        assetId,
        eventType: "CircuitBreakerTriggered",
        sender: log.address.toLowerCase(),
        amount: observed,
        txHash: log.transactionHash,
        logIndex: log.index,
        blockNumber: BigInt(log.blockNumber),
        timestamp: blockTime,
        metadata: { reasonCode, observed, threshold },
      },
    });

    // Mark the StablecoinConfig as circuit-breaker-tripped
    await this.prisma.stablecoinConfig.updateMany({
      where: { assetId },
      data: { circuitBreakerTripped: true },
    });

    // Re-read mintPaused and usage so a replay or later breaker reset cannot
    // leave the materialized status stuck on a historical value.
    await this.refreshStablecoinConfig(assetId, log.blockNumber);

    logger.warn(
      `CircuitBreakerTriggered: assetId=${assetId} reason=${reasonCode} ` +
        `observed=${observed} threshold=${threshold} tx=${log.transactionHash}`,
    );
  }

  // -----------------------------------------------------------------------
  // Generic Event Persistence
  // -----------------------------------------------------------------------

  private async persistEventLog(log: Log, blockTime: Date): Promise<void> {
    const topic0 = log.topics[0];

    // Determine a readable event type
    let eventType = "Unknown";
    if (topic0 === TOPIC_STAKED) eventType = "Staked";
    else if (topic0 === TOPIC_UNSTAKED) eventType = "Unstaked";
    else if (topic0 === TOPIC_WITHDRAWN) eventType = "Withdrawn";
    else if (topic0 === TOPIC_REWARDS_ADDED) eventType = "RewardsAdded";
    else if (topic0 === TOPIC_REWARDS_CLAIMED) eventType = "RewardsClaimed";
    else if (topic0 === TOPIC_TRANSFER) eventType = "Transfer";
    else if (topic0 === TOPIC_TRANSFER_SHARES) eventType = "TransferShares";
    else if (topic0 === TOPIC_STABLECOIN_CONFIGURED)
      eventType = "StablecoinConfigured";
    else if (topic0 === TOPIC_CCTP_BURN_INITIATED)
      eventType = "CCTPBurnInitiated";
    else if (topic0 === TOPIC_MINT_EXECUTED) eventType = "MintExecuted";
    else if (topic0 === TOPIC_CIRCUIT_BREAKER_TRIGGERED)
      eventType = "CircuitBreakerTriggered";

    // Find the transaction record to link the event
    const tx = await this.prisma.transaction.findUnique({
      where: { hash: log.transactionHash },
      select: { id: true },
    });

    await this.prisma.event.upsert({
      where: {
        transactionHash_logIndex: {
          transactionHash: log.transactionHash,
          logIndex: log.index,
        },
      },
      update: {
        type: eventType,
        blockHeight: BigInt(log.blockNumber),
        transactionId: tx?.id ?? null,
        attributes: {
          address: log.address,
          topics: log.topics,
          data: log.data,
          logIndex: log.index,
          transactionHash: log.transactionHash,
        },
        sender: log.topics[1]
          ? "0x" + log.topics[1].slice(26).toLowerCase()
          : null,
        recipient: log.topics[2]
          ? "0x" + log.topics[2].slice(26).toLowerCase()
          : null,
        timestamp: blockTime,
      },
      create: {
        type: eventType,
        blockHeight: BigInt(log.blockNumber),
        transactionId: tx?.id ?? null,
        transactionHash: log.transactionHash,
        logIndex: log.index,
        attributes: {
          address: log.address,
          topics: log.topics,
          data: log.data,
          logIndex: log.index,
          transactionHash: log.transactionHash,
        },
        sender: log.topics[1]
          ? "0x" + log.topics[1].slice(26).toLowerCase()
          : null,
        recipient: log.topics[2]
          ? "0x" + log.topics[2].slice(26).toLowerCase()
          : null,
        timestamp: blockTime,
      },
    });
  }

  // -----------------------------------------------------------------------
  // Stablecoin Config Materialization
  // -----------------------------------------------------------------------

  /**
   * Read the full on-chain stablecoin config struct and rate-limit state
   * for a given `assetId`, then update the indexed StablecoinConfig row
   * with the authoritative values.
   *
   * Called after processing a `StablecoinConfigured` event so that fields
   * not carried in the event (mintCeilingPerEpoch, dailyTxLimit, etc.)
   * are materialized from the contract rather than left as zero/empty.
   *
   * Fields that do NOT exist on-chain (symbol, decimals, cctpDomain)
   * are resolved off-chain. The ReconciliationScheduler's
   * `backfillStablecoinSymbols()` method resolves `symbol` from the
   * backend's KNOWN_STABLECOIN_SYMBOLS registry (keccak256 reverse lookup)
   * on its next tick if the DB row has an empty string.
   *
   * A failed view call is fatal to the current block attempt so the indexer
   * retries without advancing its cursor.
   */
  private async refreshStablecoinConfig(
    assetId: string,
    blockTag: number,
  ): Promise<void> {
    if (!this.cfg.stablecoinBridgeAddress) return;

    try {
      const provider = this.getProvider();
      const bridge = new Contract(
        this.cfg.stablecoinBridgeAddress,
        BRIDGE_VIEW_ABI,
        provider,
      );

      // Read the full config struct and epoch usage in parallel.
      // The auto-generated `stablecoins(bytes32)` getter returns all
      // StablecoinConfig struct fields; `epochUsage(bytes32)` returns
      // the current epoch's minted amount and tx volume.
      const [configResult, usageResult] = await Promise.all([
        bridge.stablecoins(assetId, { blockTag }) as Promise<
          readonly [
            boolean, // enabled
            boolean, // mintPaused
            number, // routingType (uint8 enum)
            string, // token
            string, // tokenMessengerV2
            string, // messageTransmitterV2
            string, // proofOfReserveFeed
            bigint, // mintCeilingPerEpoch
            bigint, // dailyTxLimit
            number, // hourlyOutflowBps (uint16)
            number, // dailyOutflowBps (uint16)
            number, // porDeviationBps (uint16)
            number, // porHeartbeatSeconds (uint48)
          ]
        >,
        bridge.epochUsage(assetId, { blockTag }) as Promise<
          readonly [
            bigint, // epochId (uint64)
            bigint, // mintedAmount
            bigint, // txVolume
          ]
        >,
      ]);

      // Destructure the tuple — Solidity struct getters return positional tuples.
      const [
        enabled,
        mintPaused,
        routingType,
        token,
        _tokenMessengerV2,
        _messageTransmitterV2,
        _proofOfReserveFeed,
        mintCeilingPerEpoch,
        dailyTxLimit,
        _hourlyOutflowBps,
        _dailyOutflowBps,
        _porDeviationBps,
        _porHeartbeatSeconds,
      ] = configResult;

      const [_epochId, _mintedAmount, txVolume] = usageResult;

      await this.prisma.stablecoinConfig.update({
        where: { assetId },
        data: {
          tokenAddress: token.toLowerCase(),
          routingType: Number(routingType),
          active: enabled,
          maxBridgeAmount: mintCeilingPerEpoch.toString(),
          dailyLimit: dailyTxLimit.toString(),
          dailyUsed: txVolume.toString(),
          circuitBreakerTripped: Boolean(mintPaused),
          blockNumber: BigInt(blockTag),
          // Note: symbol is NOT on-chain — the ReconciliationScheduler's
          // backfillStablecoinSymbols() resolves it from KNOWN_STABLECOIN_SYMBOLS.
          // cctpDomain is also off-chain; left at its DB default.
        },
      });

      logger.info(
        `StablecoinConfig materialized from on-chain at block ${blockTag}: assetId=${assetId} ` +
          `enabled=${enabled} mintPaused=${mintPaused} routingType=${routingType} ` +
          `mintCeiling=${mintCeilingPerEpoch} dailyTxLimit=${dailyTxLimit} txVolume=${txVolume}`,
      );
    } catch (err) {
      logger.error(
        `Failed to materialize StablecoinConfig for assetId=${assetId}`,
        errorContext(err),
      );
      throw err;
    }
  }

  // -----------------------------------------------------------------------
  // Vault State Materialization
  // -----------------------------------------------------------------------

  /**
   * Query the vault contract's view functions and materialize a current
   * VaultState snapshot into the database.
   *
   * This is called after each block that contains vault events so that the
   * ReconciliationScheduler and any API consumers always see up-to-date
   * vault totals.  View-function reads are cheap and authoritative — they
   * avoid the fragile incremental bookkeeping that would otherwise drift
   * whenever the contract performs operations that aren't event-observable
   * (e.g. rebasing, admin fee collection).
   */
  private async refreshVaultState(blockTag: number): Promise<void> {
    if (!this.cfg.cruzibleVaultAddress) return;

    try {
      const provider = this.getProvider();
      const vault = new Contract(
        this.cfg.cruzibleVaultAddress,
        VAULT_VIEW_ABI,
        provider,
      );
      const viewOverrides = { blockTag };

      const [
        totalPooled,
        totalShares,
        exchangeRate,
        currentEpoch,
        unbonding,
        effectiveApyBps,
      ] = await Promise.all([
        vault.totalPooledAethel(viewOverrides) as Promise<bigint>,
        vault.totalShares(viewOverrides) as Promise<bigint>,
        vault.getExchangeRate(viewOverrides) as Promise<bigint>,
        vault.currentEpoch(viewOverrides) as Promise<bigint>,
        vault.unbondingPeriod(viewOverrides) as Promise<bigint>,
        vault.effectiveAPY(viewOverrides) as Promise<bigint>,
      ]);

      if (effectiveApyBps > BigInt(Number.MAX_SAFE_INTEGER)) {
        throw new Error(
          "Vault effectiveAPY exceeds safe materialization range",
        );
      }
      const currentApyPercent = Number(effectiveApyBps) / 100;

      // Count current stakers from the derived balance table
      const totalStakers = await this.prisma.stAethelBalance.count({
        where: {
          NOT: { shares: "0" },
        },
      });

      // Exchange rate is returned as a fixed-point value (1e18 = 1.0).
      // Convert to a decimal string using pure bigint arithmetic to avoid
      // precision loss — 1e18-scale values exceed Number.MAX_SAFE_INTEGER.
      const exchangeRateDecimal = formatFixedPoint18(exchangeRate);

      await this.prisma.vaultState.upsert({
        where: { id: VAULT_STATE_ID },
        update: {
          blockNumber: BigInt(blockTag),
          totalStaked: totalPooled.toString(),
          totalShares: totalShares.toString(),
          exchangeRate: exchangeRateDecimal,
          currentEpoch,
          currentApy: currentApyPercent,
          totalStakers: BigInt(totalStakers),
          // The vault has no validator-count getter on this contract line;
          // validator selection is not vault-resident. Reported as 0.
          validatorsBacking: 0,
          unbondingPeriod: Math.ceil(Number(unbonding) / 86_400),
        },
        create: {
          id: VAULT_STATE_ID,
          blockNumber: BigInt(blockTag),
          totalStaked: totalPooled.toString(),
          totalShares: totalShares.toString(),
          exchangeRate: exchangeRateDecimal,
          currentEpoch,
          currentApy: currentApyPercent,
          totalStakers: BigInt(totalStakers),
          // The vault has no validator-count getter on this contract line;
          // validator selection is not vault-resident. Reported as 0.
          validatorsBacking: 0,
          unbondingPeriod: Math.ceil(Number(unbonding) / 86_400),
        },
      });

      logger.info(
        `VaultState refreshed: totalStaked=${totalPooled} totalShares=${totalShares} ` +
          `exchangeRate=${exchangeRateDecimal} apyPercent=${currentApyPercent} ` +
          `epoch=${currentEpoch} unbondingSecs=${unbonding} stakers=${totalStakers}`,
      );
    } catch (err) {
      logger.error(
        "Failed to refresh VaultState from contract",
        errorContext(err),
      );
      throw err;
    }
  }

  // -----------------------------------------------------------------------
  // Provider Helper
  // -----------------------------------------------------------------------

  private getVerifiedNetworkBinding(): {
    chainId: string;
    anchorHash: string;
    vaultAddress: string;
    staethelAddress: string;
    stablecoinBridgeAddress: string;
  } {
    if (!this.verifiedHttpChainId || !this.verifiedHttpAnchorHash) {
      throw new Error(
        "Indexer network identity must be verified before cursor access",
      );
    }
    return {
      chainId: this.verifiedHttpChainId,
      anchorHash: this.verifiedHttpAnchorHash,
      vaultAddress:
        this.networkKeys?.identity.vaultAddress ??
        (this.cfg.cruzibleVaultAddress.trim().toLowerCase() || "no-vault"),
      staethelAddress:
        this.networkKeys?.identity.staethelAddress ??
        (this.cfg.staethelAddress.trim().toLowerCase() || "no-staethel"),
      stablecoinBridgeAddress:
        this.networkKeys?.identity.stablecoinBridgeAddress ??
        (this.cfg.stablecoinBridgeAddress.trim().toLowerCase() || "no-bridge"),
    };
  }

  private getSyncStateKey(): string {
    if (!this.networkKeys) {
      // Only reachable in isolated unit calls that bypass initialize(); the
      // production lifecycle verifies HTTP identity before any DB access.
      return "aethelred-evm";
    }
    return this.networkKeys.syncStateKey;
  }

  private getCursorKey(): string {
    return this.networkKeys?.cursorKey ?? CURSOR_KEY;
  }

  private getProvider(): JsonRpcProvider | WebSocketProvider {
    if (this.wsProvider && this._wsConnected) {
      return this.wsProvider;
    }
    if (this.httpProvider) {
      return this.httpProvider;
    }
    throw new Error("No EVM provider available");
  }

  // -----------------------------------------------------------------------
  // Retry Helper
  // -----------------------------------------------------------------------

  /** Execute `fn` with exponential backoff on failure. */
  private async withRetry<T>(fn: () => Promise<T>): Promise<T> {
    let attempt = 0;

    while (true) {
      try {
        return await fn();
      } catch (error: any) {
        attempt++;
        if (attempt >= MAX_RETRIES) {
          logger.error(
            `Max retries (${MAX_RETRIES}) exceeded`,
            errorContext(error),
          );
          throw error;
        }

        const delay = Math.min(
          BASE_RETRY_DELAY_MS * 2 ** attempt + Math.random() * 200,
          MAX_RETRY_DELAY_MS,
        );
        logger.warn(`Retry ${attempt}/${MAX_RETRIES} scheduled`, {
          delayMs: Math.round(delay),
          ...errorContext(error),
        });

        await this.sleep(delay);
      }
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
