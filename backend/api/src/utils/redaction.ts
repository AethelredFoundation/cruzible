export const REDACTED = "[REDACTED]";
export const TRUNCATED = "[TRUNCATED]";
export const CIRCULAR = "[CIRCULAR]";

export type RedactedJsonValue =
  | string
  | number
  | boolean
  | null
  | RedactedJsonValue[]
  | { [key: string]: RedactedJsonValue };

export type RedactedJsonObject = { [key: string]: RedactedJsonValue };

interface RedactionOptions {
  maxDepth?: number;
  maxArrayLength?: number;
}

const DEFAULT_MAX_DEPTH = 4;
const DEFAULT_MAX_ARRAY_LENGTH = 100;

const SENSITIVE_HEADERS = new Set([
  "authorization",
  "cf-connecting-ip",
  "cookie",
  "forwarded",
  "set-cookie",
  "true-client-ip",
  "user-agent",
  "x-api-key",
  "x-auth-token",
  "proxy-authorization",
  "x-csrf-token",
  "x-forwarded-for",
  "x-operational-token",
  "x-real-ip",
  "x-xsrf-token",
]);

const SENSITIVE_FIELD_KEY_PATTERNS = [
  /token/i,
  /secret/i,
  /password/i,
  /^api[-_]?key$/i,
  /^code$/i,
  /^message$/i,
  /^mnemonic$/i,
  /^nonce$/i,
  /private[-_]?key/i,
  /seed[-_]?phrase/i,
  /^signature$/i,
];

export function isSensitiveFieldKey(key: string): boolean {
  return SENSITIVE_FIELD_KEY_PATTERNS.some((pattern) => pattern.test(key));
}

export function redactHeaders(
  headers: Record<string, string | string[] | undefined>,
): Record<string, string> {
  const safe: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (SENSITIVE_HEADERS.has(key.toLowerCase())) {
      safe[key] = REDACTED;
    } else if (value !== undefined) {
      safe[key] = Array.isArray(value) ? value.join(", ") : String(value);
    }
  }
  return safe;
}

export function redactUrlPath(rawUrl: string | undefined): string {
  if (!rawUrl) {
    return "unknown";
  }

  try {
    const url = new URL(rawUrl, "http://cruzible.local");
    const query = Array.from(url.searchParams.entries()).map(([key, value]) => {
      const safeValue = isSensitiveFieldKey(key)
        ? REDACTED
        : encodeURIComponent(value);
      return `${encodeURIComponent(key)}=${safeValue}`;
    });
    return `${url.pathname}${query.length > 0 ? `?${query.join("&")}` : ""}`;
  } catch {
    return redactMalformedUrlPath(rawUrl);
  }
}

export function redactFields(
  value: unknown,
  options: RedactionOptions = {},
): RedactedJsonValue {
  return redactValue(value, normalizeOptions(options), 0, new WeakSet());
}

export function redactRecord(
  value: Record<string, unknown>,
  options: RedactionOptions = {},
): RedactedJsonObject {
  const redacted = redactFields(value, options);
  return isJsonObject(redacted) ? redacted : {};
}

function normalizeOptions(
  options: RedactionOptions,
): Required<RedactionOptions> {
  return {
    maxDepth: options.maxDepth ?? DEFAULT_MAX_DEPTH,
    maxArrayLength: options.maxArrayLength ?? DEFAULT_MAX_ARRAY_LENGTH,
  };
}

function redactValue(
  value: unknown,
  options: Required<RedactionOptions>,
  depth: number,
  seen: WeakSet<object>,
): RedactedJsonValue {
  if (depth > options.maxDepth) {
    return TRUNCATED;
  }

  if (value === null) {
    return null;
  }

  if (
    value === undefined ||
    typeof value === "function" ||
    typeof value === "symbol"
  ) {
    return null;
  }

  if (typeof value === "string" || typeof value === "boolean") {
    return value;
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? value : String(value);
  }

  if (typeof value === "bigint") {
    return value.toString();
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (value instanceof Error) {
    return {
      errorName: value.name,
    };
  }

  if (value instanceof Uint8Array) {
    return "[BINARY]";
  }

  if (Array.isArray(value)) {
    if (seen.has(value)) {
      return CIRCULAR;
    }
    seen.add(value);

    const safe = value
      .slice(0, options.maxArrayLength)
      .map((item) => redactValue(item, options, depth + 1, seen));

    if (value.length > options.maxArrayLength) {
      safe.push(TRUNCATED);
    }

    seen.delete(value);
    return safe;
  }

  if (typeof value === "object") {
    if (seen.has(value)) {
      return CIRCULAR;
    }
    seen.add(value);

    const safe: RedactedJsonObject = {};
    for (const [key, nestedValue] of Object.entries(
      value as Record<string, unknown>,
    )) {
      safe[key] = isSensitiveFieldKey(key)
        ? REDACTED
        : redactValue(nestedValue, options, depth + 1, seen);
    }

    seen.delete(value);
    return safe;
  }

  return String(value);
}

function isJsonObject(value: RedactedJsonValue): value is RedactedJsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function redactMalformedUrlPath(rawUrl: string): string {
  const fragmentless = rawUrl.split("#", 1)[0] ?? "";
  const queryStart = fragmentless.indexOf("?");
  const rawPath =
    queryStart >= 0 ? fragmentless.slice(0, queryStart) : fragmentless;
  const rawQuery = queryStart >= 0 ? fragmentless.slice(queryStart + 1) : "";
  const query = redactMalformedQuery(rawQuery);

  return `${sanitizeFallbackPath(rawPath)}${
    query.length > 0 ? `?${query}` : ""
  }`;
}

function redactMalformedQuery(rawQuery: string): string {
  if (!rawQuery) {
    return "";
  }

  return rawQuery
    .split("&")
    .filter((part) => part.length > 0)
    .map((part) => {
      const separator = part.indexOf("=");
      const rawKey = separator >= 0 ? part.slice(0, separator) : part;
      const rawValue = separator >= 0 ? part.slice(separator + 1) : "";
      const decodedKey = safeDecodeQueryComponent(rawKey);
      const safeKey = safeEncodeQueryComponent(decodedKey || rawKey);
      const safeValue =
        isSensitiveFieldKey(decodedKey) || isSensitiveFieldKey(rawKey)
          ? REDACTED
          : safeEncodeQueryComponent(rawValue);

      return `${safeKey}=${safeValue}`;
    })
    .join("&");
}

function sanitizeFallbackPath(rawPath: string): string {
  const pathWithoutOrigin = stripUrlOrigin(rawPath.trim()) || "/";
  const normalizedPath = pathWithoutOrigin.startsWith("/")
    ? pathWithoutOrigin
    : `/${pathWithoutOrigin}`;

  return Array.from(normalizedPath, (character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    if (codePoint > 0x1f && codePoint !== 0x7f) {
      return character;
    }

    return `%${codePoint.toString(16).toUpperCase().padStart(2, "0")}`;
  }).join("");
}

function stripUrlOrigin(rawPath: string): string {
  const schemeMatch = /^[a-z][a-z\d+.-]*:\/\//i.exec(rawPath);
  if (!schemeMatch) {
    return rawPath;
  }

  const afterScheme = rawPath.slice(schemeMatch[0].length);
  const firstPathSlash = afterScheme.indexOf("/");
  return firstPathSlash >= 0 ? afterScheme.slice(firstPathSlash) : "/";
}

function safeDecodeQueryComponent(value: string): string {
  try {
    return decodeURIComponent(value.replace(/\+/g, " "));
  } catch {
    return value;
  }
}

function safeEncodeQueryComponent(value: string): string {
  return encodeURIComponent(safeDecodeQueryComponent(value));
}
