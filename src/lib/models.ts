import { getApiUrl } from "@/config/api";

const MODELS_PAGE_SIZE = 100;

export interface ModelRegistryRecord {
  modelHash: string;
  name: string;
  owner: string;
  architecture: string;
  version: string;
  category: string;
  inputSchema: string;
  outputSchema: string;
  storageUri: string;
  registeredAt: string;
  verified: boolean;
  totalJobs: number;
}

export interface ModelProofBreakdown {
  proofType: string;
  count: number;
}

export interface ModelUsageStats {
  totalJobs: number;
  verifiedJobs?: number | null;
  inFlightJobs?: number | null;
  failedJobs?: number | null;
  latestJobAt?: string | null;
  latestVerifiedAt?: string | null;
  proofTypeBreakdown: ModelProofBreakdown[];
}

export interface ModelLineageJob {
  id: string;
  status: string;
  proofType: string;
  createdAt: string;
  completedAt: string | null;
  verificationScore: number | null;
  creatorAddress: string | null;
  validatorAddress: string | null;
}

export interface ModelLineageRecord {
  recentJobs: ModelLineageJob[];
}

export interface ModelDetailRecord {
  registry: ModelRegistryRecord;
  sizeBytes: string | null;
  updatedAt: string | null;
  usage: ModelUsageStats;
  lineage: ModelLineageRecord;
  source: "detail" | "list-fallback";
}

export interface ModelsListResult {
  models: ModelRegistryRecord[];
  total: number;
}

export interface FetchModelsOptions {
  limit?: number;
  offset?: number;
  category?: string;
  verified?: boolean;
  owner?: string;
  sort?: string;
}

function coerceString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

function coerceBoolean(value: unknown): boolean | undefined {
  if (typeof value === "boolean") {
    return value;
  }

  if (value === "true") {
    return true;
  }

  if (value === "false") {
    return false;
  }

  return undefined;
}

function coerceNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return undefined;
}

function normalizeRegistryRecord(
  source: unknown,
  fallbackSource?: unknown,
): ModelRegistryRecord {
  const fallback =
    fallbackSource && typeof fallbackSource === "object"
      ? (fallbackSource as Record<string, unknown>)
      : {};
  const record =
    source && typeof source === "object"
      ? (source as Record<string, unknown>)
      : {};

  return {
    modelHash: coerceString(record.modelHash ?? fallback.modelHash) ?? "",
    name: coerceString(record.name ?? fallback.name) ?? "Unnamed model",
    owner: coerceString(record.owner ?? fallback.owner) ?? "Unpublished",
    architecture:
      coerceString(record.architecture ?? fallback.architecture) ??
      "Unpublished",
    version: coerceString(record.version ?? fallback.version) ?? "Unpublished",
    category: coerceString(record.category ?? fallback.category) ?? "GENERAL",
    inputSchema: coerceString(record.inputSchema ?? fallback.inputSchema) ?? "",
    outputSchema:
      coerceString(record.outputSchema ?? fallback.outputSchema) ?? "",
    storageUri: coerceString(record.storageUri ?? fallback.storageUri) ?? "",
    registeredAt:
      coerceString(record.registeredAt ?? fallback.registeredAt) ?? "",
    verified: coerceBoolean(record.verified ?? fallback.verified) ?? false,
    totalJobs: coerceNumber(record.totalJobs ?? fallback.totalJobs) ?? 0,
  };
}

function normalizeUsageStats(
  source: unknown,
  fallbackTotalJobs: number,
): ModelUsageStats {
  const usage =
    source && typeof source === "object"
      ? (source as Record<string, unknown>)
      : {};

  const totalJobs = coerceNumber(usage.totalJobs) ?? fallbackTotalJobs;
  const proofTypeBreakdownSource = Array.isArray(usage.proofTypeBreakdown)
    ? usage.proofTypeBreakdown
    : [];

  return {
    totalJobs,
    verifiedJobs: coerceNumber(usage.verifiedJobs) ?? null,
    inFlightJobs: coerceNumber(usage.inFlightJobs) ?? null,
    failedJobs: coerceNumber(usage.failedJobs) ?? null,
    latestJobAt: coerceString(usage.latestJobAt) ?? null,
    latestVerifiedAt: coerceString(usage.latestVerifiedAt) ?? null,
    proofTypeBreakdown: proofTypeBreakdownSource
      .map((entry) => {
        if (!entry || typeof entry !== "object") {
          return null;
        }

        const record = entry as Record<string, unknown>;
        const proofType = coerceString(record.proofType);
        const count = coerceNumber(record.count);

        if (!proofType || count === undefined) {
          return null;
        }

        return {
          proofType,
          count,
        };
      })
      .filter((entry): entry is ModelProofBreakdown => entry !== null),
  };
}

function normalizeLineageRecord(source: unknown): ModelLineageRecord {
  const lineage =
    source && typeof source === "object"
      ? (source as Record<string, unknown>)
      : {};
  const recentJobsSource = Array.isArray(lineage.recentJobs)
    ? lineage.recentJobs
    : [];

  return {
    recentJobs: recentJobsSource
      .map((entry) => {
        if (!entry || typeof entry !== "object") {
          return null;
        }

        const record = entry as Record<string, unknown>;
        const id = coerceString(record.id);
        const status = coerceString(record.status);
        const proofType = coerceString(record.proofType);
        const createdAt = coerceString(record.createdAt);

        if (!id || !status || !proofType || !createdAt) {
          return null;
        }

        return {
          id,
          status,
          proofType,
          createdAt,
          completedAt: coerceString(record.completedAt) ?? null,
          verificationScore: coerceNumber(record.verificationScore) ?? null,
          creatorAddress: coerceString(record.creatorAddress) ?? null,
          validatorAddress: coerceString(record.validatorAddress) ?? null,
        };
      })
      .filter((entry): entry is ModelLineageJob => entry !== null),
  };
}

async function parseJsonResponse<T>(response: Response): Promise<T> {
  const payload = (await response.json()) as T;
  return payload;
}

export async function fetchModelsPage(
  options: FetchModelsOptions = {},
): Promise<ModelsListResult> {
  const {
    limit = MODELS_PAGE_SIZE,
    offset = 0,
    category,
    verified,
    owner,
    sort = "registered_at:desc",
  } = options;

  const params = new URLSearchParams({
    limit: String(limit),
    offset: String(offset),
    sort,
  });

  if (category) {
    params.set("category", category);
  }

  if (typeof verified === "boolean") {
    params.set("verified", String(verified));
  }

  if (owner) {
    params.set("owner", owner);
  }

  const response = await fetch(getApiUrl(`/models?${params.toString()}`), {
    headers: { accept: "application/json" },
  });

  if (!response.ok) {
    throw new Error("Failed to fetch model registry data");
  }

  const payload = await parseJsonResponse<{
    models?: unknown[];
    total?: number;
  }>(response);

  const models = Array.isArray(payload.models)
    ? payload.models.map((entry) => normalizeRegistryRecord(entry))
    : [];

  return {
    models,
    total: coerceNumber(payload.total) ?? models.length,
  };
}

export async function fetchAllModels(
  options: Omit<FetchModelsOptions, "limit" | "offset"> = {},
): Promise<ModelsListResult> {
  const firstPage = await fetchModelsPage({
    ...options,
    limit: MODELS_PAGE_SIZE,
    offset: 0,
  });

  if (firstPage.total <= firstPage.models.length) {
    return firstPage;
  }

  const requests: Promise<ModelsListResult>[] = [];

  for (
    let offset = firstPage.models.length;
    offset < firstPage.total;
    offset += MODELS_PAGE_SIZE
  ) {
    requests.push(
      fetchModelsPage({
        ...options,
        limit: MODELS_PAGE_SIZE,
        offset,
      }),
    );
  }

  const remainingPages = await Promise.all(requests);

  return {
    total: firstPage.total,
    models: [
      ...firstPage.models,
      ...remainingPages.flatMap((page) => page.models),
    ],
  };
}

export async function fetchModelDetail(
  modelHash: string,
): Promise<ModelDetailRecord> {
  const response = await fetch(
    getApiUrl(`/models/${encodeURIComponent(modelHash)}`),
    {
      headers: { accept: "application/json" },
    },
  );

  if (response.ok) {
    const payload = await parseJsonResponse<Record<string, unknown>>(response);
    const registry = normalizeRegistryRecord(
      payload.registry ?? payload.model ?? payload.metadata ?? payload,
      payload,
    );

    return {
      registry,
      sizeBytes: coerceString(payload.sizeBytes) ?? null,
      updatedAt: coerceString(payload.updatedAt) ?? null,
      usage: normalizeUsageStats(
        payload.usage ??
          payload.usageStats ??
          payload.stats ??
          payload.telemetry,
        registry.totalJobs,
      ),
      lineage: normalizeLineageRecord(payload.lineage),
      source: "detail",
    };
  }

  if ([404, 405, 501].includes(response.status)) {
    const universe = await fetchAllModels();
    const fallbackModel = universe.models.find(
      (entry) => entry.modelHash === modelHash,
    );

    if (!fallbackModel) {
      throw new Error("Model not found");
    }

    return {
      registry: fallbackModel,
      sizeBytes: null,
      updatedAt: null,
      usage: normalizeUsageStats({}, fallbackModel.totalJobs),
      lineage: normalizeLineageRecord(undefined),
      source: "list-fallback",
    };
  }

  throw new Error("Failed to fetch model detail");
}

export function formatModelCategory(category: string): string {
  const normalized = category.replace("UTILITY_CATEGORY_", "");
  return normalized.charAt(0) + normalized.slice(1).toLowerCase();
}

export function truncateIdentifier(
  value: string,
  prefix = 10,
  suffix = 8,
): string {
  if (!value || value.length <= prefix + suffix + 3) {
    return value || "-";
  }

  return `${value.slice(0, prefix)}...${value.slice(-suffix)}`;
}

export function formatDateTime(value?: string | null): string {
  if (!value) {
    return "Unpublished";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "Unpublished";
  }

  return new Intl.DateTimeFormat("en", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function formatRelativeTime(value?: string | null): string {
  if (!value) {
    return "Unpublished";
  }

  const timestamp = new Date(value).getTime();
  if (Number.isNaN(timestamp)) {
    return "Unpublished";
  }

  const elapsed = timestamp - Date.now();
  const absElapsed = Math.abs(elapsed);
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  const month = 30 * day;
  const year = 365 * day;
  const formatter = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

  if (absElapsed < hour) {
    return formatter.format(Math.round(elapsed / minute), "minute");
  }

  if (absElapsed < day) {
    return formatter.format(Math.round(elapsed / hour), "hour");
  }

  if (absElapsed < month) {
    return formatter.format(Math.round(elapsed / day), "day");
  }

  if (absElapsed < year) {
    return formatter.format(Math.round(elapsed / month), "month");
  }

  return formatter.format(Math.round(elapsed / year), "year");
}

export function formatPercent(
  value?: number | null,
  digits = 1,
  fallback = "Unpublished",
): string {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return fallback;
  }

  return `${value.toFixed(digits)}%`;
}

export function formatNullableNumber(
  value?: number | null,
  fallback = "Unpublished",
): string {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return fallback;
  }

  return value.toLocaleString();
}

export function formatBytes(
  value?: string | null,
  fallback = "Unpublished",
): string {
  if (!value) {
    return fallback;
  }

  const bytes = Number(value);
  if (!Number.isFinite(bytes)) {
    return value;
  }

  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = bytes;
  let unitIndex = 0;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }

  return `${size.toFixed(size >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

export function prettyPrintSchema(schema: string): string {
  if (!schema) {
    return "Schema not published";
  }

  try {
    return JSON.stringify(JSON.parse(schema), null, 2);
  } catch {
    return schema;
  }
}

export function isHttpUrl(value?: string | null): boolean {
  if (!value) {
    return false;
  }

  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}
