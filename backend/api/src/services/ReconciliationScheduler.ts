/**
 * ReconciliationScheduler
 *
 * Periodic reconciliation engine for the Cruzible vault.
 *
 * On each tick the scheduler:
 *  1. Fetches on-chain vault state (totalPooledAethel, totalShares, exchangeRate, epoch)
 *  2. Fetches indexed state from PostgreSQL
 *  3. Compares values within configurable drift thresholds
 *  4. Checks exchange rate drift (>1% WARNING, >5% CRITICAL)
 *  5. Checks TVL consistency between on-chain and indexed
 *  6. Checks epoch freshness (if epoch hasn't advanced in 2x epoch duration)
 *  7. Checks active validator count against a minimum threshold
 *  8. Emits alerts via AlertService
 *  9. Stores latest reconciliation result in CacheService for API consumption
 *
 * The scheduler supports graceful start/stop and is registered via tsyringe DI.
 */

import { injectable } from 'tsyringe';
import { PrismaClient } from '@prisma/client';
import { keccak256, toUtf8Bytes } from 'ethers';
import { BlockchainService } from './BlockchainService';
import { CacheService } from './CacheService';
import { AlertService, AlertSeverity, AlertType } from './AlertService';
import { logger } from '../utils/logger';
import { resolveProtocolEpoch } from '../lib/protocolEpoch';
import { config } from '../config';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ReconciliationResult {
  timestamp: string;
  status: 'OK' | 'WARNING' | 'CRITICAL';
  epoch: number;
  epochSource: string;
  checks: ReconciliationCheck[];
  onChainState: OnChainState | null;
  indexedState: IndexedState | null;
  durationMs: number;
}

export interface ReconciliationCheck {
  name: string;
  status: 'PASS' | 'WARNING' | 'CRITICAL' | 'SKIPPED';
  message: string;
  metadata?: Record<string, unknown>;
}

export interface OnChainState {
  latestHeight: number;
  protocolEpoch: number;
  epochSource: string;
  validatorCount: number;
  activeValidatorCount: number;
  totalStaked: string;
}

export interface IndexedState {
  totalStaked: string | null;
  totalShares: string | null;
  exchangeRate: string | null;
  currentEpoch: number | null;
  validatorsBacking: number | null;
  totalStakers: number | null;
  lastUpdated: string | null;
}

// ---------------------------------------------------------------------------
// Constants & Defaults
// ---------------------------------------------------------------------------

/** Cache key for the latest reconciliation result. */
const CACHE_KEY_LATEST = 'reconciliation:scheduler:latest';

/** Cache TTL — persisted until overwritten by the next tick. */
const CACHE_TTL_SECONDS = 600;

/** Epoch staleness multiplier — if epoch hasn't changed in 2x epoch duration → warning. */
const EPOCH_STALE_MULTIPLIER = 2;

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
const KNOWN_STABLECOIN_SYMBOLS = ['USDC', 'USDT', 'DAI', 'FRAX', 'PYUSD'] as const;

/** Precomputed assetId → symbol lookup map. */
const ASSET_ID_TO_SYMBOL: ReadonlyMap<string, string> = new Map(
  KNOWN_STABLECOIN_SYMBOLS.map((symbol) => [
    keccak256(toUtf8Bytes(symbol)),
    symbol,
  ]),
);

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

@injectable()
export class ReconciliationScheduler {
  private prisma: PrismaClient;
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private tickInFlight = false;
  private lastResult: ReconciliationResult | null = null;

  /** Configuration – pulled from environment or defaults. */
  private readonly intervalMs: number;
  private readonly minValidators: number;
  private readonly epochDurationSeconds: number;
  private readonly exchangeRateWarnThreshold: number;
  private readonly exchangeRateCriticalThreshold: number;
  private readonly tvlDriftThreshold: number;

  constructor(
    private blockchainService: BlockchainService,
    private cacheService: CacheService,
    private alertService: AlertService,
  ) {
    this.prisma = new PrismaClient();

    this.intervalMs = config.reconciliationIntervalMs;
    this.minValidators = config.reconciliationMinValidators;
    this.epochDurationSeconds = config.reconciliationEpochDurationSeconds;
    this.exchangeRateWarnThreshold = config.reconciliationRateWarnThreshold;
    this.exchangeRateCriticalThreshold =
      config.reconciliationRateCriticalThreshold;
    this.tvlDriftThreshold = config.reconciliationTvlDriftThreshold;
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
      logger.warn('ReconciliationScheduler is already running');
      return;
    }

    this.running = true;
    logger.info(
      `ReconciliationScheduler starting — interval ${this.intervalMs}ms`,
    );

    // Fire immediately on start, then on the interval
    void this.tick();

    this.timer = setInterval(() => {
      void this.tick();
    }, this.intervalMs);
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

    logger.info('ReconciliationScheduler stopped');
  }

  /**
   * Return the latest reconciliation result (used by health check and API).
   */
  getLatestResult(): ReconciliationResult | null {
    return this.lastResult;
  }

  // -----------------------------------------------------------------------
  // Core tick
  // -----------------------------------------------------------------------

  private async tick(): Promise<void> {
    if (!this.running) return;

    // Prevent overlapping ticks — if a previous tick is still running
    // (e.g. slow RPC/database), skip this interval rather than racing.
    if (this.tickInFlight) {
      logger.warn(
        'ReconciliationScheduler: previous tick still in flight — skipping this interval',
      );
      return;
    }

    this.tickInFlight = true;

    try {
      const startMs = Date.now();
      const checks: ReconciliationCheck[] = [];
      let overallStatus: 'OK' | 'WARNING' | 'CRITICAL' = 'OK';
      let onChainState: OnChainState | null = null;
      let indexedState: IndexedState | null = null;
      let epoch = 0;
      let epochSource = 'unknown';

      try {
        // 1. Fetch on-chain state
        onChainState = await this.fetchOnChainState();
        epoch = onChainState.protocolEpoch;
        epochSource = onChainState.epochSource;

        // 2. Fetch indexed state
        indexedState = await this.fetchIndexedState();

        // 3. Run checks
        const epochResolutionCheck = this.checkEpochResolution(onChainState);
        checks.push(epochResolutionCheck);

        const exchangeRateCheck = this.checkExchangeRate(indexedState);
        checks.push(exchangeRateCheck);

        const tvlCheck = this.checkTvlConsistency(onChainState, indexedState);
        checks.push(tvlCheck);

        const epochCheck = this.checkEpochFreshness(onChainState, indexedState);
        checks.push(epochCheck);

        const validatorCheck = this.checkValidatorCount(onChainState);
        checks.push(validatorCheck);

        // 3b. Stablecoin bridge checks
        const stablecoinChecks = await this.runStablecoinChecks();
        checks.push(...stablecoinChecks);

        // 4. Derive overall status
        for (const check of checks) {
          if (check.status === 'CRITICAL') {
            overallStatus = 'CRITICAL';
          } else if (check.status === 'WARNING' && overallStatus !== 'CRITICAL') {
            overallStatus = 'WARNING';
          }
        }
      } catch (error) {
        logger.error('ReconciliationScheduler tick failed', { error });
        checks.push({
          name: 'tick_execution',
          status: 'CRITICAL',
          message: `Reconciliation tick failed: ${error instanceof Error ? error.message : String(error)}`,
        });
        overallStatus = 'CRITICAL';
      }

      const durationMs = Date.now() - startMs;

      const result: ReconciliationResult = {
        timestamp: new Date().toISOString(),
        status: overallStatus,
        epoch,
        epochSource,
        checks,
        onChainState,
        indexedState,
        durationMs,
      };

      this.lastResult = result;

      // Persist to cache for API consumption
      await this.cacheService.set(CACHE_KEY_LATEST, result, CACHE_TTL_SECONDS);

      if (overallStatus === 'OK') {
        logger.info(
          `Reconciliation tick completed — status=${overallStatus} duration=${durationMs}ms`,
        );
      } else {
        logger.warn(
          `Reconciliation tick completed — status=${overallStatus} duration=${durationMs}ms checks=${checks
            .filter((c) => c.status !== 'PASS')
            .map((c) => `${c.name}:${c.status}`)
            .join(', ')}`,
        );
      }
    } finally {
      this.tickInFlight = false;
    }
  }

  // -----------------------------------------------------------------------
  // Data fetching
  // -----------------------------------------------------------------------

  private async fetchOnChainState(): Promise<OnChainState> {
    const [latestHeight, validatorsResponse] = await Promise.all([
      this.blockchainService.getLatestHeight(),
      this.blockchainService.getValidators({ limit: 500, offset: 0 }),
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
    };
  }

  private async fetchIndexedState(): Promise<IndexedState> {
    const vaultState = await this.prisma.vaultState.findFirst({
      orderBy: { updatedAt: 'desc' },
    });

    if (!vaultState) {
      return {
        totalStaked: null,
        totalShares: null,
        exchangeRate: null,
        currentEpoch: null,
        validatorsBacking: null,
        totalStakers: null,
        lastUpdated: null,
      };
    }

    return {
      totalStaked: vaultState.totalStaked,
      totalShares: vaultState.totalShares,
      exchangeRate: vaultState.exchangeRate,
      currentEpoch: Number(vaultState.currentEpoch),
      validatorsBacking: vaultState.validatorsBacking,
      totalStakers: vaultState.totalStakers != null ? Number(vaultState.totalStakers) : null,
      lastUpdated: vaultState.updatedAt.toISOString(),
    };
  }

  // -----------------------------------------------------------------------
  // Individual checks
  // -----------------------------------------------------------------------

  /**
   * Check exchange rate drift against the expected 1:1 baseline.
   * In a healthy liquid staking vault the exchange rate should be >= 1.0
   * and should not deviate more than the configured thresholds.
   */
  private checkExchangeRate(indexed: IndexedState): ReconciliationCheck {
    if (!indexed.exchangeRate) {
      return {
        name: 'exchange_rate',
        status: 'SKIPPED',
        message: 'No indexed exchange rate available',
      };
    }

    const rate = Number(indexed.exchangeRate);

    if (isNaN(rate) || rate <= 0) {
      return {
        name: 'exchange_rate',
        status: 'CRITICAL',
        message: `Invalid exchange rate: ${indexed.exchangeRate}`,
        metadata: { exchangeRate: indexed.exchangeRate },
      };
    }

    // Drift from 1.0 baseline
    const drift = Math.abs(rate - 1.0);

    if (drift > this.exchangeRateCriticalThreshold) {
      void this.alertService.sendAlert(
        AlertSeverity.CRITICAL,
        AlertType.EXCHANGE_RATE_DRIFT,
        `Exchange rate critical drift: ${rate.toFixed(6)} (${(drift * 100).toFixed(2)}% from baseline)`,
        { exchangeRate: rate, drift, threshold: this.exchangeRateCriticalThreshold },
      );
      return {
        name: 'exchange_rate',
        status: 'CRITICAL',
        message: `Exchange rate drift ${(drift * 100).toFixed(2)}% exceeds critical threshold ${(this.exchangeRateCriticalThreshold * 100).toFixed(0)}%`,
        metadata: { exchangeRate: rate, drift },
      };
    }

    if (drift > this.exchangeRateWarnThreshold) {
      void this.alertService.sendAlert(
        AlertSeverity.WARNING,
        AlertType.EXCHANGE_RATE_DRIFT,
        `Exchange rate warning drift: ${rate.toFixed(6)} (${(drift * 100).toFixed(2)}% from baseline)`,
        { exchangeRate: rate, drift, threshold: this.exchangeRateWarnThreshold },
      );
      return {
        name: 'exchange_rate',
        status: 'WARNING',
        message: `Exchange rate drift ${(drift * 100).toFixed(2)}% exceeds warning threshold ${(this.exchangeRateWarnThreshold * 100).toFixed(0)}%`,
        metadata: { exchangeRate: rate, drift },
      };
    }

    return {
      name: 'exchange_rate',
      status: 'PASS',
      message: `Exchange rate ${rate.toFixed(6)} within tolerance (drift ${(drift * 100).toFixed(4)}%)`,
      metadata: { exchangeRate: rate, drift },
    };
  }

  /**
   * Check TVL consistency between on-chain validator stakes and the indexed
   * vault totalStaked.
   */
  private checkTvlConsistency(
    onChain: OnChainState,
    indexed: IndexedState,
  ): ReconciliationCheck {
    if (!indexed.totalStaked) {
      return {
        name: 'tvl_consistency',
        status: 'SKIPPED',
        message: 'No indexed TVL available for comparison',
      };
    }

    const onChainTvl = BigInt(onChain.totalStaked);
    const indexedTvl = BigInt(indexed.totalStaked);

    if (onChainTvl === 0n && indexedTvl === 0n) {
      return {
        name: 'tvl_consistency',
        status: 'PASS',
        message: 'Both on-chain and indexed TVL are zero',
      };
    }

    // Drift calculation using the larger value as denominator
    const denominator = onChainTvl > indexedTvl ? onChainTvl : indexedTvl;
    const diff = onChainTvl > indexedTvl
      ? onChainTvl - indexedTvl
      : indexedTvl - onChainTvl;

    // Use number conversion for percentage — safe because we're dividing
    const driftPct = denominator > 0n
      ? Number((diff * 10000n) / denominator) / 10000
      : 0;

    if (driftPct > this.tvlDriftThreshold) {
      void this.alertService.sendAlert(
        AlertSeverity.WARNING,
        AlertType.TVL_ANOMALY,
        `TVL mismatch: on-chain=${onChainTvl.toString()} indexed=${indexedTvl.toString()} drift=${(driftPct * 100).toFixed(2)}%`,
        {
          onChainTvl: onChainTvl.toString(),
          indexedTvl: indexedTvl.toString(),
          driftPct,
        },
      );
      return {
        name: 'tvl_consistency',
        status: 'WARNING',
        message: `TVL drift ${(driftPct * 100).toFixed(2)}% exceeds threshold ${(this.tvlDriftThreshold * 100).toFixed(0)}%`,
        metadata: {
          onChainTvl: onChainTvl.toString(),
          indexedTvl: indexedTvl.toString(),
          driftPct,
        },
      };
    }

    return {
      name: 'tvl_consistency',
      status: 'PASS',
      message: `TVL consistent — drift ${(driftPct * 100).toFixed(4)}%`,
      metadata: {
        onChainTvl: onChainTvl.toString(),
        indexedTvl: indexedTvl.toString(),
        driftPct,
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
      return {
        name: 'epoch_freshness',
        status: 'SKIPPED',
        message: 'Indexed epoch state is unavailable — freshness cannot be checked',
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

      void this.alertService.sendAlert(
        AlertSeverity.WARNING,
        AlertType.EPOCH_STALE,
        `Vault epoch freshness warning: ${reasons.join('; ')}`,
        {
          ageMs,
          staleLimitMs,
          lastUpdated: indexed.lastUpdated,
          indexedEpoch: indexed.currentEpoch,
          protocolEpoch: onChain.protocolEpoch,
          epochLag,
        },
      );
      return {
        name: 'epoch_freshness',
        status: 'WARNING',
        message: reasons.join('; '),
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
      name: 'epoch_freshness',
      status: 'PASS',
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
    if (onChain.epochSource.includes('(fallback)')) {
      return {
        name: 'epoch_resolution',
        status: 'WARNING',
        message: `Authoritative epoch unavailable; using fallback source ${onChain.epochSource}`,
        metadata: {
          epoch: onChain.protocolEpoch,
          latestHeight: onChain.latestHeight,
          epochSource: onChain.epochSource,
        },
      };
    }

    return {
      name: 'epoch_resolution',
      status: 'PASS',
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
      void this.alertService.sendAlert(
        AlertSeverity.CRITICAL,
        AlertType.VALIDATOR_COUNT_DROP,
        `Active validator count (${onChain.activeValidatorCount}) below minimum (${this.minValidators})`,
        {
          activeValidators: onChain.activeValidatorCount,
          totalValidators: onChain.validatorCount,
          minRequired: this.minValidators,
        },
      );
      return {
        name: 'validator_count',
        status: 'CRITICAL',
        message: `Active validators ${onChain.activeValidatorCount} < minimum ${this.minValidators}`,
        metadata: {
          activeValidators: onChain.activeValidatorCount,
          totalValidators: onChain.validatorCount,
          minRequired: this.minValidators,
        },
      };
    }

    return {
      name: 'validator_count',
      status: 'PASS',
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
  private async runStablecoinChecks(): Promise<ReconciliationCheck[]> {
    const checks: ReconciliationCheck[] = [];

    try {
      const configs = await this.prisma.stablecoinConfig.findMany();

      if (configs.length === 0) {
        checks.push({
          name: 'stablecoin_bridge',
          status: 'PASS',
          message: 'No stablecoin configs indexed — bridge checks skipped',
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
      logger.error('Stablecoin reconciliation checks failed', { error });
      checks.push({
        name: 'stablecoin_bridge',
        status: 'WARNING',
        message: `Stablecoin checks failed: ${error instanceof Error ? error.message : String(error)}`,
      });
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
          { error: err instanceof Error ? err.message : String(err) },
        );
      }
    }
  }

  /**
   * Check if any stablecoin has its circuit breaker tripped.
   * A tripped circuit breaker is a CRITICAL alert — bridge operations are halted.
   */
  private async checkCircuitBreakers(
    configs: { assetId: string; symbol: string; circuitBreakerTripped: boolean }[],
  ): Promise<ReconciliationCheck> {
    const tripped = configs.filter((c) => c.circuitBreakerTripped);

    if (tripped.length > 0) {
      const trippedSymbols = tripped.map((c) => c.symbol || c.assetId.slice(0, 10)).join(', ');

      void this.alertService.sendAlert(
        AlertSeverity.CRITICAL,
        AlertType.STABLECOIN_CIRCUIT_BREAKER,
        `Circuit breaker tripped for: ${trippedSymbols}`,
        {
          trippedAssets: tripped.map((c) => ({
            assetId: c.assetId,
            symbol: c.symbol,
          })),
        },
      );

      return {
        name: 'stablecoin_circuit_breaker',
        status: 'CRITICAL',
        message: `Circuit breaker tripped for ${tripped.length} asset(s): ${trippedSymbols}`,
        metadata: { trippedCount: tripped.length, trippedSymbols },
      };
    }

    return {
      name: 'stablecoin_circuit_breaker',
      status: 'PASS',
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
    configs: { assetId: string; symbol: string; dailyLimit: string; dailyUsed: string }[],
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
        .join(', ');

      void this.alertService.sendAlert(
        AlertSeverity.WARNING,
        AlertType.STABLECOIN_RESERVE_DRIFT,
        `Stablecoin daily usage nearing limit: ${details}`,
        { warnings },
      );

      return {
        name: 'stablecoin_daily_usage',
        status: 'WARNING',
        message: `Daily usage warning: ${details}`,
        metadata: { warnings },
      };
    }

    return {
      name: 'stablecoin_daily_usage',
      status: 'PASS',
      message: 'All stablecoin daily usage within safe limits',
    };
  }
}
