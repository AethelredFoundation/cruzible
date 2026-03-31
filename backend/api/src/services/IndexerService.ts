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

import { injectable } from 'tsyringe';
import { PrismaClient } from '@prisma/client';
import {
  WebSocketProvider,
  JsonRpcProvider,
  TransactionReceipt,
  TransactionResponse,
  Log,
  Interface,
  Contract,
} from 'ethers';
import { logger } from '../utils/logger';
import { BlockchainService } from './BlockchainService';

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
const CURSOR_KEY = 'evm-indexer';

/** WebSocket reconnect delay (ms). */
const WS_RECONNECT_DELAY_MS = 3_000;

/** Maximum WebSocket reconnect attempts before falling back to polling. */
const WS_MAX_RECONNECT_ATTEMPTS = 20;

/** Fixed primary key for the singleton VaultState row. */
const VAULT_STATE_ID = 'cruzible-vault-state';

/** Default unbonding period (days) — matches the Cosmos SDK default. */
const DEFAULT_UNBONDING_PERIOD_DAYS = 21;

/**
 * Cruzible Vault view functions used to materialize VaultState.
 * These must match the canonical ICruzible.sol interface.
 */
const VAULT_VIEW_ABI = [
  'function getTotalPooledAethel() view returns (uint256)',
  'function getTotalShares() view returns (uint256)',
  'function getExchangeRate() view returns (uint256)',
  'function getActiveValidatorCount() view returns (uint256)',
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
  'function stablecoins(bytes32 assetId) view returns (bool enabled, bool mintPaused, uint8 routingType, address token, address tokenMessengerV2, address messageTransmitterV2, address proofOfReserveFeed, uint256 mintCeilingPerEpoch, uint256 dailyTxLimit, uint16 hourlyOutflowBps, uint16 dailyOutflowBps, uint16 porDeviationBps, uint48 porHeartbeatSeconds)',
  'function epochUsage(bytes32 assetId) view returns (uint64 epochId, uint256 mintedAmount, uint256 txVolume)',
];

/** 1e18 as a bigint constant for fixed-point arithmetic. */
const FIXED_POINT_SCALE = 10n ** 18n;

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
  const sign = isNegative ? '-' : '';
  return `${sign}${integerPart}.${fractionalPart.toString().padStart(18, '0')}`;
}

// ---------------------------------------------------------------------------
// Contract ABIs (event signatures only)
// ---------------------------------------------------------------------------

/**
 * Cruzible Vault contract events — must match the canonical ICruzible.sol
 * interface.  The signatures below determine topic hashes; any drift means
 * the indexer silently misses or misparses on-chain events.
 *
 *   event Staked(address indexed user, uint256 aethelAmount, uint256 sharesIssued, uint256 referralCode)
 *   event UnstakeRequested(address indexed user, uint256 shares, uint256 aethelAmount, uint256 indexed withdrawalId, uint256 completionTime)
 *   event Withdrawn(address indexed user, uint256 indexed withdrawalId, uint256 aethelAmount)
 *   event RewardsDistributed(uint256 indexed epoch, uint256 totalRewards, uint256 protocolFee, bytes32 rewardsMerkleRoot, bytes32 teeAttestationHash)
 */
const CRUZIBLE_VAULT_ABI = [
  'event Staked(address indexed user, uint256 aethelAmount, uint256 sharesIssued, uint256 referralCode)',
  'event UnstakeRequested(address indexed user, uint256 shares, uint256 aethelAmount, uint256 indexed withdrawalId, uint256 completionTime)',
  'event Withdrawn(address indexed user, uint256 indexed withdrawalId, uint256 aethelAmount)',
  'event RewardsDistributed(uint256 indexed epoch, uint256 totalRewards, uint256 protocolFee, bytes32 rewardsMerkleRoot, bytes32 teeAttestationHash)',
];

/**
 * StAETHEL ERC-20 Transfer event:
 *   event Transfer(address indexed from, address indexed to, uint256 value)
 */
const STAETHEL_ABI = [
  'event Transfer(address indexed from, address indexed to, uint256 value)',
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
  'event StablecoinConfigured(bytes32 indexed assetId, address indexed token, uint8 routingType, bool enabled)',
  'event CCTPBurnInitiated(bytes32 indexed assetId, address indexed sender, uint32 indexed destinationDomain, uint256 amount, uint64 cctpNonce)',
  'event MintExecuted(bytes32 indexed assetId, bytes32 indexed mintOperationId, address indexed recipient, uint256 amount)',
  'event CircuitBreakerTriggered(bytes32 indexed assetId, bytes32 indexed reasonCode, uint256 observed, uint256 threshold)',
];

const cruzibleIface = new Interface(CRUZIBLE_VAULT_ABI);
const staethelIface = new Interface(STAETHEL_ABI);
const bridgeIface = new Interface(STABLECOIN_BRIDGE_ABI);

// Topic hashes for fast log filtering
const TOPIC_STAKED = cruzibleIface.getEvent('Staked')!.topicHash;
const TOPIC_UNSTAKE_REQUESTED = cruzibleIface.getEvent('UnstakeRequested')!.topicHash;
const TOPIC_WITHDRAWN = cruzibleIface.getEvent('Withdrawn')!.topicHash;
const TOPIC_REWARDS_DISTRIBUTED = cruzibleIface.getEvent('RewardsDistributed')!.topicHash;
const TOPIC_TRANSFER = staethelIface.getEvent('Transfer')!.topicHash;

// Stablecoin bridge event topics
const TOPIC_STABLECOIN_CONFIGURED = bridgeIface.getEvent('StablecoinConfigured')!.topicHash;
const TOPIC_CCTP_BURN_INITIATED = bridgeIface.getEvent('CCTPBurnInitiated')!.topicHash;
const TOPIC_MINT_EXECUTED = bridgeIface.getEvent('MintExecuted')!.topicHash;
const TOPIC_CIRCUIT_BREAKER_TRIGGERED = bridgeIface.getEvent('CircuitBreakerTriggered')!.topicHash;

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
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

@injectable()
export class IndexerService {
  private prisma: PrismaClient;
  private wsProvider: WebSocketProvider | null = null;
  private httpProvider: JsonRpcProvider | null = null;
  private running = false;
  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private wsReconnectAttempts = 0;
  private shutdownPromiseResolve: (() => void) | null = null;
  private processingLock = false;

  // Config — populated from env in initialize()
  private cfg: IndexerConfig = {
    wsUrl: '',
    rpcUrl: '',
    cruzibleVaultAddress: '',
    staethelAddress: '',
    stablecoinBridgeAddress: '',
    startBlock: 0,
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
    logger.info('IndexerService initializing...');

    // Load config from environment
    this.cfg = {
      wsUrl: process.env.INDEXER_WS_URL || process.env.WS_URL || 'ws://127.0.0.1:8546',
      rpcUrl: process.env.INDEXER_RPC_URL || process.env.RPC_URL || 'http://127.0.0.1:8545',
      cruzibleVaultAddress: process.env.CRUZIBLE_VAULT_ADDRESS || '',
      staethelAddress: process.env.STAETHEL_ADDRESS || '',
      stablecoinBridgeAddress: process.env.STABLECOIN_BRIDGE_ADDRESS || '',
      startBlock: parseInt(process.env.INDEXER_START_BLOCK || '0', 10),
    };

    if (!this.cfg.cruzibleVaultAddress) {
      logger.warn(
        'CRUZIBLE_VAULT_ADDRESS not set — vault event indexing disabled. ' +
        'Set this env var to enable Staked/Unstaked/Withdrawn/RewardsClaimed indexing.',
      );
    }
    if (!this.cfg.staethelAddress) {
      logger.warn(
        'STAETHEL_ADDRESS not set — StAETHEL transfer indexing disabled. ' +
        'Set this env var to enable Transfer event indexing.',
      );
    }
    if (!this.cfg.stablecoinBridgeAddress) {
      logger.warn(
        'STABLECOIN_BRIDGE_ADDRESS not set — stablecoin bridge event indexing disabled. ' +
        'Set this env var to enable CCTPBurnInitiated/StablecoinConfigured/MintExecuted indexing.',
      );
    }

    // Create HTTP provider (always available as fallback)
    this.httpProvider = new JsonRpcProvider(this.cfg.rpcUrl);

    // Recover sync state
    await this.ensureCursor();

    // Start the indexer
    this.running = true;

    // Attempt WebSocket connection first
    await this.connectWebSocket();

    // If WS failed, fall back to polling immediately
    if (!this._wsConnected) {
      logger.info('WebSocket not available, starting in polling mode');
      this.schedulePollTick(0);
    }

    logger.info('IndexerService started', {
      wsUrl: this.cfg.wsUrl,
      rpcUrl: this.cfg.rpcUrl,
      cruzibleVault: this.cfg.cruzibleVaultAddress || '(disabled)',
      staethel: this.cfg.staethelAddress || '(disabled)',
      stablecoinBridge: this.cfg.stablecoinBridgeAddress || '(disabled)',
      indexedHead: this._indexedHead,
    });
  }

  async shutdown(): Promise<void> {
    logger.info('IndexerService shutting down...');
    this.running = false;

    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
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
      try {
        this.wsProvider.removeAllListeners();
        await this.wsProvider.destroy();
      } catch {
        // Ignore cleanup errors
      }
      this.wsProvider = null;
    }

    await this.prisma.$disconnect();
    logger.info('IndexerService stopped');
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

  private async connectWebSocket(): Promise<void> {
    if (!this.cfg.wsUrl || !this.running) return;

    try {
      this.wsProvider = new WebSocketProvider(this.cfg.wsUrl);

      // Wait for the provider to be ready (ethers v6)
      const network = await this.wsProvider.getNetwork();
      this._wsConnected = true;
      this.wsReconnectAttempts = 0;

      logger.info('WebSocket connected', {
        url: this.cfg.wsUrl,
        chainId: network.chainId.toString(),
      });

      // Subscribe to new blocks
      this.wsProvider.on('block', (blockNumber: number) => {
        this.onNewBlock(blockNumber).catch((err) => {
          logger.error('Error processing new block from WebSocket:', err);
        });
      });

      // Handle provider errors (ethers v6 uses 'error' event on the provider)
      this.wsProvider.on('error', (err: Error) => {
        logger.error('WebSocket provider error:', err.message);
        this.handleWsDisconnect();
      });

      // In ethers v6, detect disconnection via the websocket property
      const ws = (this.wsProvider as any)._websocket ?? (this.wsProvider as any).websocket;
      if (ws && typeof ws.on === 'function') {
        ws.on('close', () => {
          logger.warn('WebSocket connection closed');
          this.handleWsDisconnect();
        });
        ws.on('error', (err: Error) => {
          logger.error('WebSocket transport error:', err.message);
          this.handleWsDisconnect();
        });
      }
    } catch (error) {
      logger.error('Failed to connect WebSocket:', error);
      this._wsConnected = false;
    }
  }

  private handleWsDisconnect(): void {
    this._wsConnected = false;

    if (!this.running) return;

    this.wsReconnectAttempts++;

    if (this.wsReconnectAttempts > WS_MAX_RECONNECT_ATTEMPTS) {
      logger.warn(
        `WebSocket reconnect attempts exhausted (${WS_MAX_RECONNECT_ATTEMPTS}), ` +
        'falling back to polling mode',
      );
      this.schedulePollTick(0);
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

    setTimeout(() => {
      if (this.running) {
        this.connectWebSocket().catch(() => {
          // If reconnect fails, start polling
          if (!this._wsConnected && this.running) {
            this.schedulePollTick(0);
          }
        });
      }
    }, delay);
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
    if (!this.running || this._wsConnected) return;

    this.pollTimer = setTimeout(async () => {
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
      const delay = this.lag > CONFIRMATION_DEPTH + 1
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

    if (incomingBlock.parentHash.toLowerCase() !== previousBlock.hash.toLowerCase()) {
      // Reorg detected! Walk back to find the divergence point
      logger.warn(
        `Reorg detected at block ${blockNumber}: ` +
        `expected parent ${previousBlock.hash}, ` +
        `got ${incomingBlock.parentHash}`,
      );

      let divergenceBlock = blockNumber - 1;
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
          break;
        }

        divergenceBlock = checkBlockNum;
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
    const chainBlock = await this.withRetry(() =>
      provider.getBlock(fromBlock),
    );

    await this.prisma.reorgEvent.create({
      data: {
        fromBlock: BigInt(fromBlock),
        toBlock: BigInt(currentTarget),
        expectedHash: storedBlock?.hash ?? '0x0',
        actualHash: chainBlock?.hash ?? '0x0',
        depth,
      },
    });

    // Delete all indexed data from the reorg point onwards
    await this.rollbackFromBlock(fromBlock);

    // Update cursor to point before the reorg
    const newHead = fromBlock - 1;
    this._indexedHead = newHead;
    await this.updateCursor(newHead);

    logger.info(`Reorg rollback complete. Resuming from block ${newHead + 1}`);

    // Re-index from the divergence point
    await this.processBlockRange(fromBlock, currentTarget);
  }

  /**
   * Delete all indexed data at or after the given block number.
   */
  private async rollbackFromBlock(fromBlock: number): Promise<void> {
    const fromHeight = BigInt(fromBlock);

    // Use a transaction for atomicity — delete reorged rows.
    await this.prisma.$transaction([
      // Delete StAETHEL transfers
      this.prisma.stAethelTransfer.deleteMany({
        where: { blockNumber: { gte: fromHeight } },
      }),
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
    ]);

    // StAethelBalance is a derived aggregate maintained incrementally by
    // handleTransferEvent → updateStAethelBalance.  After deleting reorged
    // StAethelTransfer rows the balances are stale and must be rebuilt from
    // the surviving transfer set.  A full rebuild is correct regardless of
    // reorg depth and avoids subtle off-by-one drift.
    await this.rebuildStAethelBalances();
  }

  /**
   * Rebuild the entire StAethelBalance table from the surviving
   * StAethelTransfer rows.  Called after reorg rollback to avoid leaving
   * derived balances in a corrupted state.
   */
  private async rebuildStAethelBalances(): Promise<void> {
    logger.info('Rebuilding StAethelBalance from surviving transfers…');

    // Wipe the derived table
    await this.prisma.stAethelBalance.deleteMany({});

    // Re-aggregate in the application layer.  For very large transfer tables
    // this could be replaced with a raw SQL aggregation, but correctness is
    // more important than speed during a reorg (which should be rare).
    const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

    const transfers = await this.prisma.stAethelTransfer.findMany({
      select: { from: true, to: true, amount: true, txHash: true, blockNumber: true, logIndex: true },
      orderBy: [{ blockNumber: 'asc' }, { logIndex: 'asc' }],
    });

    const balances = new Map<string, bigint>();
    const lastTx = new Map<string, { txHash: string; blockNumber: bigint }>();

    for (const tx of transfers) {
      const amt = BigInt(tx.amount);

      if (tx.from !== ZERO_ADDRESS) {
        const prev = balances.get(tx.from) ?? 0n;
        const next = prev - amt;
        balances.set(tx.from, next < 0n ? 0n : next);
        lastTx.set(tx.from, { txHash: tx.txHash, blockNumber: tx.blockNumber });
      }

      if (tx.to !== ZERO_ADDRESS) {
        balances.set(tx.to, (balances.get(tx.to) ?? 0n) + amt);
        lastTx.set(tx.to, { txHash: tx.txHash, blockNumber: tx.blockNumber });
      }
    }

    // Write back non-zero balances
    const upserts = [...balances.entries()]
      .filter(([, bal]) => bal > 0n)
      .map(([holder, bal]) => {
        const meta = lastTx.get(holder)!;
        return this.prisma.stAethelBalance.create({
          data: {
            holder,
            balance: bal.toString(),
            lastTxHash: meta.txHash,
            lastBlockNumber: meta.blockNumber,
          },
        });
      });

    // Batch in groups of 100 to avoid overwhelming the connection pool
    for (let i = 0; i < upserts.length; i += 100) {
      await this.prisma.$transaction(upserts.slice(i, i + 100));
    }

    logger.info(`StAethelBalance rebuilt: ${upserts.length} holders with non-zero balance`);
  }

  // -----------------------------------------------------------------------
  // Cursor Persistence
  // -----------------------------------------------------------------------

  private async ensureCursor(): Promise<void> {
    const cursor = await this.prisma.indexerCursor.findUnique({
      where: { cursorKey: CURSOR_KEY },
    });

    if (cursor) {
      this._indexedHead = Number(cursor.blockNumber);
      logger.info(`Resuming from cursor: block ${this._indexedHead}`);
    } else {
      // First run — use configured start block or 0
      const startBlock = Math.max(0, this.cfg.startBlock - 1);
      await this.prisma.indexerCursor.create({
        data: {
          cursorKey: CURSOR_KEY,
          blockNumber: BigInt(startBlock),
          blockHash: '0x0',
          timestamp: new Date(0),
        },
      });
      this._indexedHead = startBlock;
      logger.info(`Created initial cursor at block ${startBlock}`);
    }

    // Also update the legacy SyncState for backward compatibility
    await this.prisma.syncState.upsert({
      where: { chainId: 'aethelred-evm' },
      update: {},
      create: {
        chainId: 'aethelred-evm',
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
    await this.prisma.indexerCursor.update({
      where: { cursorKey: CURSOR_KEY },
      data: {
        blockNumber: BigInt(blockNumber),
        blockHash: blockHash ?? '0x0',
        timestamp: blockTimestamp ?? new Date(),
      },
    });

    // Update legacy SyncState
    await this.prisma.syncState.upsert({
      where: { chainId: 'aethelred-evm' },
      update: {
        lastBlockHeight: BigInt(blockNumber),
        lastBlockTime: blockTimestamp ?? new Date(),
        isSyncing: this.lag > 10,
      },
      create: {
        chainId: 'aethelred-evm',
        lastBlockHeight: BigInt(blockNumber),
        lastBlockTime: blockTimestamp ?? new Date(),
        isSyncing: this.lag > 10,
      },
    });

    this._indexedHead = blockNumber;
    this._lastIndexedAt = new Date();
  }

  // -----------------------------------------------------------------------
  // Block Indexing
  // -----------------------------------------------------------------------

  private async indexBlockWithRetry(blockNumber: number): Promise<void> {
    await this.withRetry(() => this.indexBlock(blockNumber));
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

    // Upsert block (idempotent)
    await this.prisma.block.upsert({
      where: { height: BigInt(blockNumber) },
      update: {
        hash: blockHash,
        parentHash,
        timestamp: blockTime,
        proposer: block.miner ?? '',
        txCount: block.transactions.length,
        gasUsed: BigInt(block.gasUsed),
        gasLimit: BigInt(block.gasLimit),
        size: 0, // EVM blocks don't expose size directly via ethers
        appHash: block.stateRoot ?? '',
        stateRoot: block.stateRoot,
      },
      create: {
        height: BigInt(blockNumber),
        hash: blockHash,
        parentHash,
        timestamp: blockTime,
        proposer: block.miner ?? '',
        txCount: block.transactions.length,
        gasUsed: BigInt(block.gasUsed),
        gasLimit: BigInt(block.gasLimit),
        size: 0,
        appHash: block.stateRoot ?? '',
        stateRoot: block.stateRoot,
      },
    });
    this._blocksIndexedTotal++;

    // Index transactions
    if (block.prefetchedTransactions && block.prefetchedTransactions.length > 0) {
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
    const status = receipt ? (receipt.status === 1 ? 'SUCCESS' : 'FAILED') : 'PENDING';
    const gasUsed = receipt ? BigInt(receipt.gasUsed) : BigInt(0);

    await this.prisma.transaction.upsert({
      where: { hash: txHash },
      update: {
        status: status as any,
        gasUsed,
        gasWanted: BigInt(tx.gasLimit),
        gasPrice: tx.gasPrice?.toString() ?? null,
        fee: receipt
          ? (BigInt(receipt.gasUsed) * (receipt.gasPrice ?? BigInt(0))).toString()
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
          ? (BigInt(receipt.gasUsed) * (receipt.gasPrice ?? BigInt(0))).toString()
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
      // stAETHEL Transfer events change the derived totalStakers count.
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
    // contained vault events OR stAETHEL transfers.  Vault events
    // change totals/exchange rate; transfers change the derived
    // totalStakers count and stAethelBalance table.  View-function
    // reads are cheap and authoritative, so calling on transfer-only
    // blocks is harmless — the vault totals will be unchanged and the
    // upsert simply updates totalStakers + updatedAt.
    if (sawRelevantEvent) {
      await this.refreshVaultState();
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
        } else if (topic0 === TOPIC_UNSTAKE_REQUESTED) {
          await this.handleUnstakeRequestedEvent(log, blockTime);
        } else if (topic0 === TOPIC_WITHDRAWN) {
          await this.handleWithdrawnEvent(log, blockTime);
        } else if (topic0 === TOPIC_REWARDS_DISTRIBUTED) {
          await this.handleRewardsDistributedEvent(log);
        }
      }

      // ---- StAETHEL Transfer Events ----
      if (
        this.cfg.staethelAddress &&
        contractAddress === this.cfg.staethelAddress.toLowerCase()
      ) {
        if (topic0 === TOPIC_TRANSFER) {
          await this.handleTransferEvent(log, blockTime);
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
    }
  }

  // -----------------------------------------------------------------------
  // Cruzible Vault Event Handlers
  // -----------------------------------------------------------------------

  /**
   * Handle: Staked(address indexed user, uint256 aethelAmount, uint256 sharesIssued, uint256 referralCode)
   */
  private async handleStakedEvent(log: Log, blockTime: Date): Promise<void> {
    const parsed = cruzibleIface.parseLog({
      topics: [...log.topics],
      data: log.data,
    });
    if (!parsed) return;

    const staker = parsed.args[0].toLowerCase();        // user (indexed)
    const amount = parsed.args[1].toString();            // aethelAmount
    const shares = parsed.args[2].toString();            // sharesIssued
    // parsed.args[3] = referralCode (not persisted)

    await this.prisma.vaultStake.upsert({
      where: { txHash: log.transactionHash },
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
   * Handle: UnstakeRequested(address indexed user, uint256 shares, uint256 aethelAmount, uint256 indexed withdrawalId, uint256 completionTime)
   *
   * The on-chain `withdrawalId` is the unique identity of each withdrawal
   * request.  A single transaction can emit multiple UnstakeRequested events
   * (e.g. via `batchUnstake()`), so we key by `withdrawalId`, not `txHash`.
   */
  private async handleUnstakeRequestedEvent(log: Log, blockTime: Date): Promise<void> {
    const parsed = cruzibleIface.parseLog({
      topics: [...log.topics],
      data: log.data,
    });
    if (!parsed) return;

    const staker = parsed.args[0].toLowerCase();         // user (indexed)
    const shares = parsed.args[1].toString();             // shares
    const amount = parsed.args[2].toString();             // aethelAmount
    const withdrawalId = BigInt(parsed.args[3].toString()); // withdrawalId (indexed)
    const completionTimestamp = parsed.args[4];            // completionTime (uint256 unix seconds)
    const completionTime = new Date(Number(completionTimestamp) * 1000);

    await this.prisma.vaultUnstake.upsert({
      where: { withdrawalId },
      update: {
        delegator: staker,
        shares,
        amount,
        startTime: blockTime,
        completionTime,
        status: 'PENDING',
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
        status: 'PENDING',
        blockNumber: BigInt(log.blockNumber),
        logIndex: log.index,
      },
    });

    logger.info(
      `UnstakeRequested: ${staker} withdrawalId=${withdrawalId} shares=${shares} amount=${amount} tx=${log.transactionHash}`,
    );
  }

  /**
   * Handle: Withdrawn(address indexed user, uint256 indexed withdrawalId, uint256 aethelAmount)
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

    const staker = parsed.args[0].toLowerCase();         // user (indexed)
    const withdrawalId = BigInt(parsed.args[1].toString()); // withdrawalId (indexed)
    const amount = parsed.args[2].toString();             // aethelAmount

    await this.prisma.vaultWithdrawal.upsert({
      where: { withdrawalId },
      update: {
        delegator: staker,
        amount,
        timestamp: blockTime,
        blockNumber: BigInt(log.blockNumber),
        logIndex: log.index,
      },
      create: {
        withdrawalId,
        delegator: staker,
        amount,
        txHash: log.transactionHash,
        timestamp: blockTime,
        blockNumber: BigInt(log.blockNumber),
        logIndex: log.index,
      },
    });

    // Mark the SPECIFIC unstake request as CLAIMED by withdrawalId.
    // Using updateMany avoids throwing if the UnstakeRequested event was
    // missed (e.g. gap in indexing) — it simply updates zero rows.
    await this.prisma.vaultUnstake.updateMany({
      where: { withdrawalId },
      data: {
        status: 'CLAIMED',
        claimTxHash: log.transactionHash,
        claimedAt: blockTime,
      },
    });

    logger.info(
      `Withdrawn: ${staker} withdrawalId=${withdrawalId} amount=${amount} tx=${log.transactionHash}`,
    );
  }

  /**
   * Handle: RewardsDistributed(uint256 indexed epoch, uint256 totalRewards, uint256 protocolFee, bytes32 rewardsMerkleRoot, bytes32 teeAttestationHash)
   *
   * This is a vault-level event (not per-staker).  The contract's
   * `claimRewards()` does NOT emit an event, so individual claims are not
   * observable from events alone.  We log the epoch-level reward distribution;
   * the generic event persistence in `persistEventLog` stores the full log
   * for downstream consumers.
   */
  private async handleRewardsDistributedEvent(log: Log): Promise<void> {
    const parsed = cruzibleIface.parseLog({
      topics: [...log.topics],
      data: log.data,
    });
    if (!parsed) return;

    const epoch = parsed.args[0];                         // epoch (indexed)
    const totalRewards = parsed.args[1].toString();       // totalRewards
    const protocolFee = parsed.args[2].toString();        // protocolFee

    logger.info(
      `RewardsDistributed: epoch=${epoch} totalRewards=${totalRewards} ` +
      `protocolFee=${protocolFee} tx=${log.transactionHash}`,
    );
  }

  // -----------------------------------------------------------------------
  // StAETHEL Transfer Handling
  // -----------------------------------------------------------------------

  private async handleTransferEvent(log: Log, blockTime: Date): Promise<void> {
    const parsed = staethelIface.parseLog({
      topics: [...log.topics],
      data: log.data,
    });
    if (!parsed) return;

    const from = parsed.args[0].toLowerCase();
    const to = parsed.args[1].toLowerCase();
    const value = parsed.args[2].toString();

    // Store the transfer
    await this.prisma.stAethelTransfer.upsert({
      where: {
        txHash_logIndex: {
          txHash: log.transactionHash,
          logIndex: log.index,
        },
      },
      update: {
        from,
        to,
        amount: value,
        blockNumber: BigInt(log.blockNumber),
        timestamp: blockTime,
      },
      create: {
        from,
        to,
        amount: value,
        txHash: log.transactionHash,
        logIndex: log.index,
        blockNumber: BigInt(log.blockNumber),
        timestamp: blockTime,
      },
    });

    // Update sender balance (subtract)
    const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
    if (from !== ZERO_ADDRESS) {
      await this.updateStAethelBalance(from, `-${value}`, log);
    }

    // Update receiver balance (add)
    if (to !== ZERO_ADDRESS) {
      await this.updateStAethelBalance(to, value, log);
    }
  }

  private async updateStAethelBalance(
    holder: string,
    delta: string,
    log: Log,
  ): Promise<void> {
    const existing = await this.prisma.stAethelBalance.findUnique({
      where: { holder },
    });

    const currentBalance = existing ? BigInt(existing.balance) : BigInt(0);
    const deltaValue = BigInt(delta);
    const newBalance = currentBalance + deltaValue;

    // Clamp to zero (safety)
    const finalBalance = newBalance < BigInt(0) ? BigInt(0) : newBalance;

    await this.prisma.stAethelBalance.upsert({
      where: { holder },
      update: {
        balance: finalBalance.toString(),
        lastTxHash: log.transactionHash,
        lastBlockNumber: BigInt(log.blockNumber),
      },
      create: {
        holder,
        balance: finalBalance.toString(),
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

    const assetId = parsed.args[0];                       // bytes32 (indexed)
    const tokenAddress = parsed.args[1].toLowerCase();    // address (indexed)
    const routingType = Number(parsed.args[2]);           // uint8
    const enabled = parsed.args[3] as boolean;            // bool

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
        symbol: '', // Placeholder — refreshStablecoinConfig() backfills from on-chain state
        tokenAddress,
        routingType,
        maxBridgeAmount: '0',
        dailyLimit: '0',
        dailyUsed: '0',
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
    // This mirrors the refreshVaultState() pattern — non-fatal on failure.
    await this.refreshStablecoinConfig(assetId);
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

    const assetId = parsed.args[0];                       // bytes32 (indexed)
    const sender = parsed.args[1].toLowerCase();          // address (indexed)
    const destinationDomain = Number(parsed.args[2]);     // uint32 (indexed)
    const amount = parsed.args[3].toString();             // uint256
    const cctpNonce = parsed.args[4].toString();          // uint64

    await this.prisma.stablecoinBridgeEvent.upsert({
      where: {
        txHash_logIndex: {
          txHash: log.transactionHash,
          logIndex: log.index,
        },
      },
      update: {
        assetId,
        eventType: 'CCTPBurnInitiated',
        sender,
        amount,
        destDomain: destinationDomain,
        blockNumber: BigInt(log.blockNumber),
        timestamp: blockTime,
        metadata: { cctpNonce },
      },
      create: {
        assetId,
        eventType: 'CCTPBurnInitiated',
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

    // Track daily usage for the asset
    await this.incrementDailyUsage(assetId, amount);

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

    const assetId = parsed.args[0];                       // bytes32 (indexed)
    const mintOperationId = parsed.args[1];               // bytes32 (indexed)
    const recipient = parsed.args[2].toLowerCase();       // address (indexed)
    const amount = parsed.args[3].toString();             // uint256

    await this.prisma.stablecoinBridgeEvent.upsert({
      where: {
        txHash_logIndex: {
          txHash: log.transactionHash,
          logIndex: log.index,
        },
      },
      update: {
        assetId,
        eventType: 'MintExecuted',
        sender: recipient, // recipient is the beneficiary
        amount,
        blockNumber: BigInt(log.blockNumber),
        timestamp: blockTime,
        metadata: { mintOperationId },
      },
      create: {
        assetId,
        eventType: 'MintExecuted',
        sender: recipient,
        amount,
        txHash: log.transactionHash,
        logIndex: log.index,
        blockNumber: BigInt(log.blockNumber),
        timestamp: blockTime,
        metadata: { mintOperationId },
      },
    });

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

    const assetId = parsed.args[0];                       // bytes32 (indexed)
    const reasonCode = parsed.args[1];                    // bytes32 (indexed)
    const observed = parsed.args[2].toString();           // uint256
    const threshold = parsed.args[3].toString();          // uint256

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
        eventType: 'CircuitBreakerTriggered',
        sender: log.address.toLowerCase(), // bridge contract itself
        amount: observed,
        blockNumber: BigInt(log.blockNumber),
        timestamp: blockTime,
        metadata: { reasonCode, observed, threshold },
      },
      create: {
        assetId,
        eventType: 'CircuitBreakerTriggered',
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

    logger.warn(
      `CircuitBreakerTriggered: assetId=${assetId} reason=${reasonCode} ` +
      `observed=${observed} threshold=${threshold} tx=${log.transactionHash}`,
    );
  }

  /**
   * Increment the daily usage counter for a stablecoin asset.
   * Resets the counter if the last reset was on a previous UTC day.
   */
  private async incrementDailyUsage(
    assetId: string,
    amount: string,
  ): Promise<void> {
    const config = await this.prisma.stablecoinConfig.findUnique({
      where: { assetId },
    });
    if (!config) return;

    const now = new Date();
    const lastReset = config.lastResetTimestamp;
    const isNewDay =
      !lastReset ||
      lastReset.toISOString().slice(0, 10) !== now.toISOString().slice(0, 10);

    const currentUsed = isNewDay ? BigInt(0) : BigInt(config.dailyUsed);
    const newUsed = currentUsed + BigInt(amount);

    await this.prisma.stablecoinConfig.update({
      where: { assetId },
      data: {
        dailyUsed: newUsed.toString(),
        lastResetTimestamp: isNewDay ? now : undefined,
      },
    });
  }

  // -----------------------------------------------------------------------
  // Generic Event Persistence
  // -----------------------------------------------------------------------

  private async persistEventLog(log: Log, blockTime: Date): Promise<void> {
    const topic0 = log.topics[0];

    // Determine a readable event type
    let eventType = 'Unknown';
    if (topic0 === TOPIC_STAKED) eventType = 'Staked';
    else if (topic0 === TOPIC_UNSTAKE_REQUESTED) eventType = 'UnstakeRequested';
    else if (topic0 === TOPIC_WITHDRAWN) eventType = 'Withdrawn';
    else if (topic0 === TOPIC_REWARDS_DISTRIBUTED) eventType = 'RewardsDistributed';
    else if (topic0 === TOPIC_TRANSFER) eventType = 'Transfer';
    else if (topic0 === TOPIC_STABLECOIN_CONFIGURED) eventType = 'StablecoinConfigured';
    else if (topic0 === TOPIC_CCTP_BURN_INITIATED) eventType = 'CCTPBurnInitiated';
    else if (topic0 === TOPIC_MINT_EXECUTED) eventType = 'MintExecuted';
    else if (topic0 === TOPIC_CIRCUIT_BREAKER_TRIGGERED) eventType = 'CircuitBreakerTriggered';

    // Find the transaction record to link the event
    const tx = await this.prisma.transaction.findUnique({
      where: { hash: log.transactionHash },
      select: { id: true },
    });

    await this.prisma.event.create({
      data: {
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
          ? '0x' + log.topics[1].slice(26).toLowerCase()
          : null,
        recipient: log.topics[2]
          ? '0x' + log.topics[2].slice(26).toLowerCase()
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
   * Non-fatal: if the view call fails (e.g. contract not yet deployed in
   * test environments), the row retains the event-derived fields and the
   * ReconciliationScheduler will detect the drift on its next tick.
   */
  private async refreshStablecoinConfig(assetId: string): Promise<void> {
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
        bridge.stablecoins(assetId) as Promise<readonly [
          boolean,   // enabled
          boolean,   // mintPaused
          number,    // routingType (uint8 enum)
          string,    // token
          string,    // tokenMessengerV2
          string,    // messageTransmitterV2
          string,    // proofOfReserveFeed
          bigint,    // mintCeilingPerEpoch
          bigint,    // dailyTxLimit
          number,    // hourlyOutflowBps (uint16)
          number,    // dailyOutflowBps (uint16)
          number,    // porDeviationBps (uint16)
          number,    // porHeartbeatSeconds (uint48)
        ]>,
        bridge.epochUsage(assetId) as Promise<readonly [
          bigint,    // epochId (uint64)
          bigint,    // mintedAmount
          bigint,    // txVolume
        ]>,
      ]);

      // Destructure the tuple — Solidity struct getters return positional tuples.
      const [
        enabled, _mintPaused, routingType, token,
        _tokenMessengerV2, _messageTransmitterV2, _proofOfReserveFeed,
        mintCeilingPerEpoch, dailyTxLimit,
        _hourlyOutflowBps, _dailyOutflowBps,
        _porDeviationBps, _porHeartbeatSeconds,
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
          // Note: symbol is NOT on-chain — the ReconciliationScheduler's
          // backfillStablecoinSymbols() resolves it from KNOWN_STABLECOIN_SYMBOLS.
          // cctpDomain is also off-chain; left at its DB default.
        },
      });

      logger.info(
        `StablecoinConfig materialized from on-chain: assetId=${assetId} ` +
        `enabled=${enabled} routingType=${routingType} ` +
        `mintCeiling=${mintCeilingPerEpoch} dailyTxLimit=${dailyTxLimit} txVolume=${txVolume}`,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error(
        `Failed to materialize StablecoinConfig for assetId=${assetId}`,
        { error: message },
      );
      // Non-fatal — config retains event-derived fields. ReconciliationScheduler
      // will detect the incomplete state on its next tick.
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
  private async refreshVaultState(): Promise<void> {
    if (!this.cfg.cruzibleVaultAddress) return;

    try {
      const provider = this.getProvider();
      const vault = new Contract(
        this.cfg.cruzibleVaultAddress,
        VAULT_VIEW_ABI,
        provider,
      );

      const [totalPooled, totalShares, exchangeRate, activeValidators] =
        await Promise.all([
          vault.getTotalPooledAethel() as Promise<bigint>,
          vault.getTotalShares() as Promise<bigint>,
          vault.getExchangeRate() as Promise<bigint>,
          vault.getActiveValidatorCount() as Promise<bigint>,
        ]);

      // Count current stakers from the derived balance table
      const totalStakers = await this.prisma.stAethelBalance.count({
        where: {
          NOT: { balance: '0' },
        },
      });

      // Exchange rate is returned as a fixed-point value (1e18 = 1.0).
      // Convert to a decimal string using pure bigint arithmetic to avoid
      // precision loss — 1e18-scale values exceed Number.MAX_SAFE_INTEGER.
      const exchangeRateDecimal = formatFixedPoint18(exchangeRate);

      await this.prisma.vaultState.upsert({
        where: { id: VAULT_STATE_ID },
        update: {
          totalStaked: totalPooled.toString(),
          totalShares: totalShares.toString(),
          exchangeRate: exchangeRateDecimal,
          currentApy: 0, // APY requires multi-epoch tracking — left for a future enhancement
          totalStakers: BigInt(totalStakers),
          validatorsBacking: Number(activeValidators),
          unbondingPeriod: DEFAULT_UNBONDING_PERIOD_DAYS,
        },
        create: {
          id: VAULT_STATE_ID,
          totalStaked: totalPooled.toString(),
          totalShares: totalShares.toString(),
          exchangeRate: exchangeRateDecimal,
          currentApy: 0,
          totalStakers: BigInt(totalStakers),
          validatorsBacking: Number(activeValidators),
          unbondingPeriod: DEFAULT_UNBONDING_PERIOD_DAYS,
        },
      });

      logger.info(
        `VaultState refreshed: totalStaked=${totalPooled} totalShares=${totalShares} ` +
        `exchangeRate=${exchangeRateDecimal} validators=${activeValidators} stakers=${totalStakers}`,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error('Failed to refresh VaultState from contract', { error: message });
      // Non-fatal — vault state will be stale until the next successful refresh.
      // The ReconciliationScheduler gracefully handles null/stale vault state.
    }
  }

  // -----------------------------------------------------------------------
  // Provider Helper
  // -----------------------------------------------------------------------

  private getProvider(): JsonRpcProvider | WebSocketProvider {
    if (this.wsProvider && this._wsConnected) {
      return this.wsProvider;
    }
    if (this.httpProvider) {
      return this.httpProvider;
    }
    throw new Error('No EVM provider available');
  }

  // -----------------------------------------------------------------------
  // Retry Helper
  // -----------------------------------------------------------------------

  /**
   * Execute `fn` with exponential backoff on failure.
   * Prisma unique constraint violations (P2002) are swallowed for idempotency.
   */
  private async withRetry<T>(fn: () => Promise<T>): Promise<T> {
    let attempt = 0;

    while (true) {
      try {
        return await fn();
      } catch (error: any) {
        // Prisma unique constraint violation — treat as success (idempotent)
        if (error?.code === 'P2002') {
          logger.warn('Duplicate key encountered (idempotent skip):', error.meta);
          return undefined as unknown as T;
        }

        attempt++;
        if (attempt >= MAX_RETRIES) {
          logger.error(`Max retries (${MAX_RETRIES}) exceeded`, error);
          throw error;
        }

        const delay = Math.min(
          BASE_RETRY_DELAY_MS * 2 ** attempt + Math.random() * 200,
          MAX_RETRY_DELAY_MS,
        );
        logger.warn(
          `Retry ${attempt}/${MAX_RETRIES} after ${Math.round(delay)}ms: ` +
          `${error?.message ?? error}`,
        );

        await this.sleep(delay);
      }
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
