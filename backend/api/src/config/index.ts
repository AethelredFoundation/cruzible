import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  RPC_URL: z.string().url().default("http://127.0.0.1:26657"),
  CORS_ORIGINS: z.string().default("http://localhost:3000"),
  JWT_SECRET: z.string().min(16).default("cruzible-dev-jwt-secret"),
  JWT_REFRESH_SECRET: z.string().min(16).default("cruzible-dev-refresh-secret"),
  JWT_EXPIRES_IN: z
    .string()
    .regex(/^\d+[hd]$/)
    .default("1h"),
  JWT_REFRESH_EXPIRES_IN: z
    .string()
    .regex(/^\d+[hd]$/)
    .default("7d"),
  TRUST_PROXY: z.string().default("loopback"),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().min(1000).default(60_000),
  RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(120),
  ALLOW_MOCK_SIGNATURES: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),

  // Indexer configuration
  INDEXER_WS_URL: z.string().default("ws://127.0.0.1:8546"),
  INDEXER_RPC_URL: z.string().default("http://127.0.0.1:8545"),
  CRUZIBLE_VAULT_ADDRESS: z.string().default(""),
  STAETHEL_ADDRESS: z.string().default(""),
  INDEXER_START_BLOCK: z.coerce.number().int().min(0).default(0),
  INDEXER_ENABLED: z
    .enum(["true", "false"])
    .default("true")
    .transform((value) => value === "true"),
});

const parsedEnv = envSchema.parse(process.env);

const isProduction = parsedEnv.NODE_ENV === "production";
const defaultSecrets = new Set([
  "cruzible-dev-jwt-secret",
  "cruzible-dev-refresh-secret",
]);

if (isProduction) {
  if (
    defaultSecrets.has(parsedEnv.JWT_SECRET) ||
    defaultSecrets.has(parsedEnv.JWT_REFRESH_SECRET)
  ) {
    throw new Error(
      "Refusing to start with development JWT secrets in production",
    );
  }

  if (parsedEnv.CORS_ORIGINS.includes("*")) {
    throw new Error(
      "Refusing to start with wildcard CORS origins in production",
    );
  }

  if (parsedEnv.ALLOW_MOCK_SIGNATURES) {
    throw new Error(
      "Refusing to enable mock signature verification in production",
    );
  }
}

const trustProxy =
  parsedEnv.TRUST_PROXY === "false"
    ? false
    : parsedEnv.TRUST_PROXY === "true"
      ? true
      : parsedEnv.TRUST_PROXY;

export const config = {
  env: parsedEnv.NODE_ENV,
  isProduction,
  port: parsedEnv.PORT,
  version: process.env.npm_package_version || "1.0.0",
  rpcUrl: parsedEnv.RPC_URL,
  corsOrigins: parsedEnv.CORS_ORIGINS.split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
  jwtSecret: parsedEnv.JWT_SECRET,
  jwtRefreshSecret: parsedEnv.JWT_REFRESH_SECRET,
  jwtExpiresIn: parsedEnv.JWT_EXPIRES_IN,
  jwtRefreshExpiresIn: parsedEnv.JWT_REFRESH_EXPIRES_IN,
  trustProxy,
  rateLimitWindowMs: parsedEnv.RATE_LIMIT_WINDOW_MS,
  rateLimitMax: parsedEnv.RATE_LIMIT_MAX,
  allowMockSignatures: parsedEnv.ALLOW_MOCK_SIGNATURES,

  // Indexer
  indexerWsUrl: parsedEnv.INDEXER_WS_URL,
  indexerRpcUrl: parsedEnv.INDEXER_RPC_URL,
  cruzibleVaultAddress: parsedEnv.CRUZIBLE_VAULT_ADDRESS,
  staethelAddress: parsedEnv.STAETHEL_ADDRESS,
  indexerStartBlock: parsedEnv.INDEXER_START_BLOCK,
  indexerEnabled: parsedEnv.INDEXER_ENABLED,
} as const;
