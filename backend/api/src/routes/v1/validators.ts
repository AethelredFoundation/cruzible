/**
 * Validator intelligence API routes.
 */

import { Router, type Request, type Response } from 'express';
import { param, query } from 'express-validator';
import { container } from 'tsyringe';
import { BlockchainService } from '../../services/BlockchainService';
import { CacheService } from '../../services/CacheService';
import {
  ReconciliationScheduler,
  type ReconciliationCheck,
  type ReconciliationResult,
} from '../../services/ReconciliationScheduler';
import { asyncHandler } from '../../utils/asyncHandler';
import { validate } from '../../middleware/validate';
import { ApiError } from '../../utils/ApiError';
import { bytesToHex, computeEligibleUniverseHash } from '../../lib/protocolSdk';
import type { Validator } from '../../types';

const router = Router();
const blockchainService = container.resolve(BlockchainService);
const cacheService = container.resolve(CacheService);
const reconciliationScheduler = container.resolve(ReconciliationScheduler);

const UI_STATUSES = ['active', 'inactive', 'jailed'] as const;
const CHAIN_STATUS_GROUPS = {
  active: ['BOND_STATUS_BONDED'],
  inactive: ['BOND_STATUS_UNBONDED', 'BOND_STATUS_UNBONDING'],
  jailed: ['BOND_STATUS_BONDED', 'BOND_STATUS_UNBONDING', 'BOND_STATUS_UNBONDED'],
  all: ['BOND_STATUS_BONDED', 'BOND_STATUS_UNBONDING', 'BOND_STATUS_UNBONDED'],
} as const;

type UiStatus = (typeof UI_STATUSES)[number];
type FreshnessStatus = ReconciliationCheck['status'] | 'UNKNOWN';
type ReconciliationStatus = ReconciliationResult['status'] | 'UNKNOWN';

type ValidatorRiskComponent = {
  key: string;
  label: string;
  status: 'PASS' | 'WARNING' | 'CRITICAL';
  value: string;
  message: string;
};

type ValidatorRiskAssessment = {
  level: 'low' | 'guarded' | 'elevated' | 'high';
  score: number;
  freshnessStatus: FreshnessStatus;
  reasons: string[];
  components: ValidatorRiskComponent[];
  evidence: {
    eligibleForUniverse: boolean;
    sharePercent: number;
    commissionPercent: number;
    transparencyScore: number;
    snapshotAt: string | null;
    reconciliationStatus: ReconciliationStatus;
    epoch: number | null;
    epochSource: string | null;
    epochLag: number | null;
    indexedStateAgeSeconds: number | null;
    staleLimitSeconds: number | null;
  };
};

type ValidatorProtocolContext = {
  eligibleUniverseHash: string;
  totalListedTokens: string;
  totalBondedTokens: string;
  totalEligibleValidators: number;
  snapshotAt: string | null;
  reconciliationStatus: ReconciliationStatus;
  freshnessStatus: FreshnessStatus;
  freshnessMessage: string;
  epoch: number | null;
  epochSource: string | null;
  epochLag: number | null;
  indexedStateAgeSeconds: number | null;
  staleLimitSeconds: number | null;
};

type CanonicalUniverseContext = {
  eligibleAddresses: Set<string>;
  eligibleUniverseHash: string;
  totalBondedTokens: bigint;
  totalEligibleValidators: number;
};

type FreshnessContext = {
  snapshotAt: string | null;
  reconciliationStatus: ReconciliationStatus;
  freshnessStatus: FreshnessStatus;
  freshnessMessage: string;
  epoch: number | null;
  epochSource: string | null;
  epochLag: number | null;
  indexedStateAgeSeconds: number | null;
  staleLimitSeconds: number | null;
};

function parseTokenAmount(value: string): bigint {
  try {
    return BigInt(value || '0');
  } catch {
    return 0n;
  }
}

function getLifecycleStatus(validator: Validator): UiStatus | 'inactive' {
  if (validator.jailed) {
    return 'jailed';
  }

  const status = String(validator.status).toUpperCase();
  if (status === 'BOND_STATUS_BONDED' || status === 'BONDED' || status === '3') {
    return 'active';
  }

  return 'inactive';
}

function getCommissionPercent(rate: string): number {
  const parsed = Number(rate);
  if (!Number.isFinite(parsed)) {
    return 0;
  }

  return parsed * 100;
}

function getTransparencyScore(validator: Validator): number {
  let score = 0;
  if (validator.moniker) score += 30;
  if (validator.identity) score += 25;
  if (validator.website) score += 25;
  if (validator.details) score += 20;
  return score;
}

function getMetadataNumber(
  check: ReconciliationCheck | null,
  key: string,
): number | null {
  const value = check?.metadata?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function buildFreshnessContext(
  latestResult: ReconciliationResult | null,
): FreshnessContext {
  const epochFreshnessCheck =
    latestResult?.checks.find((check) => check.name === 'epoch_freshness') ?? null;

  return {
    snapshotAt: latestResult?.timestamp ?? null,
    reconciliationStatus: latestResult?.status ?? 'UNKNOWN',
    freshnessStatus: epochFreshnessCheck?.status ?? 'UNKNOWN',
    freshnessMessage:
      epochFreshnessCheck?.message ??
      'Validator freshness is unknown until the reconciliation scheduler emits a public result.',
    epoch: latestResult?.epoch ?? null,
    epochSource: latestResult?.epochSource ?? null,
    epochLag: getMetadataNumber(epochFreshnessCheck, 'epochLag'),
    indexedStateAgeSeconds: (() => {
      const ageMs = getMetadataNumber(epochFreshnessCheck, 'ageMs');
      return ageMs == null ? null : Math.round(ageMs / 1000);
    })(),
    staleLimitSeconds: (() => {
      const staleLimitMs = getMetadataNumber(epochFreshnessCheck, 'staleLimitMs');
      return staleLimitMs == null ? null : Math.round(staleLimitMs / 1000);
    })(),
  };
}

function buildRiskAssessment(
  validator: Validator,
  canonicalContext: CanonicalUniverseContext,
  freshness: FreshnessContext,
): ValidatorRiskAssessment {
  const lifecycleStatus = getLifecycleStatus(validator);
  const commissionPercent = getCommissionPercent(validator.commission.rate);
  const transparencyScore = getTransparencyScore(validator);
  const eligibleForUniverse = canonicalContext.eligibleAddresses.has(validator.address);
  const sharePercent =
    eligibleForUniverse && canonicalContext.totalBondedTokens > 0n
      ? Number(
          (
            Number(
              (parseTokenAmount(validator.tokens) * 10_000n) /
                canonicalContext.totalBondedTokens,
            ) / 100
          ).toFixed(2),
        )
      : 0;

  const components: ValidatorRiskComponent[] = [];
  let score = 0;

  const pushComponent = (
    component: ValidatorRiskComponent,
    weight: number,
  ) => {
    components.push(component);
    score += weight;
  };

  if (lifecycleStatus === 'jailed') {
    pushComponent(
      {
        key: 'lifecycle',
        label: 'Lifecycle status',
        status: 'CRITICAL',
        value: 'jailed',
        message:
          'This validator is jailed in the staking module, which is treated as a severe operator-risk signal.',
      },
      55,
    );
  } else if (lifecycleStatus === 'inactive') {
    pushComponent(
      {
        key: 'lifecycle',
        label: 'Lifecycle status',
        status: 'WARNING',
        value: 'inactive',
        message:
          'This validator is not part of the currently bonded universe, so it is excluded from canonical validator-set coverage.',
      },
      24,
    );
  } else {
    components.push({
      key: 'lifecycle',
      label: 'Lifecycle status',
      status: 'PASS',
      value: 'active',
      message: 'This validator is active in the current staking set.',
    });
  }

  if (sharePercent >= 10) {
    pushComponent(
      {
        key: 'concentration',
        label: 'Stake concentration',
        status: 'CRITICAL',
        value: `${sharePercent.toFixed(2)}%`,
        message:
          'This validator controls a large share of the bonded universe, which increases concentration risk.',
      },
      18,
    );
  } else if (sharePercent >= 5) {
    pushComponent(
      {
        key: 'concentration',
        label: 'Stake concentration',
        status: 'WARNING',
        value: `${sharePercent.toFixed(2)}%`,
        message:
          'This validator represents a meaningful share of the bonded universe and should be monitored for concentration drift.',
      },
      10,
    );
  } else {
    components.push({
      key: 'concentration',
      label: 'Stake concentration',
      status: 'PASS',
      value: `${sharePercent.toFixed(2)}%`,
      message:
        'Observed stake concentration for this validator remains below the current warning threshold.',
    });
  }

  if (commissionPercent >= 10) {
    pushComponent(
      {
        key: 'commission',
        label: 'Commission posture',
        status: 'WARNING',
        value: `${commissionPercent.toFixed(2)}%`,
        message:
          'Commission is above the current Cruzible review threshold and may reduce net user yield.',
      },
      10,
    );
  } else {
    components.push({
      key: 'commission',
      label: 'Commission posture',
      status: 'PASS',
      value: `${commissionPercent.toFixed(2)}%`,
      message: 'Commission is within the current review threshold.',
    });
  }

  if (transparencyScore < 60) {
    pushComponent(
      {
        key: 'transparency',
        label: 'Operator transparency',
        status: 'WARNING',
        value: `${transparencyScore}%`,
        message:
          'Operator metadata is incomplete. Missing identity, website, or details reduces reviewability.',
      },
      12,
    );
  } else {
    components.push({
      key: 'transparency',
      label: 'Operator transparency',
      status: 'PASS',
      value: `${transparencyScore}%`,
      message:
        'Operator metadata is sufficiently populated for public due diligence.',
    });
  }

  if (freshness.freshnessStatus === 'CRITICAL') {
    pushComponent(
      {
        key: 'freshness',
        label: 'Snapshot freshness',
        status: 'CRITICAL',
        value:
          freshness.indexedStateAgeSeconds == null
            ? 'critical'
            : `${freshness.indexedStateAgeSeconds}s old`,
        message: freshness.freshnessMessage,
      },
      20,
    );
  } else if (freshness.freshnessStatus === 'WARNING' || freshness.freshnessStatus === 'UNKNOWN') {
    pushComponent(
      {
        key: 'freshness',
        label: 'Snapshot freshness',
        status: 'WARNING',
        value:
          freshness.indexedStateAgeSeconds == null
            ? freshness.freshnessStatus.toLowerCase()
            : `${freshness.indexedStateAgeSeconds}s old`,
        message: freshness.freshnessMessage,
      },
      freshness.freshnessStatus === 'UNKNOWN' ? 6 : 10,
    );
  } else {
    components.push({
      key: 'freshness',
      label: 'Snapshot freshness',
      status: 'PASS',
      value:
        freshness.indexedStateAgeSeconds == null
          ? 'fresh'
          : `${freshness.indexedStateAgeSeconds}s old`,
      message: freshness.freshnessMessage,
    });
  }

  const normalizedScore = Math.max(0, Math.min(100, Math.round(score)));
  const level =
    normalizedScore >= 60
      ? 'high'
      : normalizedScore >= 35
        ? 'elevated'
        : normalizedScore >= 15
          ? 'guarded'
          : 'low';

  const reasons = components
    .filter((component) => component.status !== 'PASS')
    .map((component) => component.message);

  return {
    level,
    score: normalizedScore,
    freshnessStatus: freshness.freshnessStatus,
    reasons:
      reasons.length > 0
        ? reasons
        : ['Validator is active, transparent, and within the current freshness bounds.'],
    components,
    evidence: {
      eligibleForUniverse,
      sharePercent,
      commissionPercent,
      transparencyScore,
      snapshotAt: freshness.snapshotAt,
      reconciliationStatus: freshness.reconciliationStatus,
      epoch: freshness.epoch,
      epochSource: freshness.epochSource,
      epochLag: freshness.epochLag,
      indexedStateAgeSeconds: freshness.indexedStateAgeSeconds,
      staleLimitSeconds: freshness.staleLimitSeconds,
    },
  };
}

function enrichValidator(
  validator: Validator,
  canonicalContext: CanonicalUniverseContext,
  freshness: FreshnessContext,
) {
  const tokenAmount = parseTokenAmount(validator.tokens);
  const eligibleForUniverse = canonicalContext.eligibleAddresses.has(validator.address);
  const sharePercent =
    eligibleForUniverse && canonicalContext.totalBondedTokens > 0n
      ? Number((tokenAmount * 10_000n) / canonicalContext.totalBondedTokens) / 100
      : 0;

  return {
    ...validator,
    lifecycleStatus: getLifecycleStatus(validator),
    commissionPercent: getCommissionPercent(validator.commission.rate),
    transparencyScore: getTransparencyScore(validator),
    sharePercent,
    eligibleForUniverse,
    risk: buildRiskAssessment(validator, canonicalContext, freshness),
  };
}

async function loadCanonicalUniverseContext(): Promise<CanonicalUniverseContext> {
  const response = await blockchainService.getValidators({
    limit: 10_000,
    offset: 0,
    status: 'BOND_STATUS_BONDED',
  });

  const eligibleAddresses = response.data.map((validator) => validator.address);
  const totalBondedTokens = response.data.reduce(
    (sum, validator) => sum + parseTokenAmount(validator.tokens),
    0n,
  );

  return {
    eligibleAddresses: new Set(eligibleAddresses),
    eligibleUniverseHash: bytesToHex(
      computeEligibleUniverseHash(eligibleAddresses),
    ),
    totalBondedTokens,
    totalEligibleValidators: eligibleAddresses.length,
  };
}

async function loadValidators(status?: UiStatus, limit = 50, offset = 0) {
  const fetchLimit = Math.min(Math.max(limit + offset, 100), 500);
  const chainStatuses = status ? CHAIN_STATUS_GROUPS[status] : CHAIN_STATUS_GROUPS.all;

  const responses = await Promise.all(
    chainStatuses.map((chainStatus) =>
      blockchainService.getValidators({
        limit: fetchLimit,
        offset: 0,
        status: chainStatus,
      }),
    ),
  );

  const byAddress = new Map<string, Validator>();
  for (const response of responses) {
    for (const validator of response.data) {
      byAddress.set(validator.address, validator);
    }
  }

  return Array.from(byAddress.values());
}

function buildProtocolContext(
  filteredValidators: Validator[],
  canonicalContext: CanonicalUniverseContext,
  freshness: FreshnessContext,
): ValidatorProtocolContext {
  const totalListedTokens = filteredValidators.reduce(
    (sum, validator) => sum + parseTokenAmount(validator.tokens),
    0n,
  );

  return {
    eligibleUniverseHash: canonicalContext.eligibleUniverseHash,
    totalListedTokens: totalListedTokens.toString(),
    totalBondedTokens: canonicalContext.totalBondedTokens.toString(),
    totalEligibleValidators: canonicalContext.totalEligibleValidators,
    snapshotAt: freshness.snapshotAt,
    reconciliationStatus: freshness.reconciliationStatus,
    freshnessStatus: freshness.freshnessStatus,
    freshnessMessage: freshness.freshnessMessage,
    epoch: freshness.epoch,
    epochSource: freshness.epochSource,
    epochLag: freshness.epochLag,
    indexedStateAgeSeconds: freshness.indexedStateAgeSeconds,
    staleLimitSeconds: freshness.staleLimitSeconds,
  };
}

/**
 * @swagger
 * /v1/validators:
 *   get:
 *     summary: Get validator intelligence list
 *     tags: [Validators]
 */
router.get(
  '/',
  [
    query('limit').optional().isInt({ min: 1, max: 200 }).toInt(),
    query('offset').optional().isInt({ min: 0 }).toInt(),
    query('status').optional().isIn(UI_STATUSES),
    query('min_voting_power').optional().isInt({ min: 0 }).toInt(),
    validate,
  ],
  asyncHandler(async (req: Request, res: Response) => {
    const {
      limit = 50,
      offset = 0,
      status,
      min_voting_power,
    } = req.query as {
      limit?: number;
      offset?: number;
      status?: UiStatus;
      min_voting_power?: number;
    };

    const cacheKey = [
      'validators:list',
      limit,
      offset,
      status ?? 'all',
      min_voting_power ?? 'all',
    ].join(':');

    const cached = await cacheService.get(cacheKey);
    if (cached) {
      return res.json(cached);
    }

    const [validators, canonicalContext] = await Promise.all([
      loadValidators(status, limit, offset),
      loadCanonicalUniverseContext(),
    ]);
    const freshness = buildFreshnessContext(reconciliationScheduler.getLatestResult());

    const filtered = validators
      .filter((validator) => {
        if (status && getLifecycleStatus(validator) !== status) {
          return false;
        }

        if (
          typeof min_voting_power === 'number' &&
          parseTokenAmount(validator.tokens) < BigInt(min_voting_power)
        ) {
          return false;
        }

        return true;
      })
      .sort((left, right) => {
        const leftStake = parseTokenAmount(left.tokens);
        const rightStake = parseTokenAmount(right.tokens);
        if (leftStake === rightStake) {
          return (left.moniker || left.address).localeCompare(
            right.moniker || right.address,
          );
        }
        return leftStake > rightStake ? -1 : 1;
      });

    const paged = filtered.slice(offset, offset + limit);
    const response = {
      data: paged.map((validator) =>
        enrichValidator(validator, canonicalContext, freshness),
      ),
      pagination: {
        limit,
        offset,
        total: filtered.length,
        hasMore: offset + paged.length < filtered.length,
      },
      protocol: buildProtocolContext(filtered, canonicalContext, freshness),
    };

    await cacheService.set(cacheKey, response, 15);
    res.json(response);
  }),
);

/**
 * @swagger
 * /v1/validators/{address}:
 *   get:
 *     summary: Get validator by operator address
 *     tags: [Validators]
 */
router.get(
  '/:address',
  [
    param('address')
      .isString()
      .trim()
      .notEmpty()
      .isLength({ max: 64 })
      .matches(/^[a-z0-9]+$/),
    validate,
  ],
  asyncHandler(async (req: Request, res: Response) => {
    const { address } = req.params;

    const cacheKey = `validators:${address}`;
    const cached = await cacheService.get(cacheKey);
    if (cached) {
      return res.json(cached);
    }

    const [validator, canonicalContext] = await Promise.all([
      blockchainService.getValidator(address),
      loadCanonicalUniverseContext(),
    ]);
    if (!validator) {
      throw new ApiError(404, `Validator ${address} not found`);
    }

    const freshness = buildFreshnessContext(reconciliationScheduler.getLatestResult());
    const response = {
      validator: enrichValidator(validator, canonicalContext, freshness),
      protocol: buildProtocolContext([validator], canonicalContext, freshness),
    };

    await cacheService.set(cacheKey, response, 15);
    res.json(response);
  }),
);

export { router as validatorsRouter };
