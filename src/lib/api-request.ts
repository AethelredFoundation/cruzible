import { getApiUrl } from "@/config/api";
import { BRAND } from "@/lib/constants";

type JsonRecord = Record<string, unknown>;

interface ApiJsonOptions extends RequestInit {
  fallbackMessage?: string;
}

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

export function apiRequest(endpoint: string, options: RequestInit = {}) {
  const { headers, credentials, cache, body, ...rest } = options;

  return fetch(getApiUrl(endpoint), {
    credentials: credentials ?? "include",
    cache: cache ?? "no-store",
    ...rest,
    body,
    headers: buildApiHeaders(headers, body),
  });
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
