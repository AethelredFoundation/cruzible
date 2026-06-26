import { apiJson, apiRequest, parseApiJsonResponse } from "@/lib/api-request";

const DETAIL_FALLBACK_STATUSES = new Set([404, 405, 501]);

export type ValidatorLifecycleStatus = "active" | "inactive" | "jailed";
export type ValidatorRiskLevel = "low" | "guarded" | "elevated" | "high";
export type ValidatorRiskStatus =
  | "PASS"
  | "WARNING"
  | "CRITICAL"
  | "SKIPPED"
  | "UNKNOWN";
export type ValidatorDataQualityTone =
  | "healthy"
  | "warning"
  | "critical"
  | "unknown";

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

export interface ValidatorDataQualitySignal {
  id: string;
  title: string;
  status: string;
  detail: string;
  tone: ValidatorDataQualityTone;
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

  return apiJson<ValidatorsResponse>(`/validators?${params.toString()}`, {
    fallbackMessage: "Failed to fetch validators",
  });
}

export async function fetchValidator(
  address: string,
): Promise<ValidatorDetailResponse> {
  const detailResponse = await apiRequest(
    `/validators/${encodeURIComponent(address)}`,
  );

  if (detailResponse.ok) {
    const payload = await parseApiJsonResponse<
      ValidatorRecord | ValidatorDetailResponse
    >(detailResponse);
    if ("validator" in payload) {
      return payload;
    }
    return { validator: payload };
  }

  if (!DETAIL_FALLBACK_STATUSES.has(detailResponse.status)) {
    throw new Error(`Failed to fetch validator: HTTP ${detailResponse.status}`);
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

function riskStatusToQualityTone(
  status?: ValidatorRiskStatus | string | null,
): ValidatorDataQualityTone {
  const normalized = (status || "UNKNOWN").toUpperCase();

  if (normalized === "PASS") {
    return "healthy";
  }

  if (normalized === "WARNING" || normalized === "SKIPPED") {
    return "warning";
  }

  if (normalized === "CRITICAL") {
    return "critical";
  }

  return "unknown";
}

export function buildValidatorDataQualitySignals(
  protocol?: ValidatorsProtocolContext,
  validator?: ValidatorRecord,
): ValidatorDataQualitySignal[] {
  const evidence = validator?.risk?.evidence;
  const freshnessStatus =
    validator?.risk?.freshnessStatus ?? protocol?.freshnessStatus ?? "UNKNOWN";
  const indexedStateAgeSeconds =
    evidence?.indexedStateAgeSeconds ??
    protocol?.indexedStateAgeSeconds ??
    null;
  const staleLimitSeconds =
    evidence?.staleLimitSeconds ?? protocol?.staleLimitSeconds ?? null;
  const snapshotAt = evidence?.snapshotAt ?? protocol?.snapshotAt ?? null;
  const epoch = evidence?.epoch ?? protocol?.epoch ?? null;
  const epochSource = evidence?.epochSource ?? protocol?.epochSource ?? null;
  const epochLag = evidence?.epochLag ?? protocol?.epochLag ?? null;
  const reconciliationStatus =
    evidence?.reconciliationStatus ??
    protocol?.reconciliationStatus ??
    "UNKNOWN";

  const signals: ValidatorDataQualitySignal[] = [
    {
      id: "freshness",
      title: "Freshness",
      status: String(freshnessStatus).toLowerCase(),
      detail:
        protocol?.freshnessMessage ||
        `Indexed state age is ${formatAgeSeconds(
          indexedStateAgeSeconds,
        )}; stale limit is ${formatAgeSeconds(staleLimitSeconds)}.`,
      tone: riskStatusToQualityTone(freshnessStatus),
    },
    {
      id: "reconciliation",
      title: "Reconciliation",
      status: String(reconciliationStatus).toLowerCase(),
      detail:
        "Validator risk posture is tied to the latest public reconciliation status returned by the backend.",
      tone: riskStatusToQualityTone(
        reconciliationStatus === "OK" ? "PASS" : reconciliationStatus,
      ),
    },
    snapshotAt
      ? {
          id: "snapshot",
          title: "Snapshot",
          status: "timestamped",
          detail: `Snapshot timestamp: ${new Date(snapshotAt).toLocaleString()}.`,
          tone: "healthy",
        }
      : {
          id: "snapshot",
          title: "Snapshot",
          status: "missing",
          detail:
            "No snapshot timestamp was returned, so operators should treat the validator view as incomplete.",
          tone: "warning",
        },
    protocol?.eligibleUniverseHash
      ? {
          id: "universe-hash",
          title: "Universe hash",
          status: "available",
          detail:
            "The eligible validator universe hash is present for reconciliation and copy/export review.",
          tone: "healthy",
        }
      : {
          id: "universe-hash",
          title: "Universe hash",
          status: "unavailable",
          detail:
            "The eligible validator universe hash is missing from this response.",
          tone: "warning",
        },
    epoch != null && epochSource
      ? {
          id: "epoch-source",
          title: "Epoch source",
          status: epochLag && epochLag > 0 ? `lag ${epochLag}` : "current",
          detail: `Epoch ${epoch} from ${epochSource}.`,
          tone: epochLag && epochLag > 0 ? "warning" : "healthy",
        }
      : {
          id: "epoch-source",
          title: "Epoch source",
          status: "unavailable",
          detail: "Epoch source or epoch number was not returned.",
          tone: "unknown",
        },
  ];

  if (validator) {
    signals.push(
      validator.risk?.components?.length
        ? {
            id: "risk-components",
            title: "Risk components",
            status: `${validator.risk.components.length} checks`,
            detail:
              "Backend-owned lifecycle, concentration, commission, transparency, and freshness checks are attached to this validator.",
            tone: "healthy",
          }
        : {
            id: "risk-components",
            title: "Risk components",
            status: "missing",
            detail:
              "No risk component breakdown was returned for this validator.",
            tone: "warning",
          },
    );
  }

  return signals;
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
