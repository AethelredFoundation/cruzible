/**
 * ReconciliationScheduler
 *
 * Periodic reconciliation engine for the Cruzible vault.
 *
 * On each tick the scheduler:
 *  1. Fetches independent live vault state (totalPooledAethel, totalShares,
 *     exchangeRate, epoch)
 *  2. Fetches indexed state from PostgreSQL
 *  3. Compares values within configurable drift thresholds
 *  4. Checks indexed exchange rate against the independent live vault read
 *  5. Checks indexed TVL against the vault's own totalPooledAethel
 *  6. Checks epoch freshness (if epoch hasn't advanced in 2x epoch duration)
 *  7. Checks active validator count against a minimum threshold
 *  8. Emits alerts via AlertService
 *  9. Stores latest reconciliation result in CacheService for API consumption
 *
 * The scheduler supports graceful start/stop and is registered via tsyringe DI.
 */

import { singleton } from "tsyringe";
import { Prisma, PrismaClient } from "@prisma/client";
import { Contract, JsonRpcProvider, keccak256, toUtf8Bytes } from "ethers";
import { randomUUID } from "node:crypto";
import { BlockchainService } from "./BlockchainService";
import { CacheService } from "./CacheService";
import {
  AlertService,
  AlertSeverity,
  AlertType,
  type AlertMetadata,
} from "./AlertService";
import { logger } from "../utils/logger";
import { errorContext } from "../utils/errorContext";
import { resolveProtocolEpoch } from "../lib/protocolEpoch";
import { config } from "../config";
import {
  buildIndexerNetworkKeys,
  getConfiguredIndexerCursorKey,
  getConfiguredIndexerNetworkKeys,
} from "../lib/indexerNetworkIdentity";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ReconciliationResult {
  networkIdentityDigest: string;
  timestamp: string;
  status: "OK" | "WARNING" | "CRITICAL";
  epoch: number;
  epochSource: string;
  checks: ReconciliationCheck[];
  onChainState: OnChainState | null;
  indexedState: IndexedState | null;
  durationMs: number;
}

type PendingReconciliationAlert = {
  conditionKey: string;
  severity: AlertSeverity;
  type: AlertType;
  message: string;
  metadata: AlertMetadata;
};

export interface ReconciliationCheck {
  name: string;
  status: "PASS" | "WARNING" | "CRITICAL" | "SKIPPED";
  message: string;
  metadata?: Record<string, unknown>;
}

export interface OnChainState {
  latestHeight: number;
  protocolEpoch: number;
  epochSource: string;
  validatorCount: number;
  activeValidatorCount: number;
  /** Network-wide bonded stake; telemetry only, never compared to vault TVL. */
  totalStaked: string;
  vaultBlockNumber: number | null;
  vaultTotalPooled: string | null;
  vaultTotalShares: string | null;
  vaultExchangeRate: string | null;
}

export interface IndexedState {
  blockNumber: number | null;
  totalStaked: string | null;
  totalShares: string | null;
  exchangeRate: string | null;
  currentEpoch: number | null;
  validatorsBacking: number | null;
  totalStakers: number | null;
  lastUpdated: string | null;
}

type IndexedStablecoinConfig = {
  id: string;
  assetId: string;
  symbol: string;
  circuitBreakerTripped: boolean;
  dailyLimit: string;
  dailyUsed: string;
  blockNumber: bigint;
};

type IndexedGeneration = {
  state: IndexedState;
  stablecoinConfigs: IndexedStablecoinConfig[];
};

// ---------------------------------------------------------------------------
// Constants & Defaults
// ---------------------------------------------------------------------------

/** Cache key for the latest reconciliation result. */
const CACHE_KEY_LATEST_SUFFIX = "reconciliation:scheduler:v2:latest";

/** Minimum shared-result retention; longer intervals derive a larger TTL. */
const CACHE_TTL_MIN_SECONDS = 600;

/** Epoch staleness multiplier — if epoch hasn't changed in 2x epoch duration → warning. */
const EPOCH_STALE_MULTIPLIER = 2;

/** Public scheduler checks must not echo raw exception text or upstream internals. */
const PUBLIC_TICK_FAILURE_MESSAGE =
  "Reconciliation tick failed. Operator logs contain internal diagnostics.";

/** Public stablecoin checks must stay generic while logs retain the raw failure. */
const PUBLIC_STABLECOIN_FAILURE_MESSAGE =
  "Stablecoin checks failed. Operator logs contain internal diagnostics.";

const LIVE_VAULT_ABI = [
  "function totalPooledAethel() view returns (uint256)",
  "function totalShares() view returns (uint256)",
  "function getExchangeRate() view returns (uint256)",
];

const FIXED_POINT_SCALE = 10n ** 18n;

function formatFixedPoint18(value: bigint): string {
  const integerPart = value / FIXED_POINT_SCALE;
  const fractionalPart = value % FIXED_POINT_SCALE;
  return `${integerPart}.${fractionalPart.toString().padStart(18, "0")}`;
}

function parseFixedPoint18(value: string): bigint | null {
  const match = /^(\d+)(?:\.(\d{1,18}))?$/.exec(value);
  if (!match) return null;

  const fractionalPart = (match[2] ?? "").padEnd(18, "0");
  return BigInt(match[1]) * FIXED_POINT_SCALE + BigInt(fractionalPart || "0");
}

function ratioAsNumber(numerator: bigint, denominator: bigint): number {
  if (denominator === 0n) return 0;
  return Number((numerator * 1_000_000n) / denominator) / 1_000_000;
}

// ---------------------------------------------------------------------------
// Known Stablecoin Assets — backend-side symbol registry
// ---------------------------------------------------------------------------

/**
 * Canonical stablecoin symbols recognized by the protocol.
 *
 * The InstitutionalStablecoinBridge contract keys configs by
 * `keccak256(abi.encodePacked(symbol))` — the same hash that the
 * frontend STABLECOIN_ASSETS registry computes with viem.
 *
 * This backend-side map is used by the ReconciliationScheduler to
 * backfill empty `symbol` fields on indexed StablecoinConfig rows.
 * When a new stablecoin is added to the protocol, add its symbol here.
 */
const KNOWN_STABLECOIN_SYMBOLS = [
  "USDC",
  "USDT",
  "DAI",
  "FRAX",
  "PYUSD",
] as const;

/** Precomputed assetId → symbol lookup map. */
const ASSET_ID_TO_SYMBOL: ReadonlyMap<string, string> = new Map(
  KNOWN_STABLECOIN_SYMBOLS.map((symbol) => [
    keccak256(toUtf8Bytes(symbol)),
    symbol,
  ]),
);

function classifyErrorForPublicCheck(error: unknown): string {
  return error instanceof Error ? error.name : typeof error;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

const RECONCILIATION_SHUTDOWN_TIMEOUT_MS = 10_000;
const RECONCILIATION_LEASE_KEY_SUFFIX = "reconciliation:scheduler:v2:leader";
const RECONCILIATION_LEASE_POLL_MAX_MS = 10_000;
const RECONCILIATION_LEASE_POLL_MIN_MS = 1_000;
const RECONCILIATION_LEASE_TTL_MIN_MS = 30_000;
const ALERT_DELIVERY_CLAIM_TTL_SECONDS = 30;

@singleton()
export class ReconciliationScheduler {
  private prisma: PrismaClient;
  private disconnected = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private tickInFlight = false;
  private leadershipCycleInFlight = false;
  private leadershipCyclePromise: Promise<void> | null = null;
  private leaseHeld = false;
  private releasePromise: Promise<void> | null = null;
  private nextTickAt = 0;
  private lastResult: ReconciliationResult | null = null;
  private activeAlertQueue: PendingReconciliationAlert[] | null = null;
  private readonly vaultProvider: JsonRpcProvider | null;
  private readonly leaseOwner = randomUUID();

  /** Configuration – pulled from environment or defaults. */
  private readonly intervalMs: number;
  private readonly minValidators: number;
  private readonly epochDurationSeconds: number;
  private readonly exchangeRateWarnThreshold: number;
  private readonly exchangeRateCriticalThreshold: number;
  private readonly tvlDriftThreshold: number;
  private readonly leasePollMs: number;
  private readonly leaseTtlMs: number;
  private readonly cacheTtlSeconds: number;
  private readonly resultMaxAgeMs: number;
  private readonly vaultChecksRequired: boolean;
  private readonly stablecoinChecksRequired: boolean;
  private readonly leaseKey: string;
  private readonly resultCacheKey: string;
  private readonly networkIdentityDigest: string;

  constructor(
    private blockchainService: BlockchainService,
    private cacheService: CacheService,
    private alertService: AlertService,
  ) {
    this.prisma = new PrismaClient();
    this.vaultProvider = config.cruzibleVaultAddress
      ? new JsonRpcProvider(config.indexerRpcUrl)
      : null;

    this.intervalMs = config.reconciliationIntervalMs;
    this.minValidators = config.reconciliationMinValidators;
    this.epochDurationSeconds = config.reconciliationEpochDurationSeconds;
    this.exchangeRateWarnThreshold = config.reconciliationRateWarnThreshold;
    this.exchangeRateCriticalThreshold =
      config.reconciliationRateCriticalThreshold;
    this.tvlDriftThreshold = config.reconciliationTvlDriftThreshold;
    this.leasePollMs = Math.min(
      RECONCILIATION_LEASE_POLL_MAX_MS,
      Math.max(
        RECONCILIATION_LEASE_POLL_MIN_MS,
        Math.floor(this.intervalMs / 3),
      ),
    );
    this.leaseTtlMs = Math.max(
      RECONCILIATION_LEASE_TTL_MIN_MS,
      this.leasePollMs * 4,
    );
    this.cacheTtlSeconds = Math.max(
      CACHE_TTL_MIN_SECONDS,
      Math.ceil((this.intervalMs * 3) / 1000),
    );
    this.resultMaxAgeMs = Math.max(this.intervalMs * 2, this.leaseTtlMs * 2);
    this.vaultChecksRequired = config.isProduction;
    this.stablecoinChecksRequired =
      config.indexerRequireStablecoinBridge || config.network === "mainnet";
    const networkKeys =
      getConfiguredIndexerNetworkKeys() ??
      buildIndexerNetworkKeys({
        chainId: config.indexerExpectedChainId ?? "unconfigured-chain",
        anchorHash: config.indexerExpectedGenesisHash ?? "unconfigured-anchor",
        vaultAddress: config.cruzibleVaultAddress || "no-vault",
        staethelAddress: config.staethelAddress || "no-staethel",
        stablecoinBridgeAddress: config.stablecoinBridgeAddress || "no-bridge",
      });
    this.networkIdentityDigest = networkKeys.identityDigest;
    this.leaseKey = `${networkKeys.cacheNamespace}:${RECONCILIATION_LEASE_KEY_SUFFIX}`;
    this.resultCacheKey = `${networkKeys.cacheNamespace}:${CACHE_KEY_LATEST_SUFFIX}`;
  }

  // -----------------------------------------------------------------------
  // Lifecycle
  // -----------------------------------------------------------------------

  /**
   * Start the reconciliation loop. Safe to call multiple times (no-op if
   * already running).
   */
  start(): void {
    if (this.running) {
      logger.warn("ReconciliationScheduler is already running");
      return;
    }

    this.running = true;
    this.releasePromise = null;
    this.nextTickAt = 0;
    logger.info(
      `ReconciliationScheduler starting — interval ${this.intervalMs}ms, leader poll ${this.leasePollMs}ms`,
    );

    // Every API replica participates in leader election. Only the Redis lease
    // holder executes a reconciliation tick; followers keep their local view
    // hydrated from the shared result cache.
    this.scheduleLeadershipMaintenance();

    this.timer = setInterval(() => {
      this.scheduleLeadershipMaintenance();
    }, this.leasePollMs);
  }

  /**
   * Stop the reconciliation loop gracefully.
   */
  stop(): void {
    if (!this.running) {
      return;
    }

    this.running = false;

    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }

    if (!this.tickInFlight && !this.leadershipCyclePromise) {
      this.releasePromise ??= this.releaseLeadership();
    }

    logger.info("ReconciliationScheduler stopped");
  }

  async shutdown(): Promise<void> {
    this.stop();

    const leadershipCycle = this.leadershipCyclePromise;
    if (leadershipCycle) {
      await leadershipCycle;
    }

    const shutdownStartedAt = Date.now();
    while (
      this.tickInFlight &&
      Date.now() - shutdownStartedAt < RECONCILIATION_SHUTDOWN_TIMEOUT_MS
    ) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    if (this.tickInFlight) {
      logger.warn(
        "ReconciliationScheduler shutdown timed out with tick active",
      );
    }

    this.releasePromise ??= this.releaseLeadership();
    await this.releasePromise;

    await this.disconnect();
  }

  async disconnect(): Promise<void> {
    if (this.disconnected) {
      return;
    }

    this.disconnected = true;
    this.vaultProvider?.destroy();
    await this.prisma.$disconnect();
  }

  /**
   * Return the latest reconciliation result (used by health check and API).
   */
  getLatestResult(): ReconciliationResult | null {
    if (this.lastResult && !this.isResultFresh(this.lastResult)) {
      this.lastResult = null;
    }
    return this.lastResult;
  }

  getLeadershipStatus(): "leader" | "follower" | "stopped" {
    if (!this.running) return "stopped";
    return this.leaseHeld ? "leader" : "follower";
  }

  private scheduleLeadershipMaintenance(): void {
    if (this.leadershipCyclePromise) return;
    const cycle = this.maintainLeadership();
    this.leadershipCyclePromise = cycle;
    void cycle.finally(() => {
      if (this.leadershipCyclePromise === cycle) {
        this.leadershipCyclePromise = null;
      }
    });
  }

  private async maintainLeadership(): Promise<void> {
    if (!this.running || this.leadershipCycleInFlight) return;
    this.leadershipCycleInFlight = true;

    try {
      const wasLeader = this.leaseHeld;
      if (!wasLeader && this.tickInFlight) {
        // A tick whose lease was lost must finish fenced before this process
        // may acquire a newer lease. This prevents same-owner ABA where an old
        // tick publishes under a lease acquired after another leader ran.
        await this.hydrateSharedResult();
        return;
      }
      this.leaseHeld = wasLeader
        ? await this.cacheService.renewLease(
            this.leaseKey,
            this.leaseOwner,
            this.leaseTtlMs,
          )
        : await this.cacheService.tryAcquireLease(
            this.leaseKey,
            this.leaseOwner,
            this.leaseTtlMs,
          );

      if (!this.running) {
        if (this.leaseHeld) {
          this.releasePromise = this.releaseLeadership();
          await this.releasePromise;
        }
        return;
      }

      if (wasLeader && !this.leaseHeld) {
        logger.error(
          "ReconciliationScheduler lost its leader lease; further ticks are fenced",
        );
      } else if (!wasLeader && this.leaseHeld) {
        logger.info("ReconciliationScheduler acquired the leader lease");
        this.nextTickAt = 0;
      }

      if (!this.leaseHeld) {
        await this.hydrateSharedResult();
        return;
      }

      const now = Date.now();
      if (now < this.nextTickAt) return;

      if (this.tickInFlight) {
        logger.warn(
          "ReconciliationScheduler: previous tick still in flight — skipping this interval",
        );
        return;
      }

      this.nextTickAt = now + this.intervalMs;
      void this.tick();
    } catch (error) {
      this.leaseHeld = false;
      logger.error(
        "ReconciliationScheduler leader election failed closed",
        errorContext(error),
      );
    } finally {
      this.leadershipCycleInFlight = false;
    }
  }

  private async hydrateSharedResult(): Promise<void> {
    const shared = await this.cacheService.get<ReconciliationResult>(
      this.resultCacheKey,
    );
    if (
      !shared ||
      !shared.timestamp ||
      !["OK", "WARNING", "CRITICAL"].includes(shared.status) ||
      shared.networkIdentityDigest !== this.networkIdentityDigest ||
      !this.isResultFresh(shared)
    ) {
      this.lastResult = null;
      return;
    }

    if (
      !this.lastResult ||
      Date.parse(shared.timestamp) > Date.parse(this.lastResult.timestamp)
    ) {
      this.lastResult = shared;
    }
  }

  private async releaseLeadership(): Promise<void> {
    if (!this.leaseHeld) return;
    this.leaseHeld = false;
    const released = await this.cacheService.releaseLease(
      this.leaseKey,
      this.leaseOwner,
    );
    if (!released) {
      logger.warn(
        "ReconciliationScheduler leader lease was not released; it will expire by TTL",
      );
    }
  }

  private isResultFresh(result: ReconciliationResult): boolean {
    const timestamp = Date.parse(result.timestamp);
    return (
      Number.isFinite(timestamp) &&
      timestamp <= Date.now() + 5_000 &&
      Date.now() - timestamp <= this.resultMaxAgeMs
    );
  }

  private async stillOwnsLeadership(): Promise<boolean> {
    if (!this.leaseHeld) return false;
    const owned = await this.cacheService.isLeaseOwner(
      this.leaseKey,
      this.leaseOwner,
    );
    if (!owned) {
      this.leaseHeld = false;
    }
    return owned;
  }

  private queueAlert(
    severity: AlertSeverity,
    type: AlertType,
    message: string,
    metadata: AlertMetadata = {},
    conditionKey: string = type.toLowerCase(),
  ): void {
    this.activeAlertQueue?.push({
      conditionKey,
      severity,
      type,
      message,
      metadata,
    });
  }

  private async deliverClaimedAlerts(
    result: ReconciliationResult,
    alerts: readonly PendingReconciliationAlert[],
  ): Promise<void> {
    const resultTime = Date.parse(result.timestamp);
    const alertWindowMs = Math.max(config.alertRateLimitMs, 1);
    const alertWindow = Math.floor(resultTime / alertWindowMs);
    for (const alert of alerts) {
      // This key is stable across leader failover within the configured alert
      // window. The durable AlertEvent row is written before delivery, and a
      // short Redis claim prevents concurrent attempts without permanently
      // consuming a crashed delivery.
      const idempotencyKey = `${this.networkIdentityDigest}:${alert.severity}:${alert.type}:${alert.conditionKey}:${alertWindow}`;
      const actionKey = `durable-alert:${idempotencyKey}`;
      const claimed = await this.cacheService.claimLeaseAction(
        this.leaseKey,
        this.leaseOwner,
        actionKey,
        ALERT_DELIVERY_CLAIM_TTL_SECONDS,
      );
      if (!claimed) {
        logger.warn("Reconciliation alert suppressed by lease fence", {
          type: alert.type,
          resultTimestamp: result.timestamp,
        });
        continue;
      }
      try {
        await this.alertService.sendDurableAlert(
          idempotencyKey,
          alert.severity,
          alert.type,
          alert.message,
          alert.metadata,
        );
      } catch (error) {
        logger.error(
          "Claimed reconciliation alert delivery failed",
          errorContext(error),
        );
      }
    }
  }

  // -----------------------------------------------------------------------
  // Core tick
  // -----------------------------------------------------------------------

  private async tick(): Promise<void> {
    if (!this.running || !(await this.stillOwnsLeadership())) return;

    // Prevent overlapping ticks — if a previous tick is still running
    // (e.g. slow RPC/database), skip this interval rather than racing.
    if (this.tickInFlight) {
      logger.warn(
        "ReconciliationScheduler: previous tick still in flight — skipping this interval",
      );
      return;
    }

    this.tickInFlight = true;
    const pendingAlerts: PendingReconciliationAlert[] = [];
    this.activeAlertQueue = pendingAlerts;

    try {
      const startMs = Date.now();
      const checks: ReconciliationCheck[] = [];
      let overallStatus: "OK" | "WARNING" | "CRITICAL" = "OK";
      let onChainState: OnChainState | null = null;
      let indexedState: IndexedState | null = null;
      let indexedStablecoinConfigs: IndexedStablecoinConfig[] = [];
      let epoch = 0;
      let epochSource = "unknown";

      try {
        // 1. Fetch indexed state first so independent EVM reads can use the
        // exact same finalized block rather than comparing against head.
        const indexedGeneration = await this.fetchIndexedState();
        indexedState = indexedGeneration.state;
        indexedStablecoinConfigs = indexedGeneration.stablecoinConfigs;

        // 2. Fetch on-chain state at the indexed projection block.
        onChainState = await this.fetchOnChainState(indexedState.blockNumber);
        epoch = onChainState.protocolEpoch;
        epochSource = onChainState.epochSource;

        // 3. Run checks
        const epochResolutionCheck = this.checkEpochResolution(onChainState);
        checks.push(epochResolutionCheck);

        const exchangeRateCheck = this.checkExchangeRate(
          onChainState,
          indexedState,
        );
        checks.push(exchangeRateCheck);

        const tvlCheck = this.checkTvlConsistency(onChainState, indexedState);
        checks.push(tvlCheck);

        const totalSharesCheck = this.checkTotalSharesConsistency(
          onChainState,
          indexedState,
        );
        checks.push(totalSharesCheck);

        const epochCheck = this.checkEpochFreshness(onChainState, indexedState);
        checks.push(epochCheck);

        const validatorCheck = this.checkValidatorCount(onChainState);
        checks.push(validatorCheck);

        // 3b. Stablecoin bridge checks
        const stablecoinChecks = await this.runStablecoinChecks(
          indexedStablecoinConfigs,
        );
        checks.push(...stablecoinChecks);

        // 4. Derive overall status
        for (const check of checks) {
          if (check.status === "CRITICAL") {
            overallStatus = "CRITICAL";
          } else if (
            check.status === "WARNING" &&
            overallStatus !== "CRITICAL"
          ) {
            overallStatus = "WARNING";
          }
        }
      } catch (error) {
        logger.error(
          "ReconciliationScheduler tick failed",
          errorContext(error),
        );
        checks.push({
          name: "tick_execution",
          status: "CRITICAL",
          message: PUBLIC_TICK_FAILURE_MESSAGE,
          metadata: { errorType: classifyErrorForPublicCheck(error) },
        });
        this.queueAlert(
          AlertSeverity.CRITICAL,
          AlertType.RECONCILIATION_MISMATCH,
          "Reconciliation tick execution failed",
          { errorType: classifyErrorForPublicCheck(error) },
          "tick-execution",
        );
        overallStatus = "CRITICAL";
      }

      const durationMs = Date.now() - startMs;

      const result: ReconciliationResult = {
        networkIdentityDigest: this.networkIdentityDigest,
        timestamp: new Date().toISOString(),
        status: overallStatus,
        epoch,
        epochSource,
        checks,
        onChainState,
        indexedState,
        durationMs,
      };

      // A tick may outlive its lease during an RPC pause or network partition.
      // Revalidate immediately before every externally visible publication so
      // a stale leader cannot overwrite the replacement leader's result.
      const published = await this.cacheService.publishWhileLeaseOwner(
        this.leaseKey,
        this.leaseOwner,
        this.resultCacheKey,
        result,
        this.cacheTtlSeconds,
      );
      if (!published) {
        this.leaseHeld = false;
        logger.error(
          "ReconciliationScheduler discarded a completed tick after leader lease loss",
        );
        return;
      }

      this.lastResult = result;
      await this.deliverClaimedAlerts(result, pendingAlerts);
      try {
        await this.alertService.retryUndeliveredAlerts({
          claim: (alertId) =>
            this.cacheService.claimLeaseAction(
              this.leaseKey,
              this.leaseOwner,
              `durable-alert-retry:${alertId}`,
              ALERT_DELIVERY_CLAIM_TTL_SECONDS,
            ),
        });
      } catch (error) {
        // Alert delivery must be retried and observable, but an outbox outage
        // after the reconciliation result was safely published must not turn
        // into an unhandled rejection that terminates the API process.
        logger.error("Durable alert outbox drain failed", errorContext(error));
      }

      if (overallStatus === "OK") {
        logger.info(
          `Reconciliation tick completed — status=${overallStatus} duration=${durationMs}ms`,
        );
      } else {
        logger.warn(
          `Reconciliation tick completed — status=${overallStatus} duration=${durationMs}ms checks=${checks
            .filter((c) => c.status !== "PASS")
            .map((c) => `${c.name}:${c.status}`)
            .join(", ")}`,
        );
      }
    } finally {
      this.activeAlertQueue = null;
      this.tickInFlight = false;
      if (!this.running) {
        this.releasePromise ??= this.releaseLeadership();
        await this.releasePromise;
      }
    }
  }

  // -----------------------------------------------------------------------
  // Data fetching
  // -----------------------------------------------------------------------

  private async fetchOnChainState(
    vaultBlockTag: number | null,
  ): Promise<OnChainState> {
    const [latestHeight, validatorsResponse, liveVaultState] =
      await Promise.all([
        this.blockchainService.getLatestHeight(),
        this.blockchainService.getValidators({ limit: 500, offset: 0 }),
        this.fetchLiveVaultState(vaultBlockTag),
      ]);
    const protocolEpoch = await resolveProtocolEpoch({
      blockchainService: this.blockchainService,
      latestHeight,
    });

    const validators = validatorsResponse.data;
    const activeValidators = validators.filter((v) => !v.jailed);
    const totalStaked = validators.reduce(
      (sum, v) => sum + BigInt(v.tokens),
      0n,
    );

    return {
      latestHeight,
      protocolEpoch: protocolEpoch.epoch,
      epochSource: protocolEpoch.source,
      validatorCount: validators.length,
      activeValidatorCount: activeValidators.length,
      totalStaked: totalStaked.toString(),
      vaultBlockNumber: liveVaultState?.blockNumber ?? null,
      vaultTotalPooled: liveVaultState?.totalPooled ?? null,
      vaultTotalShares: liveVaultState?.totalShares ?? null,
      vaultExchangeRate: liveVaultState?.exchangeRate ?? null,
    };
  }

  private async fetchLiveVaultState(blockTag: number | null): Promise<{
    blockNumber: number;
    totalPooled: string;
    totalShares: string;
    exchangeRate: string;
  } | null> {
    if (
      !this.vaultProvider ||
      !config.cruzibleVaultAddress ||
      blockTag === null
    ) {
      return null;
    }

    const vault = new Contract(
      config.cruzibleVaultAddress,
      LIVE_VAULT_ABI,
      this.vaultProvider,
    );
    const overrides = { blockTag };
    const [totalPooled, totalShares, exchangeRate] = (await Promise.all([
      vault.totalPooledAethel(overrides),
      vault.totalShares(overrides),
      vault.getExchangeRate(overrides),
    ])) as [bigint, bigint, bigint];

    return {
      blockNumber: blockTag,
      totalPooled: totalPooled.toString(),
      totalShares: totalShares.toString(),
      exchangeRate: formatFixedPoint18(exchangeRate),
    };
  }

  private async fetchIndexedState(): Promise<IndexedGeneration> {
    const expectedNetwork = getConfiguredIndexerNetworkKeys();
    const cursorKey = getConfiguredIndexerCursorKey();
    const vaultState = await this.prisma.$transaction(
      async (tx) => {
        const cursor = await tx.indexerCursor.findUnique({
          where: { cursorKey },
          select: {
            blockNumber: true,
            pendingBlockNumber: true,
            requiresRebuild: true,
            networkChainId: true,
            networkAnchorHash: true,
            networkVaultAddress: true,
            networkStaethelAddress: true,
            networkStablecoinBridgeAddress: true,
          },
        });

        if (!cursor) {
          throw new Error(
            "Reconciliation refused an indexed snapshot without a committed indexer cursor",
          );
        }
        if (cursor.pendingBlockNumber !== null) {
          throw new Error(
            "Reconciliation refused an indexed snapshot while a projection generation is pending",
          );
        }
        if (cursor.requiresRebuild) {
          throw new Error(
            "Reconciliation refused an indexed snapshot while projections require rebuilding",
          );
        }
        if (
          expectedNetwork &&
          (cursor.networkChainId !== expectedNetwork.identity.chainId ||
            cursor.networkAnchorHash?.toLowerCase() !==
              expectedNetwork.identity.anchorHash ||
            cursor.networkVaultAddress?.toLowerCase() !==
              expectedNetwork.identity.vaultAddress ||
            cursor.networkStaethelAddress?.toLowerCase() !==
              expectedNetwork.identity.staethelAddress ||
            cursor.networkStablecoinBridgeAddress?.toLowerCase() !==
              expectedNetwork.identity.stablecoinBridgeAddress)
        ) {
          throw new Error(
            "Reconciliation refused an indexed snapshot bound to another indexed source identity",
          );
        }

        const [committedVaultState, stablecoinConfigs] = await Promise.all([
          tx.vaultState.findFirst({
            orderBy: { updatedAt: "desc" },
          }),
          tx.stablecoinConfig.findMany({
            select: {
              id: true,
              assetId: true,
              symbol: true,
              circuitBreakerTripped: true,
              dailyLimit: true,
              dailyUsed: true,
              blockNumber: true,
            },
          }),
        ]);
        if (
          committedVaultState?.blockNumber != null &&
          committedVaultState.blockNumber > cursor.blockNumber
        ) {
          throw new Error(
            "Reconciliation refused a vault projection ahead of the committed indexer cursor",
          );
        }
        if (
          stablecoinConfigs.some(
            (stablecoin) => stablecoin.blockNumber > cursor.blockNumber,
          )
        ) {
          throw new Error(
            "Reconciliation refused a stablecoin projection ahead of the committed indexer cursor",
          );
        }

        return { committedVaultState, stablecoinConfigs };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );

    if (!vaultState.committedVaultState) {
      return {
        state: {
          blockNumber: null,
          totalStaked: null,
          totalShares: null,
          exchangeRate: null,
          currentEpoch: null,
          validatorsBacking: null,
          totalStakers: null,
          lastUpdated: null,
        },
        stablecoinConfigs: vaultState.stablecoinConfigs,
      };
    }

    return {
      state: {
        blockNumber:
          vaultState.committedVaultState.blockNumber == null
            ? null
            : Number(vaultState.committedVaultState.blockNumber),
        totalStaked: vaultState.committedVaultState.totalStaked,
        totalShares: vaultState.committedVaultState.totalShares,
        exchangeRate: vaultState.committedVaultState.exchangeRate,
        currentEpoch: Number(vaultState.committedVaultState.currentEpoch),
        validatorsBacking: vaultState.committedVaultState.validatorsBacking,
        totalStakers:
          vaultState.committedVaultState.totalStakers != null
            ? Number(vaultState.committedVaultState.totalStakers)
            : null,
        lastUpdated: vaultState.committedVaultState.updatedAt.toISOString(),
      },
      stablecoinConfigs: vaultState.stablecoinConfigs,
    };
  }

  // -----------------------------------------------------------------------
  // Individual checks
  // -----------------------------------------------------------------------

  /**
   * Compare the indexed exchange rate with an independent live contract read.
   * A rate above 1.0 is expected as rewards accrue; it is never an anomaly by
   * itself. A live rate decrease is reported separately as possible slashing.
   */
  private checkExchangeRate(
    onChain: OnChainState,
    indexed: IndexedState,
  ): ReconciliationCheck {
    if (!indexed.exchangeRate || !onChain.vaultExchangeRate) {
      if (this.vaultChecksRequired) {
        this.queueAlert(
          AlertSeverity.CRITICAL,
          AlertType.RECONCILIATION_MISMATCH,
          "Required indexed or live vault exchange rate is unavailable",
          {},
          "exchange-rate-unavailable",
        );
      }
      return {
        name: "exchange_rate",
        status: this.vaultChecksRequired ? "CRITICAL" : "SKIPPED",
        message:
          "Indexed or independent live vault exchange rate is unavailable",
      };
    }

    const indexedRate = parseFixedPoint18(indexed.exchangeRate);
    const liveRate = parseFixedPoint18(onChain.vaultExchangeRate);

    if (indexedRate === null || liveRate === null || liveRate <= 0n) {
      this.queueAlert(
        AlertSeverity.CRITICAL,
        AlertType.RECONCILIATION_MISMATCH,
        "Indexed or live vault exchange rate is invalid",
        {
          indexedExchangeRate: indexed.exchangeRate,
          liveExchangeRate: onChain.vaultExchangeRate,
        },
        "exchange-rate-invalid",
      );
      return {
        name: "exchange_rate",
        status: "CRITICAL",
        message: "Invalid indexed or live vault exchange rate",
        metadata: {
          indexedExchangeRate: indexed.exchangeRate,
          liveExchangeRate: onChain.vaultExchangeRate,
        },
      };
    }

    const difference =
      indexedRate > liveRate ? indexedRate - liveRate : liveRate - indexedRate;
    const drift = ratioAsNumber(difference, liveRate);

    if (drift > this.exchangeRateCriticalThreshold) {
      this.queueAlert(
        AlertSeverity.CRITICAL,
        AlertType.EXCHANGE_RATE_DRIFT,
        `Indexed/live exchange-rate mismatch is ${(drift * 100).toFixed(2)}%`,
        {
          indexedExchangeRate: indexed.exchangeRate,
          liveExchangeRate: onChain.vaultExchangeRate,
          drift,
          threshold: this.exchangeRateCriticalThreshold,
        },
        "exchange-rate-drift",
      );
      return {
        name: "exchange_rate",
        status: "CRITICAL",
        message: `Indexed/live exchange-rate mismatch ${(drift * 100).toFixed(2)}% exceeds critical threshold ${(this.exchangeRateCriticalThreshold * 100).toFixed(0)}%`,
        metadata: {
          indexedExchangeRate: indexed.exchangeRate,
          liveExchangeRate: onChain.vaultExchangeRate,
          drift,
        },
      };
    }

    if (drift > this.exchangeRateWarnThreshold) {
      this.queueAlert(
        AlertSeverity.WARNING,
        AlertType.EXCHANGE_RATE_DRIFT,
        `Indexed/live exchange-rate mismatch is ${(drift * 100).toFixed(2)}%`,
        {
          indexedExchangeRate: indexed.exchangeRate,
          liveExchangeRate: onChain.vaultExchangeRate,
          drift,
          threshold: this.exchangeRateWarnThreshold,
        },
        "exchange-rate-drift",
      );
      return {
        name: "exchange_rate",
        status: "WARNING",
        message: `Indexed/live exchange-rate mismatch ${(drift * 100).toFixed(2)}% exceeds warning threshold ${(this.exchangeRateWarnThreshold * 100).toFixed(0)}%`,
        metadata: {
          indexedExchangeRate: indexed.exchangeRate,
          liveExchangeRate: onChain.vaultExchangeRate,
          drift,
        },
      };
    }

    const previousLiveRateValue =
      this.lastResult?.onChainState?.vaultExchangeRate;
    const previousLiveRate = previousLiveRateValue
      ? parseFixedPoint18(previousLiveRateValue)
      : null;
    if (previousLiveRate !== null && liveRate < previousLiveRate) {
      const decline = ratioAsNumber(
        previousLiveRate - liveRate,
        previousLiveRate,
      );
      const severity =
        decline > this.exchangeRateCriticalThreshold
          ? AlertSeverity.CRITICAL
          : AlertSeverity.WARNING;
      this.queueAlert(
        severity,
        AlertType.EXCHANGE_RATE_DRIFT,
        `Live vault exchange rate decreased by ${(decline * 100).toFixed(2)}%`,
        {
          previousLiveExchangeRate: previousLiveRateValue,
          liveExchangeRate: onChain.vaultExchangeRate,
          decline,
        },
        "exchange-rate-decrease",
      );
      return {
        name: "exchange_rate",
        status: severity === AlertSeverity.CRITICAL ? "CRITICAL" : "WARNING",
        message: `Live vault exchange rate decreased by ${(decline * 100).toFixed(2)}%; inspect realized slashing or accounting changes`,
        metadata: {
          indexedExchangeRate: indexed.exchangeRate,
          liveExchangeRate: onChain.vaultExchangeRate,
          previousLiveExchangeRate: previousLiveRateValue,
          decline,
        },
      };
    }

    return {
      name: "exchange_rate",
      status: "PASS",
      message: `Indexed exchange rate matches the live vault (drift ${(drift * 100).toFixed(4)}%)`,
      metadata: {
        indexedExchangeRate: indexed.exchangeRate,
        liveExchangeRate: onChain.vaultExchangeRate,
        drift,
      },
    };
  }

  /**
   * Check TVL consistency between the vault's live totalPooledAethel and its
   * indexed projection. Network-wide validator stake is unrelated and must
   * never be used as the comparison baseline.
   */
  private checkTvlConsistency(
    onChain: OnChainState,
    indexed: IndexedState,
  ): ReconciliationCheck {
    if (!indexed.totalStaked || !onChain.vaultTotalPooled) {
      if (this.vaultChecksRequired) {
        this.queueAlert(
          AlertSeverity.CRITICAL,
          AlertType.RECONCILIATION_MISMATCH,
          "Required indexed or live vault TVL is unavailable",
          {},
          "tvl-unavailable",
        );
      }
      return {
        name: "tvl_consistency",
        status: this.vaultChecksRequired ? "CRITICAL" : "SKIPPED",
        message: "Indexed or independent live vault TVL is unavailable",
      };
    }

    const onChainTvl = BigInt(onChain.vaultTotalPooled);
    const indexedTvl = BigInt(indexed.totalStaked);

    if (onChainTvl === 0n && indexedTvl === 0n) {
      return {
        name: "tvl_consistency",
        status: "PASS",
        message: "Both on-chain and indexed TVL are zero",
      };
    }

    // Drift calculation using the larger value as denominator
    const denominator = onChainTvl > indexedTvl ? onChainTvl : indexedTvl;
    const diff =
      onChainTvl > indexedTvl
        ? onChainTvl - indexedTvl
        : indexedTvl - onChainTvl;

    // Use number conversion for percentage — safe because we're dividing
    const driftPct =
      denominator > 0n ? Number((diff * 10000n) / denominator) / 10000 : 0;

    if (driftPct > this.tvlDriftThreshold) {
      this.queueAlert(
        AlertSeverity.WARNING,
        AlertType.TVL_ANOMALY,
        `Vault TVL mismatch: live=${onChainTvl.toString()} indexed=${indexedTvl.toString()} drift=${(driftPct * 100).toFixed(2)}%`,
        {
          liveVaultTvl: onChainTvl.toString(),
          indexedTvl: indexedTvl.toString(),
          driftPct,
        },
        "tvl-drift",
      );
      return {
        name: "tvl_consistency",
        status: "WARNING",
        message: `TVL drift ${(driftPct * 100).toFixed(2)}% exceeds threshold ${(this.tvlDriftThreshold * 100).toFixed(0)}%`,
        metadata: {
          liveVaultTvl: onChainTvl.toString(),
          indexedTvl: indexedTvl.toString(),
          driftPct,
        },
      };
    }

    return {
      name: "tvl_consistency",
      status: "PASS",
      message: `TVL consistent — drift ${(driftPct * 100).toFixed(4)}%`,
      metadata: {
        liveVaultTvl: onChainTvl.toString(),
        indexedTvl: indexedTvl.toString(),
        driftPct,
      },
    };
  }

  /**
   * The live vault and indexed projection are read at the same finalized
   * block, so total share supply must match exactly. A rate/TVL-only check can
   * otherwise miss a corrupted share ledger whose other aggregates happen to
   * remain plausible.
   */
  private checkTotalSharesConsistency(
    onChain: OnChainState,
    indexed: IndexedState,
  ): ReconciliationCheck {
    if (!indexed.totalShares || !onChain.vaultTotalShares) {
      if (this.vaultChecksRequired) {
        this.queueAlert(
          AlertSeverity.CRITICAL,
          AlertType.RECONCILIATION_MISMATCH,
          "Required indexed or live total share supply is unavailable",
          {},
          "total-shares-unavailable",
        );
      }
      return {
        name: "total_shares_consistency",
        status: this.vaultChecksRequired ? "CRITICAL" : "SKIPPED",
        message:
          "Indexed or independent live total share supply is unavailable",
      };
    }

    const indexedShares = BigInt(indexed.totalShares);
    const liveShares = BigInt(onChain.vaultTotalShares);
    if (indexedShares !== liveShares) {
      this.queueAlert(
        AlertSeverity.CRITICAL,
        AlertType.RECONCILIATION_MISMATCH,
        "Indexed total share supply does not match the live vault",
        {
          indexedTotalShares: indexedShares.toString(),
          liveTotalShares: liveShares.toString(),
          blockNumber: onChain.vaultBlockNumber,
        },
        "total-shares-mismatch",
      );
      return {
        name: "total_shares_consistency",
        status: "CRITICAL",
        message:
          "Indexed total share supply does not match the live vault at the same finalized block",
        metadata: {
          indexedTotalShares: indexedShares.toString(),
          liveTotalShares: liveShares.toString(),
          blockNumber: onChain.vaultBlockNumber,
        },
      };
    }

    return {
      name: "total_shares_consistency",
      status: "PASS",
      message: "Indexed total share supply matches the live vault",
      metadata: {
        indexedTotalShares: indexedShares.toString(),
        liveTotalShares: liveShares.toString(),
        blockNumber: onChain.vaultBlockNumber,
      },
    };
  }

  /**
   * Check epoch freshness. If the indexed VaultState hasn't been updated
   * within `EPOCH_STALE_MULTIPLIER * epochDuration`, emit a warning.
   */
  private checkEpochFreshness(
    onChain: OnChainState,
    indexed: IndexedState,
  ): ReconciliationCheck {
    if (!indexed.lastUpdated || indexed.currentEpoch == null) {
      if (this.vaultChecksRequired) {
        this.queueAlert(
          AlertSeverity.CRITICAL,
          AlertType.EPOCH_STALE,
          "Required indexed epoch state is unavailable",
          {},
          "epoch-state-unavailable",
        );
      }
      return {
        name: "epoch_freshness",
        status: this.vaultChecksRequired ? "CRITICAL" : "SKIPPED",
        message:
          "Indexed epoch state is unavailable — freshness cannot be checked",
      };
    }

    const lastUpdated = new Date(indexed.lastUpdated).getTime();
    const ageMs = Date.now() - lastUpdated;
    const staleLimitMs =
      EPOCH_STALE_MULTIPLIER * this.epochDurationSeconds * 1000;
    const epochLag = Math.max(onChain.protocolEpoch - indexed.currentEpoch, 0);

    if (epochLag > 0 || ageMs > staleLimitMs) {
      const reasons: string[] = [];
      if (epochLag > 0) {
        reasons.push(
          `indexed epoch ${indexed.currentEpoch} trails protocol epoch ${onChain.protocolEpoch} by ${epochLag}`,
        );
      }
      if (ageMs > staleLimitMs) {
        reasons.push(
          `vault state is ${Math.round(ageMs / 1000)}s old which exceeds ${staleLimitMs / 1000}s`,
        );
      }

      this.queueAlert(
        AlertSeverity.WARNING,
        AlertType.EPOCH_STALE,
        `Vault epoch freshness warning: ${reasons.join("; ")}`,
        {
          ageMs,
          staleLimitMs,
          lastUpdated: indexed.lastUpdated,
          indexedEpoch: indexed.currentEpoch,
          protocolEpoch: onChain.protocolEpoch,
          epochLag,
        },
        "epoch-stale",
      );
      return {
        name: "epoch_freshness",
        status: "WARNING",
        message: reasons.join("; "),
        metadata: {
          ageMs,
          staleLimitMs,
          indexedEpoch: indexed.currentEpoch,
          protocolEpoch: onChain.protocolEpoch,
          epochLag,
        },
      };
    }

    return {
      name: "epoch_freshness",
      status: "PASS",
      message: `Indexed epoch ${indexed.currentEpoch} matches protocol epoch ${onChain.protocolEpoch} and state age is within freshness limits`,
      metadata: {
        ageMs,
        staleLimitMs,
        indexedEpoch: indexed.currentEpoch,
        protocolEpoch: onChain.protocolEpoch,
        epochLag,
      },
    };
  }

  private checkEpochResolution(onChain: OnChainState): ReconciliationCheck {
    if (onChain.epochSource.includes("(fallback)")) {
      return {
        name: "epoch_resolution",
        status: "WARNING",
        message: `Authoritative epoch unavailable; using fallback source ${onChain.epochSource}`,
        metadata: {
          epoch: onChain.protocolEpoch,
          latestHeight: onChain.latestHeight,
          epochSource: onChain.epochSource,
        },
      };
    }

    return {
      name: "epoch_resolution",
      status: "PASS",
      message: `Authoritative epoch resolved from ${onChain.epochSource}`,
      metadata: {
        epoch: onChain.protocolEpoch,
        latestHeight: onChain.latestHeight,
        epochSource: onChain.epochSource,
      },
    };
  }

  /**
   * Check that the active (non-jailed) validator count meets the minimum
   * threshold for network safety.
   */
  private checkValidatorCount(onChain: OnChainState): ReconciliationCheck {
    if (onChain.activeValidatorCount < this.minValidators) {
      this.queueAlert(
        AlertSeverity.CRITICAL,
        AlertType.VALIDATOR_COUNT_DROP,
        `Active validator count (${onChain.activeValidatorCount}) below minimum (${this.minValidators})`,
        {
          activeValidators: onChain.activeValidatorCount,
          totalValidators: onChain.validatorCount,
          minRequired: this.minValidators,
        },
        "validator-count-low",
      );
      return {
        name: "validator_count",
        status: "CRITICAL",
        message: `Active validators ${onChain.activeValidatorCount} < minimum ${this.minValidators}`,
        metadata: {
          activeValidators: onChain.activeValidatorCount,
          totalValidators: onChain.validatorCount,
          minRequired: this.minValidators,
        },
      };
    }

    return {
      name: "validator_count",
      status: "PASS",
      message: `Active validators ${onChain.activeValidatorCount} >= minimum ${this.minValidators}`,
      metadata: {
        activeValidators: onChain.activeValidatorCount,
        totalValidators: onChain.validatorCount,
        minRequired: this.minValidators,
      },
    };
  }

  // -----------------------------------------------------------------------
  // Stablecoin Bridge Checks
  // -----------------------------------------------------------------------

  /** Daily usage warning threshold — alert when usage exceeds 80% of limit. */
  private static readonly DAILY_USAGE_WARN_PCT = 0.8;

  /**
   * Run all stablecoin bridge reconciliation checks:
   *  - Circuit breaker status (any tripped → CRITICAL)
   *  - Daily usage nearing limit (>80% → WARNING)
   *  - Config consistency (disabled configs that should be active → WARNING)
   *
   * Returns an array of check results so they slot into the main check list.
   */
  private async runStablecoinChecks(
    configs: IndexedStablecoinConfig[],
  ): Promise<ReconciliationCheck[]> {
    const checks: ReconciliationCheck[] = [];

    try {
      if (configs.length === 0) {
        if (this.stablecoinChecksRequired) {
          this.queueAlert(
            AlertSeverity.CRITICAL,
            AlertType.STABLECOIN_CONFIG_MISMATCH,
            "Required stablecoin bridge has no indexed configuration",
            {},
            "stablecoin-config-missing",
          );
        }
        checks.push({
          name: "stablecoin_bridge",
          status: this.stablecoinChecksRequired ? "CRITICAL" : "SKIPPED",
          message: this.stablecoinChecksRequired
            ? "Required stablecoin bridge has no indexed configuration"
            : "No stablecoin configs indexed — bridge checks skipped",
        });
        return checks;
      }

      // Backfill: resolve empty symbol fields from the known-assets registry.
      // The IndexerService seeds symbol='' because the contract doesn't store
      // symbols on-chain. This is a best-effort backfill — unknown assetIds
      // are left as-is and logged for operator attention.
      await this.backfillStablecoinSymbols(configs);

      // Check 1: Circuit breaker status
      checks.push(await this.checkCircuitBreakers(configs));

      // Check 2: Daily usage nearing limit
      checks.push(this.checkDailyUsage(configs));
    } catch (error) {
      logger.error(
        "Stablecoin reconciliation checks failed",
        errorContext(error),
      );
      checks.push({
        name: "stablecoin_bridge",
        status: this.stablecoinChecksRequired ? "CRITICAL" : "WARNING",
        message: PUBLIC_STABLECOIN_FAILURE_MESSAGE,
        metadata: { errorType: classifyErrorForPublicCheck(error) },
      });
      if (this.stablecoinChecksRequired) {
        this.queueAlert(
          AlertSeverity.CRITICAL,
          AlertType.STABLECOIN_CONFIG_MISMATCH,
          "Required stablecoin reconciliation checks failed",
          { errorType: classifyErrorForPublicCheck(error) },
          "stablecoin-check-failed",
        );
      }
    }

    return checks;
  }

  /**
   * Backfill empty `symbol` fields on indexed StablecoinConfig rows.
   *
   * The IndexerService seeds `symbol = ''` because the contract doesn't
   * store symbol strings on-chain. This method resolves the symbol from
   * the precomputed `ASSET_ID_TO_SYMBOL` map (keccak256 of the symbol).
   *
   * Only writes to the DB if a blank symbol is resolved — already-filled
   * rows and unknown assetIds are left untouched.
   */
  private async backfillStablecoinSymbols(
    configs: { id: string; assetId: string; symbol: string }[],
  ): Promise<void> {
    for (const cfg of configs) {
      if (cfg.symbol) continue; // Already populated

      const resolved = ASSET_ID_TO_SYMBOL.get(cfg.assetId);
      if (!resolved) {
        logger.warn(
          `StablecoinConfig assetId=${cfg.assetId} has empty symbol and is ` +
            `not in KNOWN_STABLECOIN_SYMBOLS — add it to the backend registry`,
        );
        continue;
      }

      try {
        await this.prisma.stablecoinConfig.update({
          where: { id: cfg.id },
          data: { symbol: resolved },
        });
        // Update the in-memory object so downstream checks see the symbol
        cfg.symbol = resolved;
        logger.info(
          `Backfilled symbol '${resolved}' for StablecoinConfig assetId=${cfg.assetId}`,
        );
      } catch (err) {
        logger.error(
          `Failed to backfill symbol for assetId=${cfg.assetId}`,
          errorContext(err),
        );
      }
    }
  }

  /**
   * Check if any stablecoin has its circuit breaker tripped.
   * A tripped circuit breaker is a CRITICAL alert — bridge operations are halted.
   */
  private async checkCircuitBreakers(
    configs: {
      assetId: string;
      symbol: string;
      circuitBreakerTripped: boolean;
    }[],
  ): Promise<ReconciliationCheck> {
    const tripped = configs.filter((c) => c.circuitBreakerTripped);

    if (tripped.length > 0) {
      const trippedSymbols = tripped
        .map((c) => c.symbol || c.assetId.slice(0, 10))
        .join(", ");

      this.queueAlert(
        AlertSeverity.CRITICAL,
        AlertType.STABLECOIN_CIRCUIT_BREAKER,
        `Circuit breaker tripped for: ${trippedSymbols}`,
        {
          trippedAssets: tripped.map((c) => ({
            assetId: c.assetId,
            symbol: c.symbol,
          })),
        },
        "stablecoin-circuit-breaker",
      );

      return {
        name: "stablecoin_circuit_breaker",
        status: "CRITICAL",
        message: `Circuit breaker tripped for ${tripped.length} asset(s): ${trippedSymbols}`,
        metadata: { trippedCount: tripped.length, trippedSymbols },
      };
    }

    return {
      name: "stablecoin_circuit_breaker",
      status: "PASS",
      message: `All ${configs.length} stablecoin circuit breakers healthy`,
      metadata: { configCount: configs.length },
    };
  }

  /**
   * Check if any stablecoin's daily usage is nearing its limit (>80%).
   * Approaching the daily limit is a WARNING — operators may need to
   * adjust limits or prepare for a temporary bridge pause.
   */
  private checkDailyUsage(
    configs: {
      assetId: string;
      symbol: string;
      dailyLimit: string;
      dailyUsed: string;
    }[],
  ): ReconciliationCheck {
    const warnings: { symbol: string; usagePct: number }[] = [];

    for (const cfg of configs) {
      const limit = BigInt(cfg.dailyLimit);
      const used = BigInt(cfg.dailyUsed);

      if (limit === 0n) continue; // No limit set

      // Calculate usage percentage using integer arithmetic
      const usagePct = Number((used * 10000n) / limit) / 10000;

      if (usagePct >= ReconciliationScheduler.DAILY_USAGE_WARN_PCT) {
        warnings.push({
          symbol: cfg.symbol || cfg.assetId.slice(0, 10),
          usagePct,
        });
      }
    }

    if (warnings.length > 0) {
      const details = warnings
        .map((w) => `${w.symbol}: ${(w.usagePct * 100).toFixed(1)}%`)
        .join(", ");

      this.queueAlert(
        AlertSeverity.WARNING,
        AlertType.STABLECOIN_RESERVE_DRIFT,
        `Stablecoin daily usage nearing limit: ${details}`,
        { warnings },
        "stablecoin-daily-usage",
      );

      return {
        name: "stablecoin_daily_usage",
        status: "WARNING",
        message: `Daily usage warning: ${details}`,
        metadata: { warnings },
      };
    }

    return {
      name: "stablecoin_daily_usage",
      status: "PASS",
      message: "All stablecoin daily usage within safe limits",
    };
  }
}
