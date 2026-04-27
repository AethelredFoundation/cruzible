import { z } from 'zod';

const DEFAULT_INDEXER_WS_URL = 'ws://127.0.0.1:8546';
const DEFAULT_INDEXER_RPC_URL = 'http://127.0.0.1:8545';
const EVM_ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;
const ZERO_EVM_ADDRESS = '0x0000000000000000000000000000000000000000';

const optionalUrlSchema = z.preprocess(
  (value) => (value === '' ? undefined : value),
  z.string().url().optional(),
);

const evmAddressSchema = z
  .string()
  .default('')
  .refine(
    (value) =>
      value === '' ||
      (EVM_ADDRESS_PATTERN.test(value) &&
        value.toLowerCase() !== ZERO_EVM_ADDRESS),
    'must be blank or a non-zero EVM address',
  );

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  RPC_URL: z.string().url().default('http://127.0.0.1:26657'),
  DATABASE_URL: optionalUrlSchema,
  CORS_ORIGINS: z.string().default('http://localhost:3000'),
  JWT_SECRET: z.string().min(16).default('cruzible-dev-jwt-secret'),
  JWT_REFRESH_SECRET: z.string().min(16).default('cruzible-dev-refresh-secret'),
  JWT_EXPIRES_IN: z.string().regex(/^\d+[hd]$/).default('1h'),
  JWT_REFRESH_EXPIRES_IN: z.string().regex(/^\d+[hd]$/).default('7d'),
  TRUST_PROXY: z.string().default('loopback'),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().min(1000).default(60_000),
  RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(120),
  ALLOW_MOCK_SIGNATURES: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
  AUTH_ADMIN_ADDRESSES: z.string().default(''),
  AUTH_OPERATOR_ADDRESSES: z.string().default(''),
  AUTH_NONCE_TTL_MS: z.coerce.number().int().min(30_000).default(300_000),
  AUTH_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().min(1000).default(60_000),
  AUTH_RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(10),
  OPS_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().min(1000).default(60_000),
  OPS_RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(60),

  // Indexer configuration
  INDEXER_WS_URL: optionalUrlSchema,
  INDEXER_RPC_URL: optionalUrlSchema,
  WS_URL: optionalUrlSchema,
  CRUZIBLE_VAULT_ADDRESS: evmAddressSchema,
  STAETHEL_ADDRESS: evmAddressSchema,
  STABLECOIN_BRIDGE_ADDRESS: evmAddressSchema,
  INDEXER_START_BLOCK: z.coerce.number().int().min(0).default(0),
  INDEXER_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((value) => value === 'true'),

  // Alerting
  ALERT_WEBHOOK_URL: optionalUrlSchema,
  ALERT_RATE_LIMIT_MS: z.coerce.number().int().min(1000).default(300_000),

  // Reconciliation
  RECONCILIATION_INTERVAL_MS: z.coerce.number().int().min(1000).default(300_000),
  RECONCILIATION_MIN_VALIDATORS: z.coerce.number().int().min(1).default(4),
  RECONCILIATION_EPOCH_DURATION_S: z.coerce.number().int().min(1).default(3600),
  RECONCILIATION_RATE_WARN_PCT: z.coerce.number().min(0).max(1).default(0.01),
  RECONCILIATION_RATE_CRIT_PCT: z.coerce.number().min(0).max(1).default(0.05),
  RECONCILIATION_TVL_DRIFT_PCT: z.coerce.number().min(0).max(1).default(0.02),
});

const envResult = envSchema.safeParse(process.env);

if (!envResult.success) {
  const issues = envResult.error.issues
    .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
    .join('; ');
  throw new Error(`Invalid backend environment: ${issues}`);
}

const parsedEnv = envResult.data;

const isProduction = parsedEnv.NODE_ENV === 'production';
const defaultSecrets = new Set(['cruzible-dev-jwt-secret', 'cruzible-dev-refresh-secret']);
const indexerWsUrl =
  parsedEnv.INDEXER_WS_URL ?? parsedEnv.WS_URL ?? DEFAULT_INDEXER_WS_URL;
const indexerRpcUrl = parsedEnv.INDEXER_RPC_URL ?? DEFAULT_INDEXER_RPC_URL;
const authAdminAddresses = parseAddressList(parsedEnv.AUTH_ADMIN_ADDRESSES);
const authOperatorAddresses = parseAddressList(parsedEnv.AUTH_OPERATOR_ADDRESSES);

function requireProductionConfig(value: unknown, message: string): void {
  if (value === undefined || value === null || value === '') {
    throw new Error(message);
  }
}

function parseAddressList(value: string): string[] {
  return value
    .split(',')
    .map((address) => address.trim().toLowerCase())
    .filter(Boolean);
}

if (isProduction) {
  requireProductionConfig(
    process.env.RPC_URL,
    'Refusing to start without RPC_URL in production',
  );
  requireProductionConfig(
    parsedEnv.DATABASE_URL,
    'Refusing to start without DATABASE_URL in production',
  );

  if (defaultSecrets.has(parsedEnv.JWT_SECRET) || defaultSecrets.has(parsedEnv.JWT_REFRESH_SECRET)) {
    throw new Error('Refusing to start with development JWT secrets in production');
  }

  if (parsedEnv.CORS_ORIGINS.includes('*')) {
    throw new Error('Refusing to start with wildcard CORS origins in production');
  }

  if (parsedEnv.ALLOW_MOCK_SIGNATURES) {
    throw new Error('Refusing to enable mock signature verification in production');
  }

  if (parsedEnv.INDEXER_ENABLED) {
    requireProductionConfig(
      process.env.INDEXER_RPC_URL,
      'Refusing to start production indexer without INDEXER_RPC_URL',
    );
    requireProductionConfig(
      process.env.INDEXER_WS_URL ?? process.env.WS_URL,
      'Refusing to start production indexer without INDEXER_WS_URL',
    );
    requireProductionConfig(
      parsedEnv.CRUZIBLE_VAULT_ADDRESS,
      'Refusing to start production indexer without CRUZIBLE_VAULT_ADDRESS',
    );
    requireProductionConfig(
      parsedEnv.STAETHEL_ADDRESS,
      'Refusing to start production indexer without STAETHEL_ADDRESS',
    );
    requireProductionConfig(
      parsedEnv.STABLECOIN_BRIDGE_ADDRESS,
      'Refusing to start production indexer without STABLECOIN_BRIDGE_ADDRESS',
    );
  }
}

if (parsedEnv.RECONCILIATION_RATE_WARN_PCT >= parsedEnv.RECONCILIATION_RATE_CRIT_PCT) {
  throw new Error(
    'RECONCILIATION_RATE_CRIT_PCT must be greater than RECONCILIATION_RATE_WARN_PCT',
  );
}

const trustProxy =
  parsedEnv.TRUST_PROXY === 'false'
    ? false
    : parsedEnv.TRUST_PROXY === 'true'
      ? true
      : parsedEnv.TRUST_PROXY;

export const config = {
  env: parsedEnv.NODE_ENV,
  isProduction,
  port: parsedEnv.PORT,
  version: process.env.npm_package_version || '1.0.0',
  rpcUrl: parsedEnv.RPC_URL,
  databaseUrl: parsedEnv.DATABASE_URL,
  corsOrigins: parsedEnv.CORS_ORIGINS.split(',')
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
  authAdminAddresses,
  authOperatorAddresses,
  authNonceTtlMs: parsedEnv.AUTH_NONCE_TTL_MS,
  authRateLimitWindowMs: parsedEnv.AUTH_RATE_LIMIT_WINDOW_MS,
  authRateLimitMax: parsedEnv.AUTH_RATE_LIMIT_MAX,
  opsRateLimitWindowMs: parsedEnv.OPS_RATE_LIMIT_WINDOW_MS,
  opsRateLimitMax: parsedEnv.OPS_RATE_LIMIT_MAX,

  // Indexer
  indexerWsUrl,
  indexerRpcUrl,
  cruzibleVaultAddress: parsedEnv.CRUZIBLE_VAULT_ADDRESS,
  staethelAddress: parsedEnv.STAETHEL_ADDRESS,
  stablecoinBridgeAddress: parsedEnv.STABLECOIN_BRIDGE_ADDRESS,
  indexerStartBlock: parsedEnv.INDEXER_START_BLOCK,
  indexerEnabled: parsedEnv.INDEXER_ENABLED,

  // Alerting
  alertWebhookUrl: parsedEnv.ALERT_WEBHOOK_URL,
  alertRateLimitMs: parsedEnv.ALERT_RATE_LIMIT_MS,

  // Reconciliation
  reconciliationIntervalMs: parsedEnv.RECONCILIATION_INTERVAL_MS,
  reconciliationMinValidators: parsedEnv.RECONCILIATION_MIN_VALIDATORS,
  reconciliationEpochDurationSeconds: parsedEnv.RECONCILIATION_EPOCH_DURATION_S,
  reconciliationRateWarnThreshold: parsedEnv.RECONCILIATION_RATE_WARN_PCT,
  reconciliationRateCriticalThreshold: parsedEnv.RECONCILIATION_RATE_CRIT_PCT,
  reconciliationTvlDriftThreshold: parsedEnv.RECONCILIATION_TVL_DRIFT_PCT,
} as const;
