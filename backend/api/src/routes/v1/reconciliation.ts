/**
 * Reconciliation API Routes
 */

import { Router, type Request, type Response } from 'express';
import { param, query } from 'express-validator';
import { container } from 'tsyringe';
import { CacheService } from '../../services/CacheService';
import { ReconciliationService } from '../../services/ReconciliationService';
import {
  ReconciliationScheduler,
  type ReconciliationCheck,
  type ReconciliationResult,
} from '../../services/ReconciliationScheduler';
import { authenticate, requireRoles } from '../../auth/middleware';
import { opsRateLimiter } from '../../middleware/rateLimiter';
import { validate } from '../../middleware/validate';
import { asyncHandler } from '../../utils/asyncHandler';

const router = Router();
const cacheService = container.resolve(CacheService);
const reconciliationService = container.resolve(ReconciliationService);
const reconciliationScheduler = container.resolve(ReconciliationScheduler);

type PublicSignalStatus = ReconciliationCheck['status'] | 'UNKNOWN';
type PublicOverallStatus = ReconciliationResult['status'] | 'UNKNOWN';

type PublicReconciliationScorecard = {
  generated_at: string;
  status: PublicOverallStatus;
  epoch: number | null;
  epoch_source: string | null;
  snapshot_age_seconds: number | null;
  validator_coverage_percent: number | null;
  stake_snapshot_status: 'complete' | 'partial' | 'unavailable';
  freshness: {
    status: PublicSignalStatus;
    message: string;
    indexed_epoch: number | null;
    protocol_epoch: number | null;
    epoch_lag: number | null;
    indexed_state_age_seconds: number | null;
    stale_limit_seconds: number | null;
  };
  pillars: Array<{
    key: string;
    label: string;
    status: PublicSignalStatus;
    message: string;
    value?: string;
  }>;
  checks: ReconciliationCheck[];
  evidence: {
    captured_at: string;
    chain_height: number;
    validator_count: number;
    total_eligible_validators: number;
    validator_universe_hash: string;
    stake_snapshot_hash?: string;
    stake_snapshot_complete: boolean | null;
    warning_count: number;
    discrepancy_count: number;
    critical_discrepancy_count: number;
    warning_discrepancy_count: number;
    info_discrepancy_count: number;
    warnings: string[];
    scheduler_timestamp: string | null;
    scheduler_duration_ms: number | null;
  };
};

function getCheck(
  result: ReconciliationResult | null,
  name: string,
): ReconciliationCheck | null {
  return result?.checks.find((check) => check.name === name) ?? null;
}

function getMetadataNumber(
  check: ReconciliationCheck | null,
  key: string,
): number | null {
  const value = check?.metadata?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function getStatusFromEpochSource(epochSource: string | null): PublicSignalStatus {
  if (!epochSource) {
    return 'UNKNOWN';
  }

  return epochSource.includes('(fallback)') ? 'WARNING' : 'PASS';
}

function getSnapshotAgeSeconds(capturedAt: string): number | null {
  const capturedMs = Date.parse(capturedAt);
  if (!Number.isFinite(capturedMs)) {
    return null;
  }

  const ageSeconds = Math.max(0, Math.round((Date.now() - capturedMs) / 1000));
  return Number.isFinite(ageSeconds) ? ageSeconds : null;
}

function buildScorecard(
  summary: Awaited<ReturnType<ReconciliationService['getControlPlaneSummary']>>,
  latestResult: ReconciliationResult | null,
): PublicReconciliationScorecard {
  const epochResolutionCheck = getCheck(latestResult, 'epoch_resolution');
  const epochFreshnessCheck = getCheck(latestResult, 'epoch_freshness');
  const validatorCountCheck = getCheck(latestResult, 'validator_count');

  const snapshotAgeSeconds = getSnapshotAgeSeconds(summary.captured_at);
  const validatorCoveragePercent =
    summary.total_eligible_validators > 0
      ? Number(
          (
            (summary.validator_count / summary.total_eligible_validators) *
            100
          ).toFixed(2),
        )
      : null;
  const stakeSnapshotStatus =
    summary.stake_snapshot_complete === true
      ? 'complete'
      : summary.stake_snapshot_complete === false
        ? 'partial'
        : 'unavailable';
  const freshnessStatus = epochFreshnessCheck?.status ?? 'UNKNOWN';
  const freshnessMessage =
    epochFreshnessCheck?.message ??
    'Public epoch freshness verdict is unavailable until the reconciliation scheduler emits a result.';

  return {
    generated_at: new Date().toISOString(),
    status: latestResult?.status ?? (summary.warning_count > 0 ? 'WARNING' : 'UNKNOWN'),
    epoch: latestResult?.epoch ?? summary.epoch ?? null,
    epoch_source: latestResult?.epochSource ?? summary.epoch_source ?? null,
    snapshot_age_seconds: snapshotAgeSeconds,
    validator_coverage_percent: validatorCoveragePercent,
    stake_snapshot_status: stakeSnapshotStatus,
    freshness: {
      status: freshnessStatus,
      message: freshnessMessage,
      indexed_epoch: getMetadataNumber(epochFreshnessCheck, 'indexedEpoch'),
      protocol_epoch:
        getMetadataNumber(epochFreshnessCheck, 'protocolEpoch') ?? summary.epoch,
      epoch_lag: getMetadataNumber(epochFreshnessCheck, 'epochLag'),
      indexed_state_age_seconds: (() => {
        const ageMs = getMetadataNumber(epochFreshnessCheck, 'ageMs');
        return ageMs == null ? null : Math.round(ageMs / 1000);
      })(),
      stale_limit_seconds: (() => {
        const staleLimitMs = getMetadataNumber(epochFreshnessCheck, 'staleLimitMs');
        return staleLimitMs == null ? null : Math.round(staleLimitMs / 1000);
      })(),
    },
    pillars: [
      {
        key: 'epoch_resolution',
        label: 'Epoch resolution',
        status:
          epochResolutionCheck?.status ??
          getStatusFromEpochSource(summary.epoch_source),
        message:
          epochResolutionCheck?.message ??
          (summary.epoch_source?.includes('(fallback)')
            ? `Authoritative epoch is unavailable; public snapshot is using ${summary.epoch_source}.`
            : `Epoch is being sourced from ${summary.epoch_source}.`),
        value: summary.epoch_source,
      },
      {
        key: 'epoch_freshness',
        label: 'Indexed freshness',
        status: freshnessStatus,
        message: freshnessMessage,
        value:
          getMetadataNumber(epochFreshnessCheck, 'ageMs') != null
            ? `${Math.round(
                (getMetadataNumber(epochFreshnessCheck, 'ageMs') ?? 0) / 1000,
              )}s`
            : snapshotAgeSeconds != null
              ? `${snapshotAgeSeconds}s`
              : 'Unavailable',
      },
      {
        key: 'validator_coverage',
        label: 'Validator coverage',
        status:
          summary.validator_count === summary.total_eligible_validators
            ? 'PASS'
            : 'WARNING',
        message:
          summary.validator_count === summary.total_eligible_validators
            ? 'The public control plane currently represents the full bonded validator universe.'
            : `The public control plane is showing ${summary.validator_count} of ${summary.total_eligible_validators} eligible validators in this snapshot window.`,
        value:
          validatorCoveragePercent == null
            ? 'Unavailable'
            : `${validatorCoveragePercent.toFixed(2)}%`,
      },
      {
        key: 'stake_snapshot',
        label: 'Stake snapshot',
        status:
          summary.stake_snapshot_complete === true
            ? 'PASS'
            : summary.stake_snapshot_complete === false
              ? 'WARNING'
              : 'SKIPPED',
        message:
          summary.stake_snapshot_complete === true
            ? 'Stake snapshot roots and shares are complete for the current public capture.'
            : summary.stake_snapshot_complete === false
              ? 'Stake snapshot is available but incomplete. Treat exported artifacts as partial evidence.'
              : 'Stake snapshot is unavailable for the current public capture.',
        value: stakeSnapshotStatus,
      },
      {
        key: 'discrepancy_burden',
        label: 'Discrepancy burden',
        status:
          summary.critical_discrepancy_count > 0
            ? 'CRITICAL'
            : summary.warning_discrepancy_count > 0
              ? 'WARNING'
              : 'PASS',
        message:
          summary.critical_discrepancy_count > 0
            ? `${summary.critical_discrepancy_count} critical structured discrepancies were recorded in the current capture.`
            : summary.warning_discrepancy_count > 0
              ? `${summary.warning_discrepancy_count} warning-level structured discrepancies were recorded in the current capture.`
              : summary.info_discrepancy_count > 0
                ? `${summary.info_discrepancy_count} informational discrepancies were recorded in the current capture.`
              : 'No structured discrepancies were recorded in the current capture.',
        value: String(summary.discrepancy_count),
      },
      {
        key: 'validator_safety',
        label: 'Validator safety',
        status: validatorCountCheck?.status ?? 'UNKNOWN',
        message:
          validatorCountCheck?.message ??
          'Active validator count verdict is unavailable until the reconciliation scheduler emits a result.',
        value:
          validatorCountCheck?.metadata?.activeValidators != null &&
          validatorCountCheck.metadata?.totalValidators != null
            ? `${String(validatorCountCheck.metadata.activeValidators)}/${String(
                validatorCountCheck.metadata.totalValidators,
              )}`
            : undefined,
      },
    ],
    checks: latestResult?.checks ?? [],
    evidence: {
      captured_at: summary.captured_at,
      chain_height: summary.chain_height,
      validator_count: summary.validator_count,
      total_eligible_validators: summary.total_eligible_validators,
      validator_universe_hash: summary.validator_universe_hash,
      ...(summary.stake_snapshot_hash
        ? { stake_snapshot_hash: summary.stake_snapshot_hash }
        : {}),
      stake_snapshot_complete: summary.stake_snapshot_complete,
      warning_count: summary.warning_count,
      discrepancy_count: summary.discrepancy_count,
      critical_discrepancy_count: summary.critical_discrepancy_count,
      warning_discrepancy_count: summary.warning_discrepancy_count,
      info_discrepancy_count: summary.info_discrepancy_count,
      warnings: summary.warnings,
      scheduler_timestamp: latestResult?.timestamp ?? null,
      scheduler_duration_ms: latestResult?.durationMs ?? null,
    },
  };
}

/**
 * @swagger
 * /v1/reconciliation/live:
 *   get:
 *     summary: Build a read-only live reconciliation document from current chain/indexed state
 *     tags: [Reconciliation]
 *     parameters:
 *       - in: query
 *         name: validator_limit
 *         schema:
 *           type: integer
 *           default: 200
 *           maximum: 500
 *         description: Maximum number of validators to include in the live universe snapshot
 *     responses:
 *       200:
 *         description: Live reconciliation document. Public reads do not persist immutable snapshot history.
 */
router.get(
  '/live',
  [
    query('validator_limit').optional().isInt({ min: 1, max: 500 }).toInt(),
    validate,
  ],
  asyncHandler(async (req: Request, res: Response) => {
    const validatorLimit = Number(req.query.validator_limit ?? 200);
    const cacheKey = `reconciliation:live:${validatorLimit}`;
    const cached = await cacheService.get(cacheKey);

    if (cached) {
      return res.json(cached);
    }

    const result = await reconciliationService.getLiveDocument({
      validatorLimit,
      persist: false,
    });

    await cacheService.set(cacheKey, result, 5);
    res.json(result);
  }),
);

/**
 * @swagger
 * /v1/reconciliation/control-plane:
 *   get:
 *     summary: Get the read-only public reconciliation control-plane summary
 *     tags: [Reconciliation]
 *     responses:
 *       200:
 *         description: Lightweight protocol-truth summary for app surfaces
 */
router.get(
  '/control-plane',
  asyncHandler(async (_req: Request, res: Response) => {
    const cacheKey = 'reconciliation:control-plane';
    const cached = await cacheService.get(cacheKey);

    if (cached) {
      return res.json(cached);
    }

    const result = await reconciliationService.getControlPlaneSummary({
      persist: false,
    });
    await cacheService.set(cacheKey, result, 15);
    res.json(result);
  }),
);

/**
 * @swagger
 * /v1/reconciliation/scorecard:
 *   get:
 *     summary: Get the read-only public reconciliation trust scorecard
 *     tags: [Reconciliation]
 *     responses:
 *       200:
 *         description: Public trust surface combining control-plane lineage and scheduler freshness checks
 */
router.get(
  '/scorecard',
  asyncHandler(async (_req: Request, res: Response) => {
    const cacheKey = 'reconciliation:scorecard';
    const cached = await cacheService.get(cacheKey);

    if (cached) {
      return res.json(cached);
    }

    const summary = await reconciliationService.getControlPlaneSummary({
      persist: false,
    });
    const latestResult = reconciliationScheduler.getLatestResult();
    const result = buildScorecard(summary, latestResult);

    await cacheService.set(cacheKey, result, 15);
    res.json(result);
  }),
);

/**
 * @swagger
 * /v1/reconciliation/capture:
 *   post:
 *     summary: Capture and persist an operator-authorized live reconciliation snapshot
 *     tags: [Reconciliation]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: validator_limit
 *         schema:
 *           type: integer
 *           default: 200
 *           maximum: 500
 *         description: Maximum number of validators to include in the persisted presentation window
 *     responses:
 *       201:
 *         description: Persisted live reconciliation document
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 */
router.post(
  '/capture',
  opsRateLimiter,
  authenticate,
  requireRoles('operator', 'admin'),
  [
    query('validator_limit').optional().isInt({ min: 1, max: 500 }).toInt(),
    validate,
  ],
  asyncHandler(async (req: Request, res: Response) => {
    const validatorLimit = Number(req.query.validator_limit ?? 200);
    const result = await reconciliationService.getLiveDocument({
      validatorLimit,
      persist: true,
    });

    res.status(201).json(result);
  }),
);

/**
 * @swagger
 * /v1/reconciliation/history:
 *   get:
 *     summary: Get immutable reconciliation snapshot history
 *     tags: [Reconciliation]
 */
router.get(
  '/history',
  [query('limit').optional().isInt({ min: 1, max: 100 }).toInt(), validate],
  asyncHandler(async (req: Request, res: Response) => {
    const limit = Number(req.query.limit ?? 20);
    const cacheKey = `reconciliation:history:${limit}`;
    const cached = await cacheService.get(cacheKey);

    if (cached) {
      return res.json(cached);
    }

    const result = await reconciliationService.getHistory(limit);
    await cacheService.set(cacheKey, result, 30);
    res.json(result);
  }),
);

/**
 * @swagger
 * /v1/reconciliation/{epoch}:
 *   get:
 *     summary: Get the latest immutable reconciliation snapshot for a protocol epoch
 *     tags: [Reconciliation]
 */
router.get(
  '/:epoch',
  [param('epoch').isInt({ min: 0 }).toInt(), validate],
  asyncHandler(async (req: Request, res: Response) => {
    const epoch = Number(req.params.epoch);
    const cacheKey = `reconciliation:epoch:${epoch}`;
    const cached = await cacheService.get(cacheKey);

    if (cached) {
      return res.json(cached);
    }

    const result = await reconciliationService.getSnapshotByEpoch(epoch);
    if (!result) {
      return res.status(404).json({
        error: `No reconciliation snapshot found for epoch ${epoch}`,
      });
    }

    await cacheService.set(cacheKey, result, 30);
    res.json(result);
  }),
);

export { router as reconciliationRouter };
