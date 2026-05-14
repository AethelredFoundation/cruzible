import { readFileSync } from "node:fs";
import { z } from "zod";
import { rejectUrlUserInfoAndFragment } from "../utils/urlRedaction";
import { isPrivateOrLocalHostname } from "../utils/networkSafety";

const DEFAULT_INDEXER_WS_URL = "ws://127.0.0.1:8546";
const DEFAULT_INDEXER_RPC_URL = "http://127.0.0.1:8545";
const EVM_ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;
const ZERO_EVM_ADDRESS = "0x0000000000000000000000000000000000000000";
const AUTH_ROLE_ADDRESS_PATTERN = /^aeth1[0-9a-z]{5,}$/;
const MIN_PRODUCTION_SECRET_LENGTH = 32;
const MAX_PRODUCTION_ACCESS_TOKEN_MS = 15 * 60 * 1000;
const MAX_PRODUCTION_REFRESH_TOKEN_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_PRODUCTION_NONCE_TTL_MS = 10 * 60 * 1000;
const DECIMAL_INTEGER_ENV_PATTERN = /^(0|[1-9]\d*)$/;
const DECIMAL_NUMBER_ENV_PATTERN = /^(0|[1-9]\d*)(\.\d+)?$/;
const TOKEN_DURATION_PATTERN = /^([1-9]\d*)([mhd])$/;
const REFRESH_TOKEN_DURATION_PATTERN = /^([1-9]\d*)([hd])$/;
const FILE_BACKED_ENV_KEYS = [
  "DATABASE_URL",
  "REDIS_URL",
  "JWT_SECRET",
  "JWT_REFRESH_SECRET",
  "OPERATIONAL_ENDPOINTS_TOKEN",
  "ALERT_WEBHOOK_URL",
] as const;

const optionalUrlSchema = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.string().url().optional(),
);

const optionalBooleanSchema = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z
    .enum(["true", "false"])
    .transform((value) => value === "true")
    .optional(),
);

const optionalSecretSchema = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.string().min(32).optional(),
);

type NumberEnvOptions = {
  min: number;
  max?: number;
  defaultValue: number;
};

function emptyStringAsUnset(value: unknown): unknown {
  return typeof value === "string" && value.trim() === "" ? undefined : value;
}

function integerEnvSchema(options: NumberEnvOptions) {
  return z.preprocess(
    (value) => {
      const normalizedValue = emptyStringAsUnset(value);
      if (
        normalizedValue === undefined ||
        typeof normalizedValue !== "string"
      ) {
        return normalizedValue;
      }

      const trimmed = normalizedValue.trim();
      if (!DECIMAL_INTEGER_ENV_PATTERN.test(trimmed)) {
        return Number.NaN;
      }

      const parsed = Number(trimmed);
      return Number.isSafeInteger(parsed) ? parsed : Number.NaN;
    },
    z
      .number()
      .int()
      .safe()
      .min(options.min)
      .max(options.max ?? Number.MAX_SAFE_INTEGER)
      .default(options.defaultValue),
  );
}

function decimalEnvSchema(options: NumberEnvOptions) {
  return z.preprocess(
    (value) => {
      const normalizedValue = emptyStringAsUnset(value);
      if (
        normalizedValue === undefined ||
        typeof normalizedValue !== "string"
      ) {
        return normalizedValue;
      }

      const trimmed = normalizedValue.trim();
      if (!DECIMAL_NUMBER_ENV_PATTERN.test(trimmed)) {
        return Number.NaN;
      }

      const parsed = Number(trimmed);
      return Number.isFinite(parsed) ? parsed : Number.NaN;
    },
    z
      .number()
      .min(options.min)
      .max(options.max ?? Number.MAX_SAFE_INTEGER)
      .default(options.defaultValue),
  );
}

const optionalPositiveIntegerStringSchema = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z
    .string()
    .regex(/^[1-9]\d*$/, "must be a positive integer string")
    .optional(),
);

const evmAddressSchema = z
  .string()
  .default("")
  .refine(
    (value) =>
      value === "" ||
      (EVM_ADDRESS_PATTERN.test(value) &&
        value.toLowerCase() !== ZERO_EVM_ADDRESS),
    "must be blank or a non-zero EVM address",
  );

const envSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  PORT: integerEnvSchema({ min: 1, max: 65535, defaultValue: 3001 }),
  RPC_URL: z.string().url().default("http://127.0.0.1:26657"),
  DATABASE_URL: optionalUrlSchema,
  REDIS_URL: optionalUrlSchema,
  CORS_ORIGINS: z.string().default("http://localhost:3000"),
  JWT_SECRET: z.string().min(16).default("cruzible-dev-jwt-secret"),
  JWT_REFRESH_SECRET: z.string().min(16).default("cruzible-dev-refresh-secret"),
  JWT_EXPIRES_IN: z.string().regex(TOKEN_DURATION_PATTERN).default("15m"),
  JWT_REFRESH_EXPIRES_IN: z
    .string()
    .regex(REFRESH_TOKEN_DURATION_PATTERN)
    .default("7d"),
  AUTH_EXPOSE_REFRESH_TOKEN_IN_BODY: optionalBooleanSchema,
  TRUST_PROXY: z.string().default("loopback"),
  RATE_LIMIT_WINDOW_MS: integerEnvSchema({ min: 1000, defaultValue: 60_000 }),
  RATE_LIMIT_MAX: integerEnvSchema({ min: 1, defaultValue: 120 }),
  HTTP_HEADERS_TIMEOUT_MS: integerEnvSchema({
    min: 1000,
    defaultValue: 65_000,
  }),
  HTTP_REQUEST_TIMEOUT_MS: integerEnvSchema({
    min: 1000,
    defaultValue: 120_000,
  }),
  HTTP_KEEP_ALIVE_TIMEOUT_MS: integerEnvSchema({
    min: 1000,
    defaultValue: 5_000,
  }),
  HTTP_MAX_REQUESTS_PER_SOCKET: integerEnvSchema({
    min: 1,
    defaultValue: 1000,
  }),
  ALLOW_MOCK_SIGNATURES: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  AUTH_ADMIN_ADDRESSES: z.string().default(""),
  AUTH_OPERATOR_ADDRESSES: z.string().default(""),
  AUTH_NONCE_TTL_MS: integerEnvSchema({
    min: 30_000,
    defaultValue: 300_000,
  }),
  AUTH_RATE_LIMIT_WINDOW_MS: integerEnvSchema({
    min: 1000,
    defaultValue: 60_000,
  }),
  AUTH_RATE_LIMIT_MAX: integerEnvSchema({ min: 1, defaultValue: 10 }),
  OPS_RATE_LIMIT_WINDOW_MS: integerEnvSchema({
    min: 1000,
    defaultValue: 60_000,
  }),
  OPS_RATE_LIMIT_MAX: integerEnvSchema({ min: 1, defaultValue: 60 }),
  PUBLIC_EXPENSIVE_RATE_LIMIT_WINDOW_MS: integerEnvSchema({
    min: 1000,
    defaultValue: 60_000,
  }),
  PUBLIC_EXPENSIVE_RATE_LIMIT_MAX: integerEnvSchema({
    min: 1,
    defaultValue: 30,
  }),
  METRICS_ENABLED: optionalBooleanSchema,
  API_DOCS_ENABLED: optionalBooleanSchema,
  OPERATIONAL_ENDPOINTS_TOKEN: optionalSecretSchema,

  // Indexer configuration
  INDEXER_WS_URL: optionalUrlSchema,
  INDEXER_RPC_URL: optionalUrlSchema,
  WS_URL: optionalUrlSchema,
  CRUZIBLE_VAULT_ADDRESS: evmAddressSchema,
  STAETHEL_ADDRESS: evmAddressSchema,
  STABLECOIN_BRIDGE_ADDRESS: evmAddressSchema,
  INDEXER_START_BLOCK: integerEnvSchema({ min: 0, defaultValue: 0 }),
  INDEXER_EXPECTED_CHAIN_ID: optionalPositiveIntegerStringSchema,
  INDEXER_ENABLED: z
    .enum(["true", "false"])
    .default("true")
    .transform((value) => value === "true"),

  // Alerting
  ALERT_WEBHOOK_URL: optionalUrlSchema,
  ALERT_RATE_LIMIT_MS: integerEnvSchema({
    min: 1000,
    defaultValue: 300_000,
  }),

  // Reconciliation
  RECONCILIATION_INTERVAL_MS: integerEnvSchema({
    min: 1000,
    defaultValue: 300_000,
  }),
  RECONCILIATION_MIN_VALIDATORS: integerEnvSchema({
    min: 1,
    defaultValue: 4,
  }),
  RECONCILIATION_EPOCH_DURATION_S: integerEnvSchema({
    min: 1,
    defaultValue: 3600,
  }),
  RECONCILIATION_RATE_WARN_PCT: decimalEnvSchema({
    min: 0,
    max: 1,
    defaultValue: 0.01,
  }),
  RECONCILIATION_RATE_CRIT_PCT: decimalEnvSchema({
    min: 0,
    max: 1,
    defaultValue: 0.05,
  }),
  RECONCILIATION_TVL_DRIFT_PCT: decimalEnvSchema({
    min: 0,
    max: 1,
    defaultValue: 0.02,
  }),
});

function stripTrailingNewlines(value: string): string {
  return value.replace(/[\r\n]+$/u, "");
}

function resolveFileBackedEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const resolvedEnv = { ...env };

  for (const envName of FILE_BACKED_ENV_KEYS) {
    const fileEnvName = `${envName}_FILE`;
    const filePath = env[fileEnvName];

    if (!filePath) {
      continue;
    }

    if (env[envName]) {
      throw new Error(
        `${envName} and ${fileEnvName} are mutually exclusive; provide only one`,
      );
    }

    let fileValue: string;

    try {
      fileValue = readFileSync(filePath, "utf8");
    } catch {
      throw new Error(`Unable to read ${fileEnvName} for ${envName}`);
    }

    const normalizedValue = stripTrailingNewlines(fileValue);
    if (normalizedValue.length === 0) {
      throw new Error(`${fileEnvName} for ${envName} must not be empty`);
    }

    resolvedEnv[envName] = normalizedValue;
  }

  return resolvedEnv;
}

const rawEnv = resolveFileBackedEnv(process.env);
const envResult = envSchema.safeParse(rawEnv);

if (!envResult.success) {
  const issues = envResult.error.issues
    .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
    .join("; ");
  throw new Error(`Invalid backend environment: ${issues}`);
}

const parsedEnv = envResult.data;

const isProduction = parsedEnv.NODE_ENV === "production";
const defaultSecrets = new Set([
  "cruzible-dev-jwt-secret",
  "cruzible-dev-refresh-secret",
]);
const indexerWsUrl =
  parsedEnv.INDEXER_WS_URL ?? parsedEnv.WS_URL ?? DEFAULT_INDEXER_WS_URL;
const indexerRpcUrl = parsedEnv.INDEXER_RPC_URL ?? DEFAULT_INDEXER_RPC_URL;
requireUrlProtocol(parsedEnv.RPC_URL, "RPC_URL", ["http:", "https:"]);
requireUrlProtocol(parsedEnv.INDEXER_RPC_URL, "INDEXER_RPC_URL", [
  "http:",
  "https:",
]);
requireUrlProtocol(parsedEnv.INDEXER_WS_URL, "INDEXER_WS_URL", ["ws:", "wss:"]);
requireUrlProtocol(parsedEnv.WS_URL, "WS_URL", ["ws:", "wss:"]);
rejectUrlUserInfoAndFragment(parsedEnv.RPC_URL, "RPC_URL");
rejectUrlUserInfoAndFragment(parsedEnv.INDEXER_RPC_URL, "INDEXER_RPC_URL");
rejectUrlUserInfoAndFragment(parsedEnv.INDEXER_WS_URL, "INDEXER_WS_URL");
rejectUrlUserInfoAndFragment(parsedEnv.WS_URL, "WS_URL");
const authAdminAddresses = parseAddressList(
  parsedEnv.AUTH_ADMIN_ADDRESSES,
  "AUTH_ADMIN_ADDRESSES",
);
const authOperatorAddresses = parseAddressList(
  parsedEnv.AUTH_OPERATOR_ADDRESSES,
  "AUTH_OPERATOR_ADDRESSES",
);
const metricsEnabled = parsedEnv.METRICS_ENABLED ?? true;
const apiDocsEnabled = parsedEnv.API_DOCS_ENABLED ?? !isProduction;
const authExposeRefreshTokenInBody =
  parsedEnv.AUTH_EXPOSE_REFRESH_TOKEN_IN_BODY ?? !isProduction;

requireNoControlCharacters(parsedEnv.JWT_SECRET, "JWT_SECRET");
requireNoControlCharacters(parsedEnv.JWT_REFRESH_SECRET, "JWT_REFRESH_SECRET");
requireNoControlCharacters(
  parsedEnv.OPERATIONAL_ENDPOINTS_TOKEN,
  "OPERATIONAL_ENDPOINTS_TOKEN",
);

function formatUrlProtocols(protocols: readonly string[]): string {
  return protocols.map((protocol) => `${protocol}//`).join(" or ");
}

function requireUrlProtocol(
  value: string | undefined,
  envName: string,
  protocols: readonly string[],
): void {
  if (!value) {
    return;
  }

  const parsed = new URL(value);
  if (!protocols.includes(parsed.protocol)) {
    throw new Error(`${envName} must use ${formatUrlProtocols(protocols)}`);
  }
}

function requireProductionConfig(value: unknown, message: string): void {
  if (value === undefined || value === null || value === "") {
    throw new Error(message);
  }
}

function requireProductionSecretLength(value: string, envName: string): void {
  if (value.length < MIN_PRODUCTION_SECRET_LENGTH) {
    throw new Error(
      `${envName} must be at least ${MIN_PRODUCTION_SECRET_LENGTH} characters in production`,
    );
  }
}

function requireNoControlCharacters(
  value: string | undefined,
  envName: string,
): void {
  if (
    value &&
    [...value].some((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint <= 0x1f || codePoint === 0x7f;
    })
  ) {
    throw new Error(`${envName} must not contain control characters`);
  }
}

function requireDistinctSecrets(
  firstValue: string | undefined,
  firstName: string,
  secondValue: string | undefined,
  secondName: string,
): void {
  if (firstValue && secondValue && firstValue === secondValue) {
    throw new Error(`${firstName} and ${secondName} must be distinct secrets`);
  }
}

function parseDurationMs(value: string): number {
  const match = value.match(TOKEN_DURATION_PATTERN);
  if (!match) {
    throw new Error(`Invalid duration "${value}"`);
  }

  const amount = Number(match[1]);
  if (match[2] === "m") {
    return amount * 60 * 1000;
  }
  if (match[2] === "h") {
    return amount * 60 * 60 * 1000;
  }
  return amount * 24 * 60 * 60 * 1000;
}

function requireMaxProductionDuration(
  value: string,
  envName: string,
  maxMs: number,
  maxLabel: string,
): void {
  if (parseDurationMs(value) > maxMs) {
    throw new Error(`${envName} must be ${maxLabel} or shorter in production`);
  }
}

function requireMaxProductionMilliseconds(
  value: number,
  envName: string,
  maxMs: number,
  maxLabel: string,
): void {
  if (value > maxMs) {
    throw new Error(`${envName} must be ${maxLabel} or shorter in production`);
  }
}

function parseAddressList(value: string, envName: string): string[] {
  const addresses = value
    .split(",")
    .map((address) => address.trim().toLowerCase())
    .filter(Boolean);

  for (const address of addresses) {
    if (!AUTH_ROLE_ADDRESS_PATTERN.test(address)) {
      throw new Error(
        `${envName} contains invalid wallet address "${address}"; expected an aeth1-prefixed lowercase address`,
      );
    }
  }

  return [...new Set(addresses)];
}

function parseCorsOrigins(value: string, production: boolean): string[] {
  const rawOrigins = value
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  if (rawOrigins.length === 0) {
    throw new Error("CORS_ORIGINS must include at least one origin");
  }

  const normalizedOrigins = rawOrigins.map((origin) => {
    if (origin.includes("*")) {
      throw new Error(
        production
          ? "Refusing to start with wildcard CORS origins in production"
          : "CORS_ORIGINS must not contain wildcard origins",
      );
    }

    let parsed: URL;

    try {
      parsed = new URL(origin);
    } catch {
      throw new Error(`CORS_ORIGINS contains invalid origin "${origin}"`);
    }

    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      throw new Error("CORS_ORIGINS entries must use http or https");
    }

    if (
      parsed.username ||
      parsed.password ||
      parsed.pathname !== "/" ||
      parsed.search ||
      parsed.hash
    ) {
      throw new Error(
        `CORS_ORIGINS entries must be bare origins without paths, credentials, query strings, or fragments: "${origin}"`,
      );
    }

    if (production && parsed.protocol !== "https:") {
      throw new Error(
        "Refusing to start with non-HTTPS CORS origins in production",
      );
    }

    if (production && isPrivateOrLocalHostname(parsed.hostname)) {
      throw new Error(
        "Refusing to start with private or local CORS origins in production",
      );
    }

    return parsed.origin;
  });

  return [...new Set(normalizedOrigins)];
}

function parseDatabaseUrl(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  const parsed = new URL(value);

  if (parsed.protocol !== "postgresql:" && parsed.protocol !== "postgres:") {
    throw new Error("DATABASE_URL must use postgresql:// or postgres://");
  }

  if (parsed.hash) {
    throw new Error("DATABASE_URL must not contain fragments");
  }

  return parsed.href;
}

function parseRedisUrl(
  value: string | undefined,
  production: boolean,
): string | undefined {
  if (!value) {
    return undefined;
  }

  const parsed = new URL(value);

  if (parsed.protocol !== "redis:" && parsed.protocol !== "rediss:") {
    throw new Error("REDIS_URL must use redis:// or rediss://");
  }

  if (parsed.hash) {
    throw new Error("REDIS_URL must not contain fragments");
  }

  if (production && parsed.protocol !== "rediss:") {
    throw new Error("Refusing to start with non-TLS REDIS_URL in production");
  }

  return parsed.href;
}

function parseAlertWebhookUrl(
  value: string | undefined,
  production: boolean,
): string | undefined {
  if (!value) {
    return undefined;
  }

  const parsed = new URL(value);

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error("ALERT_WEBHOOK_URL must use http or https");
  }

  if (parsed.username || parsed.password || parsed.hash) {
    throw new Error(
      "ALERT_WEBHOOK_URL must not contain credentials or fragments",
    );
  }

  if (production && parsed.protocol !== "https:") {
    throw new Error(
      "Refusing to start with non-HTTPS ALERT_WEBHOOK_URL in production",
    );
  }

  if (production && isPrivateOrLocalHostname(parsed.hostname)) {
    throw new Error(
      "Refusing to start with private or local ALERT_WEBHOOK_URL in production",
    );
  }

  return parsed.href;
}

if (isProduction) {
  requireProductionConfig(
    process.env.RPC_URL,
    "Refusing to start without RPC_URL in production",
  );
  requireProductionConfig(
    parsedEnv.DATABASE_URL,
    "Refusing to start without DATABASE_URL in production",
  );
  requireProductionConfig(
    parsedEnv.REDIS_URL,
    "Refusing to start without REDIS_URL in production",
  );
  requireProductionConfig(
    process.env.CORS_ORIGINS,
    "Refusing to start without explicit CORS_ORIGINS in production",
  );

  if (
    defaultSecrets.has(parsedEnv.JWT_SECRET) ||
    defaultSecrets.has(parsedEnv.JWT_REFRESH_SECRET)
  ) {
    throw new Error(
      "Refusing to start with development JWT secrets in production",
    );
  }
  requireProductionSecretLength(parsedEnv.JWT_SECRET, "JWT_SECRET");
  requireProductionSecretLength(
    parsedEnv.JWT_REFRESH_SECRET,
    "JWT_REFRESH_SECRET",
  );
  requireMaxProductionDuration(
    parsedEnv.JWT_EXPIRES_IN,
    "JWT_EXPIRES_IN",
    MAX_PRODUCTION_ACCESS_TOKEN_MS,
    "15m",
  );
  requireMaxProductionDuration(
    parsedEnv.JWT_REFRESH_EXPIRES_IN,
    "JWT_REFRESH_EXPIRES_IN",
    MAX_PRODUCTION_REFRESH_TOKEN_MS,
    "30d",
  );
  requireMaxProductionMilliseconds(
    parsedEnv.AUTH_NONCE_TTL_MS,
    "AUTH_NONCE_TTL_MS",
    MAX_PRODUCTION_NONCE_TTL_MS,
    "10m",
  );

  if (parsedEnv.ALLOW_MOCK_SIGNATURES) {
    throw new Error(
      "Refusing to enable mock signature verification in production",
    );
  }

  if (parsedEnv.AUTH_EXPOSE_REFRESH_TOKEN_IN_BODY) {
    throw new Error(
      "Refusing to expose refresh tokens in response bodies in production",
    );
  }

  if (authAdminAddresses.length === 0 && authOperatorAddresses.length === 0) {
    throw new Error(
      "Refusing to start production API without AUTH_OPERATOR_ADDRESSES or AUTH_ADMIN_ADDRESSES",
    );
  }

  if (parsedEnv.INDEXER_ENABLED) {
    requireProductionConfig(
      process.env.INDEXER_RPC_URL,
      "Refusing to start production indexer without INDEXER_RPC_URL",
    );
    requireProductionConfig(
      process.env.INDEXER_WS_URL ?? process.env.WS_URL,
      "Refusing to start production indexer without INDEXER_WS_URL",
    );
    requireProductionConfig(
      parsedEnv.INDEXER_EXPECTED_CHAIN_ID,
      "Refusing to start production indexer without INDEXER_EXPECTED_CHAIN_ID",
    );
    requireProductionConfig(
      parsedEnv.CRUZIBLE_VAULT_ADDRESS,
      "Refusing to start production indexer without CRUZIBLE_VAULT_ADDRESS",
    );
    requireProductionConfig(
      parsedEnv.STAETHEL_ADDRESS,
      "Refusing to start production indexer without STAETHEL_ADDRESS",
    );
    requireProductionConfig(
      parsedEnv.STABLECOIN_BRIDGE_ADDRESS,
      "Refusing to start production indexer without STABLECOIN_BRIDGE_ADDRESS",
    );
  }
}

if (
  parsedEnv.RECONCILIATION_RATE_WARN_PCT >=
  parsedEnv.RECONCILIATION_RATE_CRIT_PCT
) {
  throw new Error(
    "RECONCILIATION_RATE_CRIT_PCT must be greater than RECONCILIATION_RATE_WARN_PCT",
  );
}

if (parsedEnv.HTTP_HEADERS_TIMEOUT_MS >= parsedEnv.HTTP_REQUEST_TIMEOUT_MS) {
  throw new Error(
    "HTTP_HEADERS_TIMEOUT_MS must be lower than HTTP_REQUEST_TIMEOUT_MS",
  );
}

if (parsedEnv.HTTP_KEEP_ALIVE_TIMEOUT_MS >= parsedEnv.HTTP_HEADERS_TIMEOUT_MS) {
  throw new Error(
    "HTTP_KEEP_ALIVE_TIMEOUT_MS must be lower than HTTP_HEADERS_TIMEOUT_MS",
  );
}

const trustProxy =
  parsedEnv.TRUST_PROXY === "false"
    ? false
    : parsedEnv.TRUST_PROXY === "true"
      ? true
      : /^\d+$/.test(parsedEnv.TRUST_PROXY)
        ? Number(parsedEnv.TRUST_PROXY)
        : parsedEnv.TRUST_PROXY;

if (isProduction && trustProxy === true) {
  throw new Error(
    "Refusing to start with TRUST_PROXY=true in production; configure a hop count or explicit proxy subnet",
  );
}

const corsOrigins = parseCorsOrigins(parsedEnv.CORS_ORIGINS, isProduction);
const databaseUrl = parseDatabaseUrl(parsedEnv.DATABASE_URL);
const redisUrl = parseRedisUrl(parsedEnv.REDIS_URL, isProduction);
const alertWebhookUrl = parseAlertWebhookUrl(
  parsedEnv.ALERT_WEBHOOK_URL,
  isProduction,
);

requireDistinctSecrets(
  parsedEnv.JWT_SECRET,
  "JWT_SECRET",
  parsedEnv.JWT_REFRESH_SECRET,
  "JWT_REFRESH_SECRET",
);
requireDistinctSecrets(
  parsedEnv.OPERATIONAL_ENDPOINTS_TOKEN,
  "OPERATIONAL_ENDPOINTS_TOKEN",
  parsedEnv.JWT_SECRET,
  "JWT_SECRET",
);
requireDistinctSecrets(
  parsedEnv.OPERATIONAL_ENDPOINTS_TOKEN,
  "OPERATIONAL_ENDPOINTS_TOKEN",
  parsedEnv.JWT_REFRESH_SECRET,
  "JWT_REFRESH_SECRET",
);

export const config = {
  env: parsedEnv.NODE_ENV,
  isProduction,
  port: parsedEnv.PORT,
  version: process.env.npm_package_version || "1.0.0",
  rpcUrl: parsedEnv.RPC_URL,
  databaseUrl,
  redisUrl,
  corsOrigins,
  jwtSecret: parsedEnv.JWT_SECRET,
  jwtRefreshSecret: parsedEnv.JWT_REFRESH_SECRET,
  jwtExpiresIn: parsedEnv.JWT_EXPIRES_IN,
  jwtRefreshExpiresIn: parsedEnv.JWT_REFRESH_EXPIRES_IN,
  jwtRefreshCookieMaxAgeMs: parseDurationMs(parsedEnv.JWT_REFRESH_EXPIRES_IN),
  trustProxy,
  rateLimitWindowMs: parsedEnv.RATE_LIMIT_WINDOW_MS,
  rateLimitMax: parsedEnv.RATE_LIMIT_MAX,
  httpHeadersTimeoutMs: parsedEnv.HTTP_HEADERS_TIMEOUT_MS,
  httpRequestTimeoutMs: parsedEnv.HTTP_REQUEST_TIMEOUT_MS,
  httpKeepAliveTimeoutMs: parsedEnv.HTTP_KEEP_ALIVE_TIMEOUT_MS,
  httpMaxRequestsPerSocket: parsedEnv.HTTP_MAX_REQUESTS_PER_SOCKET,
  allowMockSignatures: parsedEnv.ALLOW_MOCK_SIGNATURES,
  authAdminAddresses,
  authOperatorAddresses,
  authNonceTtlMs: parsedEnv.AUTH_NONCE_TTL_MS,
  authExposeRefreshTokenInBody,
  authRateLimitWindowMs: parsedEnv.AUTH_RATE_LIMIT_WINDOW_MS,
  authRateLimitMax: parsedEnv.AUTH_RATE_LIMIT_MAX,
  opsRateLimitWindowMs: parsedEnv.OPS_RATE_LIMIT_WINDOW_MS,
  opsRateLimitMax: parsedEnv.OPS_RATE_LIMIT_MAX,
  publicExpensiveRateLimitWindowMs:
    parsedEnv.PUBLIC_EXPENSIVE_RATE_LIMIT_WINDOW_MS,
  publicExpensiveRateLimitMax: parsedEnv.PUBLIC_EXPENSIVE_RATE_LIMIT_MAX,
  metricsEnabled,
  apiDocsEnabled,
  operationalEndpointsToken: parsedEnv.OPERATIONAL_ENDPOINTS_TOKEN,

  // Indexer
  indexerWsUrl,
  indexerRpcUrl,
  cruzibleVaultAddress: parsedEnv.CRUZIBLE_VAULT_ADDRESS,
  staethelAddress: parsedEnv.STAETHEL_ADDRESS,
  stablecoinBridgeAddress: parsedEnv.STABLECOIN_BRIDGE_ADDRESS,
  indexerStartBlock: parsedEnv.INDEXER_START_BLOCK,
  indexerExpectedChainId: parsedEnv.INDEXER_EXPECTED_CHAIN_ID,
  indexerEnabled: parsedEnv.INDEXER_ENABLED,

  // Alerting
  alertWebhookUrl,
  alertRateLimitMs: parsedEnv.ALERT_RATE_LIMIT_MS,

  // Reconciliation
  reconciliationIntervalMs: parsedEnv.RECONCILIATION_INTERVAL_MS,
  reconciliationMinValidators: parsedEnv.RECONCILIATION_MIN_VALIDATORS,
  reconciliationEpochDurationSeconds: parsedEnv.RECONCILIATION_EPOCH_DURATION_S,
  reconciliationRateWarnThreshold: parsedEnv.RECONCILIATION_RATE_WARN_PCT,
  reconciliationRateCriticalThreshold: parsedEnv.RECONCILIATION_RATE_CRIT_PCT,
  reconciliationTvlDriftThreshold: parsedEnv.RECONCILIATION_TVL_DRIFT_PCT,
} as const;
