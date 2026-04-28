import { getApiUrl } from "@/config/api";

export type ValidatorLifecycleStatus = "active" | "inactive" | "jailed";
export type ValidatorRiskLevel = "low" | "guarded" | "elevated" | "high";
export type ValidatorRiskStatus =
  | "PASS"
  | "WARNING"
  | "CRITICAL"
  | "SKIPPED"
  | "UNKNOWN";

export interface ValidatorRiskComponent {
  key: string;
  label: string;
  status: "PASS" | "WARNING" | "CRITICAL";
  value: string;
  message: string;
}

export interface ValidatorRiskAssessment {
  level: ValidatorRiskLevel;
  score: number;
  freshnessStatus: ValidatorRiskStatus;
  reasons: string[];
  components: ValidatorRiskComponent[];
  evidence: {
    eligibleForUniverse: boolean;
    sharePercent: number;
    commissionPercent: number;
    transparencyScore: number;
    snapshotAt: string | null;
    reconciliationStatus: "OK" | "WARNING" | "CRITICAL" | "UNKNOWN";
    epoch: number | null;
    epochSource: string | null;
    epochLag: number | null;
    indexedStateAgeSeconds: number | null;
    staleLimitSeconds: number | null;
  };
}

export interface ValidatorRecord {
  address: string;
  moniker: string;
  identity: string;
  website: string;
  details: string;
  tokens: string;
  delegatorShares: string;
  commission: {
    rate: string;
    maxRate: string;
    maxChangeRate: string;
  };
  status: string | number;
  jailed: boolean;
  unbondingHeight: number;
  unbondingTime: number;
  lifecycleStatus?: ValidatorLifecycleStatus;
  commissionPercent?: number;
  transparencyScore?: number;
  sharePercent?: number;
  eligibleForUniverse?: boolean;
  risk?: ValidatorRiskAssessment;
}

export interface ValidatorsProtocolContext {
  eligibleUniverseHash?: string;
  totalListedTokens?: string;
  totalBondedTokens?: string;
  totalEligibleValidators?: number;
  snapshotAt?: string | null;
  reconciliationStatus?: "OK" | "WARNING" | "CRITICAL" | "UNKNOWN";
  freshnessStatus?: ValidatorRiskStatus;
  freshnessMessage?: string;
  epoch?: number | null;
  epochSource?: string | null;
  epochLag?: number | null;
  indexedStateAgeSeconds?: number | null;
  staleLimitSeconds?: number | null;
}

export interface ValidatorsResponse {
  data: ValidatorRecord[];
  pagination: {
    limit: number;
    offset: number;
    total: number;
    hasMore: boolean;
  };
  protocol?: ValidatorsProtocolContext;
}

export interface ValidatorDetailResponse {
  validator: ValidatorRecord;
  protocol?: ValidatorsProtocolContext;
}

export interface ValidatorMetrics {
  activeCount: number;
  jailedCount: number;
  identityCoverage: number;
  websiteCoverage: number;
  topTenShare: number;
  nakamoto33: number;
  averageCommission: number;
  totalStake: bigint;
}

export async function fetchValidators(options?: {
  limit?: number;
  offset?: number;
  status?: ValidatorLifecycleStatus | "";
}): Promise<ValidatorsResponse> {
  const params = new URLSearchParams();
  params.set("limit", String(options?.limit ?? 100));
  params.set("offset", String(options?.offset ?? 0));
  if (options?.status) {
    params.set("status", options.status);
  }

  const response = await fetch(getApiUrl(`/validators?${params.toString()}`));
  if (!response.ok) {
    throw new Error("Failed to fetch validators");
  }

  return response.json();
}

export async function fetchValidator(
  address: string,
): Promise<ValidatorDetailResponse> {
  const detailResponse = await fetch(
    getApiUrl(`/validators/${encodeURIComponent(address)}`),
  );

  if (detailResponse.ok) {
    const payload = (await detailResponse.json()) as
      | ValidatorRecord
      | ValidatorDetailResponse;
    if ("validator" in payload) {
      return payload;
    }
    return { validator: payload };
  }

  const listResponse = await fetchValidators({ limit: 200 });
  const validator = listResponse.data.find(
    (entry) => entry.address === address,
  );
  if (!validator) {
    throw new Error("Validator not found");
  }

  return { validator, protocol: listResponse.protocol };
}

export function getValidatorStatus(
  validator: ValidatorRecord,
): ValidatorLifecycleStatus {
  if (validator.lifecycleStatus) {
    return validator.lifecycleStatus;
  }

  if (validator.jailed) {
    return "jailed";
  }

  const status = String(validator.status).toUpperCase();
  if (
    status === "BOND_STATUS_BONDED" ||
    status === "BONDED" ||
    status === "3"
  ) {
    return "active";
  }

  return "inactive";
}

export function getCommissionPercent(rate: string): number {
  const parsed = Number(rate);
  if (!Number.isFinite(parsed)) {
    return 0;
  }

  return parsed * 100;
}

export function parseTokenAmount(value: string): bigint {
  try {
    return BigInt(value || "0");
  } catch {
    return 0n;
  }
}

export function formatRawTokenAmount(value: string): string {
  const raw = value || "0";
  const sanitized = raw.replace(/^0+/, "") || "0";
  const units = [
    { digits: 15, suffix: "Q" },
    { digits: 12, suffix: "T" },
    { digits: 9, suffix: "B" },
    { digits: 6, suffix: "M" },
    { digits: 3, suffix: "K" },
  ];

  for (const unit of units) {
    if (sanitized.length > unit.digits) {
      const whole = sanitized.slice(0, sanitized.length - unit.digits);
      const fraction = sanitized
        .slice(
          sanitized.length - unit.digits,
          sanitized.length - unit.digits + 2,
        )
        .replace(/0+$/, "");
      return `${whole}${fraction ? `.${fraction}` : ""}${unit.suffix}`;
    }
  }

  return sanitized.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

export function formatTimestamp(timestamp: number): string {
  if (!timestamp) {
    return "n/a";
  }

  return new Date(timestamp).toLocaleString();
}

export function formatAgeSeconds(seconds?: number | null): string {
  if (seconds == null || !Number.isFinite(seconds)) {
    return "Unavailable";
  }

  if (seconds < 60) {
    return `${seconds}s`;
  }

  const minutes = Math.round(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m`;
  }

  const hours = Math.round(minutes / 60);
  return `${hours}h`;
}

export function getSharePercent(value: string | bigint, total: bigint): number {
  const numericValue =
    typeof value === "bigint" ? value : parseTokenAmount(value);
  if (total <= 0n || numericValue <= 0n) {
    return 0;
  }

  const basisPoints = Number((numericValue * 10000n) / total);
  return basisPoints / 100;
}

export function getValidatorSharePercent(
  validator: ValidatorRecord,
  total: bigint,
): number {
  if (
    typeof validator.sharePercent === "number" &&
    Number.isFinite(validator.sharePercent)
  ) {
    return validator.sharePercent;
  }

  return getSharePercent(validator.tokens, total);
}

export function getProfileCompleteness(validator: ValidatorRecord): number {
  if (
    typeof validator.transparencyScore === "number" &&
    Number.isFinite(validator.transparencyScore)
  ) {
    return validator.transparencyScore;
  }

  let score = 0;

  if (validator.moniker) score += 30;
  if (validator.identity) score += 25;
  if (validator.website) score += 25;
  if (validator.details) score += 20;

  return score;
}

export function buildValidatorMetrics(
  validators: ValidatorRecord[],
  options?: {
    totalStakeOverride?: string | bigint;
  },
): ValidatorMetrics {
  const computedTotalStake = validators.reduce(
    (sum, validator) => sum + parseTokenAmount(validator.tokens),
    0n,
  );
  const totalStake =
    typeof options?.totalStakeOverride === "bigint"
      ? options.totalStakeOverride
      : typeof options?.totalStakeOverride === "string"
        ? parseTokenAmount(options.totalStakeOverride)
        : computedTotalStake;

  const activeCount = validators.filter(
    (validator) => getValidatorStatus(validator) === "active",
  ).length;
  const jailedCount = validators.filter(
    (validator) => getValidatorStatus(validator) === "jailed",
  ).length;
  const identityCoverage =
    validators.length > 0
      ? Math.round(
          (validators.filter((validator) => Boolean(validator.identity))
            .length /
            validators.length) *
            100,
        )
      : 0;
  const websiteCoverage =
    validators.length > 0
      ? Math.round(
          (validators.filter((validator) => Boolean(validator.website)).length /
            validators.length) *
            100,
        )
      : 0;
  const averageCommission =
    validators.length > 0
      ? validators.reduce(
          (sum, validator) =>
            sum +
            (typeof validator.commissionPercent === "number"
              ? validator.commissionPercent
              : getCommissionPercent(validator.commission.rate)),
          0,
        ) / validators.length
      : 0;

  const sortedByStake = [...validators].sort((left, right) => {
    const leftStake = parseTokenAmount(left.tokens);
    const rightStake = parseTokenAmount(right.tokens);
    if (leftStake === rightStake) {
      return left.moniker.localeCompare(right.moniker);
    }
    return leftStake > rightStake ? -1 : 1;
  });

  const topTenStake = sortedByStake
    .slice(0, 10)
    .reduce((sum, validator) => sum + parseTokenAmount(validator.tokens), 0n);
  const topTenShare = getSharePercent(topTenStake, totalStake);

  let runningStake = 0n;
  let nakamoto33 = 0;
  for (const validator of sortedByStake) {
    runningStake += parseTokenAmount(validator.tokens);
    nakamoto33 += 1;
    if (totalStake > 0n && runningStake * 100n >= totalStake * 33n) {
      break;
    }
  }

  return {
    activeCount,
    jailedCount,
    identityCoverage,
    websiteCoverage,
    topTenShare,
    nakamoto33,
    averageCommission,
    totalStake,
  };
}
