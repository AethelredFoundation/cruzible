import { getApiUrl } from "@/config/api";

export type SealLifecycleStatus =
  | "active"
  | "revoked"
  | "expired"
  | "superseded"
  | "unknown";

export type SealSortKey =
  | "created_at:desc"
  | "created_at:asc"
  | "expires_at:asc"
  | "expires_at:desc";

export interface SealListItem {
  id: string;
  jobId: string;
  status: SealLifecycleStatus;
  modelCommitment: string;
  inputCommitment: string;
  outputCommitment: string;
  requester: string;
  validatorCount: number;
  createdAt: string;
  expiresAt: string | null;
}

export interface SealJobRecord {
  id: string;
  status: string;
  modelHash: string;
  modelName: string;
  proofType: string;
  verificationScore: string;
  createdAt: string | null;
  completedAt: string | null;
  outputHash: string;
  creatorAddress: string;
  validatorAddress: string;
}

export interface SealComputeMetrics {
  cpuCycles: string;
  memoryUsed: string;
  computeTimeMs: string;
  energyMj: string;
}

export interface SealProofLineageRecord {
  proofType: string;
  merkleRoot: string;
  validatorSignatureCount: number;
  teeType: string;
  teeTimestamp: string | null;
  teeMeasurement: string;
  computeMetrics: SealComputeMetrics | null;
}

export interface SealDetailRecord extends SealListItem {
  validators: string[];
  revokedAt: string | null;
  revokedBy: string;
  revocationReason: string;
  job: SealJobRecord | null;
  proofLineage: SealProofLineageRecord | null;
  detailAvailable: boolean;
}

export interface SealsResponse {
  seals: SealListItem[];
  total: number;
}

export interface SealMetrics {
  activeCount: number;
  revokedOrSupersededCount: number;
  expiringSoonCount: number;
  averageValidatorQuorum: number;
  commitmentCoverage: number;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, unknown>;
}

function asString(value: unknown): string {
  if (typeof value === "string") {
    return value.trim();
  }

  if (typeof value === "number" || typeof value === "bigint") {
    return String(value);
  }

  return "";
}

function asNumber(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return 0;
}

function asIsoTimestamp(value: unknown): string | null {
  if (!value) {
    return null;
  }

  if (typeof value === "number") {
    const milliseconds = value > 10_000_000_000 ? value : value * 1000;
    const parsed = new Date(milliseconds);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  }

  if (typeof value === "string") {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString();
    }
  }

  return null;
}

export function normalizeSealStatus(value: unknown): SealLifecycleStatus {
  const normalized = asString(value).toLowerCase().replace("seal_status_", "");

  if (
    normalized === "active" ||
    normalized === "revoked" ||
    normalized === "expired" ||
    normalized === "superseded"
  ) {
    return normalized;
  }

  return "unknown";
}

function normalizeSealListItem(raw: unknown): SealListItem | null {
  const record = asRecord(raw);
  if (!record) {
    return null;
  }

  const id = asString(record.id);
  if (!id) {
    return null;
  }

  const validators = Array.isArray(record.validators)
    ? record.validators.filter((value) => typeof value === "string")
    : [];
  const createdAt =
    asIsoTimestamp(record.createdAt ?? record.created_at) ??
    new Date(0).toISOString();

  return {
    id,
    jobId: asString(record.jobId ?? record.job_id ?? asRecord(record.job)?.id),
    status: normalizeSealStatus(record.status),
    modelCommitment: asString(
      record.modelCommitment ?? record.model_commitment,
    ),
    inputCommitment: asString(
      record.inputCommitment ?? record.input_commitment,
    ),
    outputCommitment: asString(
      record.outputCommitment ?? record.output_commitment,
    ),
    requester: asString(record.requester),
    validatorCount: asNumber(
      record.validatorCount ?? record.validator_count ?? validators.length,
    ),
    createdAt,
    expiresAt: asIsoTimestamp(record.expiresAt ?? record.expires_at),
  };
}

function normalizeJob(
  raw: unknown,
  fallbackJobId: string,
): SealJobRecord | null {
  const record = asRecord(raw);
  if (!record && !fallbackJobId) {
    return null;
  }

  return {
    id: asString(record?.id ?? fallbackJobId),
    status: asString(record?.status),
    modelHash: asString(record?.modelHash ?? record?.model_hash),
    modelName: asString(record?.modelName ?? record?.model_name),
    proofType: asString(record?.proofType ?? record?.proof_type),
    verificationScore: asString(
      record?.verificationScore ?? record?.verification_score,
    ),
    createdAt: asIsoTimestamp(record?.createdAt ?? record?.created_at),
    completedAt: asIsoTimestamp(record?.completedAt ?? record?.completed_at),
    outputHash: asString(record?.outputHash ?? record?.output_hash),
    creatorAddress: asString(record?.creatorAddress ?? record?.creator_address),
    validatorAddress: asString(
      record?.validatorAddress ?? record?.validator_address,
    ),
  };
}

function normalizeProofLineage(raw: unknown): SealProofLineageRecord | null {
  const record = asRecord(raw);
  if (!record) {
    return null;
  }

  const computeMetricsRecord = asRecord(
    record.computeMetrics ?? record.compute_metrics,
  );

  return {
    proofType: asString(record.proofType ?? record.proof_type),
    merkleRoot: asString(record.merkleRoot ?? record.merkle_root),
    validatorSignatureCount: asNumber(
      record.validatorSignatureCount ?? record.validator_signature_count,
    ),
    teeType: asString(record.teeType ?? record.tee_type),
    teeTimestamp: asIsoTimestamp(record.teeTimestamp ?? record.tee_timestamp),
    teeMeasurement: asString(record.teeMeasurement ?? record.tee_measurement),
    computeMetrics: computeMetricsRecord
      ? {
          cpuCycles: asString(
            computeMetricsRecord.cpuCycles ?? computeMetricsRecord.cpu_cycles,
          ),
          memoryUsed: asString(
            computeMetricsRecord.memoryUsed ?? computeMetricsRecord.memory_used,
          ),
          computeTimeMs: asString(
            computeMetricsRecord.computeTimeMs ??
              computeMetricsRecord.compute_time_ms,
          ),
          energyMj: asString(
            computeMetricsRecord.energyMj ?? computeMetricsRecord.energy_mj,
          ),
        }
      : null,
  };
}

function normalizeSealDetail(
  raw: unknown,
  fallback?: SealListItem | null,
  detailAvailable = true,
): SealDetailRecord | null {
  const normalizedBase = normalizeSealListItem(raw) ?? fallback;
  if (!normalizedBase) {
    return null;
  }

  const record = asRecord(raw);
  const validators = Array.isArray(record?.validators)
    ? record.validators.map((value) => asString(value)).filter(Boolean)
    : [];

  return {
    ...normalizedBase,
    validators,
    revokedAt: asIsoTimestamp(record?.revokedAt ?? record?.revoked_at),
    revokedBy: asString(record?.revokedBy ?? record?.revoked_by),
    revocationReason: asString(
      record?.revocationReason ?? record?.revocation_reason,
    ),
    job: normalizeJob(record?.job, normalizedBase.jobId),
    proofLineage: normalizeProofLineage(
      record?.proofLineage ?? record?.proof_lineage,
    ),
    detailAvailable,
  };
}

export async function fetchSeals(options?: {
  limit?: number;
  offset?: number;
  status?: SealLifecycleStatus | "";
  requester?: string;
  jobId?: string;
  sort?: SealSortKey;
}): Promise<SealsResponse> {
  const params = new URLSearchParams();
  params.set("limit", String(options?.limit ?? 24));
  params.set("offset", String(options?.offset ?? 0));
  params.set("sort", options?.sort ?? "created_at:desc");

  if (options?.status) {
    params.set("status", options.status);
  }
  if (options?.requester) {
    params.set("requester", options.requester);
  }
  if (options?.jobId) {
    params.set("job_id", options.jobId);
  }

  const response = await fetch(getApiUrl(`/seals?${params.toString()}`));
  if (!response.ok) {
    throw new Error("Failed to fetch seals");
  }

  const payload = (await response.json()) as {
    seals?: unknown[];
    total?: number;
  };

  return {
    seals: (payload.seals ?? [])
      .map((seal) => normalizeSealListItem(seal))
      .filter((seal): seal is SealListItem => Boolean(seal)),
    total: asNumber(payload.total),
  };
}

async function fetchSealFromListFallback(
  id: string,
): Promise<SealListItem | null> {
  const limit = 100;
  let offset = 0;
  let total = limit;
  let pagesLoaded = 0;

  while (offset < total && pagesLoaded < 10) {
    const page = await fetchSeals({
      limit,
      offset,
      sort: "created_at:desc",
    });
    const match = page.seals.find((seal) => seal.id === id);
    if (match) {
      return match;
    }

    total = page.total;
    offset += limit;
    pagesLoaded += 1;
  }

  return null;
}

export async function fetchSeal(id: string): Promise<SealDetailRecord> {
  let fallback: SealListItem | null = null;
  let detailError: Error | null = null;

  try {
    const response = await fetch(getApiUrl(`/seals/${encodeURIComponent(id)}`));
    if (response.ok) {
      const payload = (await response.json()) as {
        seal?: unknown;
        data?: unknown;
      };
      const rawSeal = payload.seal ?? payload.data ?? payload;
      const normalized = normalizeSealDetail(rawSeal);
      if (normalized) {
        return normalized;
      }
      detailError = new Error(
        "Seal detail response was missing a usable record",
      );
    } else {
      detailError = new Error(
        `Seal detail endpoint returned ${response.status}`,
      );
    }
  } catch (error) {
    detailError =
      error instanceof Error ? error : new Error("Failed to fetch seal detail");
  }

  fallback = await fetchSealFromListFallback(id);
  if (!fallback) {
    throw detailError ?? new Error("Seal not found");
  }

  const fallbackDetail = normalizeSealDetail(fallback, fallback, false);
  if (!fallbackDetail) {
    throw detailError ?? new Error("Seal not found");
  }

  return fallbackDetail;
}

export function buildSealMetrics(seals: SealListItem[]): SealMetrics {
  const expiringSoonThreshold = Date.now() + 1000 * 60 * 60 * 24 * 7;
  const completeCommitmentCount = seals.filter(
    (seal) =>
      Boolean(seal.modelCommitment) &&
      Boolean(seal.inputCommitment) &&
      Boolean(seal.outputCommitment),
  ).length;

  const averageValidatorQuorum =
    seals.length > 0
      ? seals.reduce((sum, seal) => sum + seal.validatorCount, 0) / seals.length
      : 0;

  return {
    activeCount: seals.filter((seal) => seal.status === "active").length,
    revokedOrSupersededCount: seals.filter(
      (seal) => seal.status === "revoked" || seal.status === "superseded",
    ).length,
    expiringSoonCount: seals.filter((seal) => {
      if (!seal.expiresAt) {
        return false;
      }

      const expiry = new Date(seal.expiresAt).getTime();
      return (
        !Number.isNaN(expiry) &&
        expiry > Date.now() &&
        expiry <= expiringSoonThreshold
      );
    }).length,
    averageValidatorQuorum,
    commitmentCoverage:
      seals.length > 0
        ? Math.round((completeCommitmentCount / seals.length) * 100)
        : 0,
  };
}

export function shortenHash(value: string, start = 8, end = 6): string {
  if (!value || value.length <= start + end + 3) {
    return value || "n/a";
  }

  return `${value.slice(0, start)}...${value.slice(-end)}`;
}

export function formatTimestamp(value: string | null | undefined): string {
  if (!value) {
    return "n/a";
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "n/a";
  }

  return parsed.toLocaleString();
}

export function formatRelativeTime(value: string | null | undefined): string {
  if (!value) {
    return "n/a";
  }

  const timestamp = new Date(value).getTime();
  if (Number.isNaN(timestamp)) {
    return "n/a";
  }

  const diffMs = timestamp - Date.now();
  const absMs = Math.abs(diffMs);
  const minute = 1000 * 60;
  const hour = minute * 60;
  const day = hour * 24;
  const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });

  if (absMs < hour) {
    return formatter.format(Math.round(diffMs / minute), "minute");
  }
  if (absMs < day) {
    return formatter.format(Math.round(diffMs / hour), "hour");
  }

  return formatter.format(Math.round(diffMs / day), "day");
}

export function getSealLineageCompleteness(seal: SealDetailRecord): number {
  const checkpoints = [
    seal.modelCommitment,
    seal.inputCommitment,
    seal.outputCommitment,
    seal.job?.id,
    seal.validators.length > 0 ? "validators" : "",
    seal.proofLineage?.merkleRoot,
    seal.proofLineage?.teeMeasurement,
  ];

  const present = checkpoints.filter(Boolean).length;
  return Math.round((present / checkpoints.length) * 100);
}

export function getSealCommitmentCoverage(
  seal: SealListItem | SealDetailRecord,
): number {
  const commitments = [
    seal.modelCommitment,
    seal.inputCommitment,
    seal.outputCommitment,
  ];
  return Math.round(
    (commitments.filter(Boolean).length / commitments.length) * 100,
  );
}
