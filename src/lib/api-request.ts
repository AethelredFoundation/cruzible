import { getApiUrl } from "@/config/api";
import { BRAND } from "@/lib/constants";

type JsonRecord = Record<string, unknown>;

interface ApiRequestOptions extends RequestInit {
  timeoutMs?: number;
}

interface ApiJsonOptions extends ApiRequestOptions {
  fallbackMessage?: string;
}

export const DEFAULT_API_TIMEOUT_MS = 12_000;

export class ApiHttpError extends Error {
  constructor(
    message: string,
    public statusCode: number,
    public payload?: unknown,
  ) {
    super(message);
    this.name = "ApiHttpError";
  }
}

function isFormDataBody(body: BodyInit | null | undefined): boolean {
  return typeof FormData !== "undefined" && body instanceof FormData;
}

function buildApiHeaders(
  headers: HeadersInit | undefined,
  body?: BodyInit | null,
) {
  const merged = new Headers(headers);

  if (!merged.has("Accept")) {
    merged.set("Accept", "application/json");
  }

  if (body && !isFormDataBody(body) && !merged.has("Content-Type")) {
    merged.set("Content-Type", "application/json");
  }

  if (!merged.has("X-Client-Name")) {
    merged.set("X-Client-Name", BRAND.NAME);
  }

  if (!merged.has("X-Client-Version")) {
    merged.set(
      "X-Client-Version",
      process.env.NEXT_PUBLIC_APP_VERSION || "1.0.0",
    );
  }

  return merged;
}

function buildTimeoutSignal(
  timeoutMs: number,
  parentSignal?: AbortSignal | null,
) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error("API request timeout must be a positive finite number");
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort();
  }, timeoutMs);
  let removeParentAbortListener: (() => void) | undefined;

  if (parentSignal) {
    if (parentSignal.aborted) {
      controller.abort();
    } else {
      const abortFromParent = () => {
        clearTimeout(timeoutId);
        controller.abort();
      };
      parentSignal.addEventListener("abort", abortFromParent, { once: true });
      removeParentAbortListener = () => {
        parentSignal.removeEventListener("abort", abortFromParent);
      };
    }
  }

  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timeoutId);
      removeParentAbortListener?.();
    },
  };
}

export async function apiRequest(
  endpoint: string,
  options: ApiRequestOptions = {},
) {
  const {
    headers,
    body,
    signal,
    timeoutMs = DEFAULT_API_TIMEOUT_MS,
    ...rest
  } = options;
  const timeout = buildTimeoutSignal(timeoutMs, signal);

  try {
    return await fetch(getApiUrl(endpoint), {
      ...rest,
      credentials: "include",
      cache: "no-store",
      body,
      signal: timeout.signal,
      headers: buildApiHeaders(headers, body),
    });
  } finally {
    timeout.cleanup();
  }
}

export async function parseApiJsonResponse<T>(response: Response): Promise<T> {
  if (response.status === 204) {
    return undefined as T;
  }

  const text = await response.text();
  if (!text.trim()) {
    return undefined as T;
  }

  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error("API returned invalid JSON");
  }
}

function getApiErrorMessage(payload: unknown, fallback: string): string {
  const record =
    payload && typeof payload === "object" ? (payload as JsonRecord) : null;
  const message = record?.message;

  return typeof message === "string" && message.trim().length > 0
    ? message
    : fallback;
}

export async function apiJson<T>(
  endpoint: string,
  options: ApiJsonOptions = {},
): Promise<T> {
  const { fallbackMessage, ...requestOptions } = options;
  const response = await apiRequest(endpoint, requestOptions);

  if (!response.ok) {
    let payload: unknown;
    try {
      payload = await parseApiJsonResponse(response);
    } catch {
      payload = undefined;
    }

    throw new ApiHttpError(
      getApiErrorMessage(
        payload,
        fallbackMessage || `API request failed with HTTP ${response.status}`,
      ),
      response.status,
      payload,
    );
  }

  return parseApiJsonResponse<T>(response);
}
