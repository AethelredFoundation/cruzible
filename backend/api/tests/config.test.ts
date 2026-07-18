import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const originalEnv = { ...process.env };
const CONFIG_ENV_KEYS = [
  "NODE_ENV",
  "CRUZIBLE_NETWORK",
  "CRUZIBLE_ALLOW_PLAINTEXT_HTTP",
  "PORT",
  "RPC_URL",
  "DATABASE_URL",
  "DATABASE_URL_FILE",
  "REDIS_URL",
  "REDIS_URL_FILE",
  "CORS_ORIGINS",
  "JWT_SECRET",
  "JWT_SECRET_FILE",
  "JWT_REFRESH_SECRET",
  "JWT_REFRESH_SECRET_FILE",
  "LOG_HASH_SECRET",
  "LOG_HASH_SECRET_FILE",
  "JWT_EXPIRES_IN",
  "JWT_REFRESH_EXPIRES_IN",
  "AUTH_EXPOSE_REFRESH_TOKEN_IN_BODY",
  "TRUST_PROXY",
  "RATE_LIMIT_WINDOW_MS",
  "RATE_LIMIT_MAX",
  "HTTP_HEADERS_TIMEOUT_MS",
  "HTTP_REQUEST_TIMEOUT_MS",
  "HTTP_KEEP_ALIVE_TIMEOUT_MS",
  "HTTP_MAX_REQUESTS_PER_SOCKET",
  "ALLOW_MOCK_SIGNATURES",
  "AUTH_ADMIN_ADDRESSES",
  "AUTH_OPERATOR_ADDRESSES",
  "CRUZIBLE_RUNTIME_ROLE",
  "AUTH_NONCE_TTL_MS",
  "AUTH_RATE_LIMIT_WINDOW_MS",
  "AUTH_RATE_LIMIT_MAX",
  "OPS_RATE_LIMIT_WINDOW_MS",
  "OPS_RATE_LIMIT_MAX",
  "PUBLIC_EXPENSIVE_RATE_LIMIT_WINDOW_MS",
  "PUBLIC_EXPENSIVE_RATE_LIMIT_MAX",
  "METRICS_ENABLED",
  "API_DOCS_ENABLED",
  "OPERATIONAL_ENDPOINTS_TOKEN",
  "OPERATIONAL_ENDPOINTS_TOKEN_FILE",
  "ALLOW_UNAUTHENTICATED_OPERATIONAL_ENDPOINTS",
  "INDEXER_ENABLED",
  "INDEXER_RPC_URL",
  "INDEXER_WS_URL",
  "WS_URL",
  "INDEXER_START_BLOCK",
  "CRUZIBLE_VAULT_ADDRESS",
  "STAETHEL_ADDRESS",
  "STABLECOIN_BRIDGE_ADDRESS",
  "INDEXER_REQUIRE_STABLECOIN_BRIDGE",
  "INDEXER_EXPECTED_CHAIN_ID",
  "INDEXER_EXPECTED_GENESIS_HASH",
  "ALERT_WEBHOOK_URL",
  "ALERT_WEBHOOK_URL_FILE",
  "ALERT_RATE_LIMIT_MS",
  "RECONCILIATION_INTERVAL_MS",
  "RECONCILIATION_MIN_VALIDATORS",
  "RECONCILIATION_EPOCH_DURATION_S",
  "RECONCILIATION_RATE_WARN_PCT",
  "RECONCILIATION_RATE_CRIT_PCT",
  "RECONCILIATION_TVL_DRIFT_PCT",
] as const;

const productionBaseEnv = {
  NODE_ENV: "production",
  CRUZIBLE_NETWORK: "testnet",
  CRUZIBLE_ALLOW_PLAINTEXT_HTTP: "true",
  RPC_URL: "http://127.0.0.1:26657",
  INDEXER_RPC_URL: "http://127.0.0.1:8545",
  DATABASE_URL: "postgresql://cruzible:cruzible@127.0.0.1:5432/cruzible",
  REDIS_URL: "rediss://cache.cruzible.org:6379",
  CORS_ORIGINS: "https://app.cruzible.org",
  JWT_SECRET: "production-jwt-secret-012345678901",
  JWT_REFRESH_SECRET: "production-refresh-secret-012345678",
  LOG_HASH_SECRET: "production-log-hash-secret-0123456789",
  ALLOW_MOCK_SIGNATURES: "false",
  AUTH_OPERATOR_ADDRESSES: "aeth1operator",
  INDEXER_EXPECTED_CHAIN_ID: "7332",
  INDEXER_EXPECTED_GENESIS_HASH:
    "0xf4b43647f4d3255a7e9321ea4b32057101ed143623390bc30d59e69a91ceafa7",
  CRUZIBLE_VAULT_ADDRESS: "0x1111111111111111111111111111111111111111",
  STAETHEL_ADDRESS: "0x2222222222222222222222222222222222222222",
  INDEXER_ENABLED: "false",
} satisfies NodeJS.ProcessEnv;

async function loadConfigWithEnv(env: NodeJS.ProcessEnv) {
  vi.resetModules();
  process.env = { ...originalEnv };

  for (const key of CONFIG_ENV_KEYS) {
    delete process.env[key];
  }

  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  return import("../src/config");
}

function writeTempSecretFile(value: string): string {
  const dir = mkdtempSync(join(tmpdir(), "cruzible-config-"));
  const filePath = join(dir, "secret");
  writeFileSync(filePath, value, { mode: 0o600 });
  tempDirs.push(dir);
  return filePath;
}

const tempDirs: string[] = [];

afterEach(() => {
  process.env = { ...originalEnv };
  vi.resetModules();
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("backend config hardening", () => {
  it("rejects development JWT secrets in production", async () => {
    await expect(
      loadConfigWithEnv({
        ...productionBaseEnv,
        JWT_SECRET: "cruzible-dev-jwt-secret",
        JWT_REFRESH_SECRET: "cruzible-dev-refresh-secret",
      }),
    ).rejects.toThrow(
      "Refusing to start with development JWT secrets in production",
    );
  });

  it("rejects short JWT secrets in production", async () => {
    await expect(
      loadConfigWithEnv({
        ...productionBaseEnv,
        JWT_SECRET: "short-production-secret",
      }),
    ).rejects.toThrow(
      "JWT_SECRET must be at least 32 characters in production",
    );

    await expect(
      loadConfigWithEnv({
        ...productionBaseEnv,
        JWT_REFRESH_SECRET: "short-refresh-secret",
      }),
    ).rejects.toThrow(
      "JWT_REFRESH_SECRET must be at least 32 characters in production",
    );
  });

  it("requires a dedicated production log hash secret", async () => {
    await expect(
      loadConfigWithEnv({
        ...productionBaseEnv,
        LOG_HASH_SECRET: "cruzible-dev-log-hash-secret",
      }),
    ).rejects.toThrow(
      "Refusing to start with development LOG_HASH_SECRET in production",
    );

    await expect(
      loadConfigWithEnv({
        ...productionBaseEnv,
        LOG_HASH_SECRET: "short-log-secret",
      }),
    ).rejects.toThrow(
      "LOG_HASH_SECRET must be at least 32 characters in production",
    );
  });

  it("rejects reused access and refresh signing secrets", async () => {
    await expect(
      loadConfigWithEnv({
        ...productionBaseEnv,
        JWT_REFRESH_SECRET: productionBaseEnv.JWT_SECRET,
      }),
    ).rejects.toThrow("JWT_SECRET and JWT_REFRESH_SECRET must be distinct");
  });

  it("rejects operational endpoint tokens reused as signing secrets", async () => {
    await expect(
      loadConfigWithEnv({
        ...productionBaseEnv,
        OPERATIONAL_ENDPOINTS_TOKEN: productionBaseEnv.JWT_SECRET,
      }),
    ).rejects.toThrow(
      "OPERATIONAL_ENDPOINTS_TOKEN and JWT_SECRET must be distinct",
    );

    await expect(
      loadConfigWithEnv({
        ...productionBaseEnv,
        OPERATIONAL_ENDPOINTS_TOKEN: productionBaseEnv.JWT_REFRESH_SECRET,
      }),
    ).rejects.toThrow(
      "OPERATIONAL_ENDPOINTS_TOKEN and JWT_REFRESH_SECRET must be distinct",
    );
  });

  it("rejects overly long JWT lifetimes in production", async () => {
    await expect(
      loadConfigWithEnv({
        ...productionBaseEnv,
        JWT_EXPIRES_IN: "16m",
      }),
    ).rejects.toThrow("JWT_EXPIRES_IN must be 15m or shorter in production");

    await expect(
      loadConfigWithEnv({
        ...productionBaseEnv,
        JWT_REFRESH_EXPIRES_IN: "31d",
      }),
    ).rejects.toThrow(
      "JWT_REFRESH_EXPIRES_IN must be 30d or shorter in production",
    );
  });

  it("rejects zero or sub-minute token lifetimes", async () => {
    await expect(
      loadConfigWithEnv({
        NODE_ENV: "development",
        JWT_EXPIRES_IN: "0m",
      }),
    ).rejects.toThrow(/JWT_EXPIRES_IN/);

    await expect(
      loadConfigWithEnv({
        NODE_ENV: "development",
        JWT_REFRESH_EXPIRES_IN: "15m",
      }),
    ).rejects.toThrow(/JWT_REFRESH_EXPIRES_IN/);
  });

  it("rejects overly long auth nonce lifetimes in production", async () => {
    await expect(
      loadConfigWithEnv({
        ...productionBaseEnv,
        AUTH_NONCE_TTL_MS: "600001",
      }),
    ).rejects.toThrow("AUTH_NONCE_TTL_MS must be 10m or shorter in production");
  });

  it("rejects control characters in high-value secrets", async () => {
    await expect(
      loadConfigWithEnv({
        ...productionBaseEnv,
        JWT_SECRET: "production-jwt-secret-012345678901\n",
      }),
    ).rejects.toThrow("JWT_SECRET must not contain control characters");

    await expect(
      loadConfigWithEnv({
        ...productionBaseEnv,
        OPERATIONAL_ENDPOINTS_TOKEN: "production-ops-token-012345678901\t",
      }),
    ).rejects.toThrow(
      "OPERATIONAL_ENDPOINTS_TOKEN must not contain control characters",
    );
  });

  it("rejects wildcard CORS in production", async () => {
    await expect(
      loadConfigWithEnv({
        ...productionBaseEnv,
        CORS_ORIGINS: "*",
      }),
    ).rejects.toThrow(
      "Refusing to start with wildcard CORS origins in production",
    );
  });

  it("requires explicit CORS origins in production", async () => {
    await expect(
      loadConfigWithEnv({
        ...productionBaseEnv,
        CORS_ORIGINS: undefined,
      }),
    ).rejects.toThrow(
      "Refusing to start without explicit CORS_ORIGINS in production",
    );
  });

  it("rejects non-HTTPS CORS origins in production", async () => {
    await expect(
      loadConfigWithEnv({
        ...productionBaseEnv,
        CRUZIBLE_ALLOW_PLAINTEXT_HTTP: "false",
        RPC_URL: "https://rpc.cruzible.org",
        INDEXER_RPC_URL: "https://evm-rpc.cruzible.org",
        CORS_ORIGINS: "http://app.cruzible.org",
      }),
    ).rejects.toThrow(
      "Refusing to start with non-HTTPS CORS origins in production",
    );
  });

  it("allows an exact public HTTP origin only with the pre-TLS testnet opt-in", async () => {
    const { config } = await loadConfigWithEnv({
      ...productionBaseEnv,
      CRUZIBLE_NETWORK: "testnet",
      CRUZIBLE_ALLOW_PLAINTEXT_HTTP: "true",
      CORS_ORIGINS: "http://93.127.132.52:3005",
    });

    expect(config.network).toBe("testnet");
    expect(config.allowPlaintextHttp).toBe(true);
    expect(config.corsOrigins).toEqual(["http://93.127.132.52:3005"]);
  });

  it("forbids the plaintext CORS escape hatch on mainnet", async () => {
    await expect(
      loadConfigWithEnv({
        ...productionBaseEnv,
        CRUZIBLE_NETWORK: "mainnet",
        CRUZIBLE_ALLOW_PLAINTEXT_HTTP: "true",
        RPC_URL: "https://rpc.cruzible.org",
        INDEXER_RPC_URL: "https://evm-rpc.cruzible.org",
        STABLECOIN_BRIDGE_ADDRESS: "0x3333333333333333333333333333333333333333",
        CORS_ORIGINS: "http://93.127.132.52:3005",
      }),
    ).rejects.toThrow(
      "Refusing to allow plaintext HTTP CORS origins on mainnet",
    );
  });

  it("still rejects private HTTP origins with the pre-TLS opt-in", async () => {
    await expect(
      loadConfigWithEnv({
        ...productionBaseEnv,
        CRUZIBLE_NETWORK: "testnet",
        CRUZIBLE_ALLOW_PLAINTEXT_HTTP: "true",
        CORS_ORIGINS: "http://127.0.0.1:3005",
      }),
    ).rejects.toThrow(
      "Refusing to start with private or local CORS origins in production",
    );
  });

  it("rejects private or local CORS origins in production", async () => {
    await expect(
      loadConfigWithEnv({
        ...productionBaseEnv,
        CORS_ORIGINS: "https://127.0.0.1",
      }),
    ).rejects.toThrow(
      "Refusing to start with private or local CORS origins in production",
    );
  });

  it("rejects CORS origins with paths or query strings", async () => {
    await expect(
      loadConfigWithEnv({
        ...productionBaseEnv,
        CORS_ORIGINS: "https://app.cruzible.org/admin?preview=true",
      }),
    ).rejects.toThrow(/must be bare origins/);
  });

  it("rejects reserved test or documentation CORS origins in production", async () => {
    await expect(
      loadConfigWithEnv({
        ...productionBaseEnv,
        CORS_ORIGINS: "https://app.cruzible.test",
      }),
    ).rejects.toThrow(
      "Refusing to start with private or local CORS origins in production",
    );
  });

  it("rejects mock signature verification in production", async () => {
    await expect(
      loadConfigWithEnv({
        ...productionBaseEnv,
        ALLOW_MOCK_SIGNATURES: "true",
      }),
    ).rejects.toThrow(
      "Refusing to enable mock signature verification in production",
    );
  });

  it("rejects refresh token response-body exposure in production", async () => {
    await expect(
      loadConfigWithEnv({
        ...productionBaseEnv,
        AUTH_EXPOSE_REFRESH_TOKEN_IN_BODY: "true",
      }),
    ).rejects.toThrow(
      "Refusing to expose refresh tokens in response bodies in production",
    );
  });

  it("accepts explicit production-safe configuration", async () => {
    const { config } = await loadConfigWithEnv({
      ...productionBaseEnv,
      CORS_ORIGINS:
        "https://app.cruzible.org/,https://admin.cruzible.org,https://app.cruzible.org",
      TRUST_PROXY: "1",
    });

    expect(config.isProduction).toBe(true);
    expect(config.corsOrigins).toEqual([
      "https://app.cruzible.org",
      "https://admin.cruzible.org",
    ]);
    expect(config.databaseUrl).toBe(productionBaseEnv.DATABASE_URL);
    expect(config.redisUrl).toBe(productionBaseEnv.REDIS_URL);
    expect(config.authOperatorAddresses).toEqual(["aeth1operator"]);
    expect(config.trustProxy).toBe(1);
    expect(config.httpHeadersTimeoutMs).toBe(65_000);
    expect(config.httpRequestTimeoutMs).toBe(120_000);
    expect(config.httpKeepAliveTimeoutMs).toBe(5_000);
    expect(config.httpMaxRequestsPerSocket).toBe(1000);
    expect(config.publicExpensiveRateLimitWindowMs).toBe(60_000);
    expect(config.publicExpensiveRateLimitMax).toBe(30);
    expect(config.metricsEnabled).toBe(true);
    expect(config.apiDocsEnabled).toBe(false);
  });

  it("loads supported production secrets from mounted secret files", async () => {
    const databaseUrl = productionBaseEnv.DATABASE_URL;
    const redisUrl = productionBaseEnv.REDIS_URL;
    const jwtSecret = "file-backed-jwt-secret-012345678901";
    const jwtRefreshSecret = "file-backed-refresh-secret-0123456";
    const operationalToken = "file-backed-ops-token-012345678901";
    const alertWebhookUrl = "https://alerts.cruzible.org/hook";

    const { config } = await loadConfigWithEnv({
      ...productionBaseEnv,
      DATABASE_URL: undefined,
      REDIS_URL: undefined,
      JWT_SECRET: undefined,
      JWT_REFRESH_SECRET: undefined,
      OPERATIONAL_ENDPOINTS_TOKEN: undefined,
      ALERT_WEBHOOK_URL: undefined,
      DATABASE_URL_FILE: writeTempSecretFile(`${databaseUrl}\n`),
      REDIS_URL_FILE: writeTempSecretFile(`${redisUrl}\n`),
      JWT_SECRET_FILE: writeTempSecretFile(`${jwtSecret}\n`),
      JWT_REFRESH_SECRET_FILE: writeTempSecretFile(`${jwtRefreshSecret}\r\n`),
      OPERATIONAL_ENDPOINTS_TOKEN_FILE: writeTempSecretFile(
        `${operationalToken}\n`,
      ),
      ALERT_WEBHOOK_URL_FILE: writeTempSecretFile(`${alertWebhookUrl}\n`),
    });

    expect(config.databaseUrl).toBe(databaseUrl);
    expect(config.redisUrl).toBe(redisUrl);
    expect(config.jwtSecret).toBe(jwtSecret);
    expect(config.jwtRefreshSecret).toBe(jwtRefreshSecret);
    expect(config.jwtExpiresIn).toBe("15m");
    expect(config.jwtRefreshCookieMaxAgeMs).toBe(604_800_000);
    expect(config.authExposeRefreshTokenInBody).toBe(false);
    expect(config.operationalEndpointsToken).toBe(operationalToken);
    expect(config.alertWebhookUrl).toBe(alertWebhookUrl);
  });

  it("rejects ambiguous direct and file-backed secret configuration", async () => {
    await expect(
      loadConfigWithEnv({
        ...productionBaseEnv,
        JWT_SECRET_FILE: writeTempSecretFile(
          "file-backed-jwt-secret-012345678901",
        ),
      }),
    ).rejects.toThrow(
      "JWT_SECRET and JWT_SECRET_FILE are mutually exclusive; provide only one",
    );
  });

  it("rejects unreadable or empty secret files", async () => {
    await expect(
      loadConfigWithEnv({
        ...productionBaseEnv,
        JWT_SECRET: undefined,
        JWT_SECRET_FILE: "/path/that/does/not/exist",
      }),
    ).rejects.toThrow("Unable to read JWT_SECRET_FILE for JWT_SECRET");

    await expect(
      loadConfigWithEnv({
        ...productionBaseEnv,
        JWT_SECRET: undefined,
        JWT_SECRET_FILE: writeTempSecretFile("\n"),
      }),
    ).rejects.toThrow("JWT_SECRET_FILE for JWT_SECRET must not be empty");
  });

  it("rejects missing DATABASE_URL in production", async () => {
    await expect(
      loadConfigWithEnv({
        ...productionBaseEnv,
        DATABASE_URL: undefined,
      }),
    ).rejects.toThrow("Refusing to start without DATABASE_URL in production");
  });

  it("rejects unsupported database URL protocols", async () => {
    await expect(
      loadConfigWithEnv({
        NODE_ENV: "development",
        DATABASE_URL: "mysql://cruzible:secret@db.cruzible.org:3306/cruzible",
      }),
    ).rejects.toThrow("DATABASE_URL must use postgresql:// or postgres://");
  });

  it("rejects database URL fragments", async () => {
    await expect(
      loadConfigWithEnv({
        NODE_ENV: "development",
        DATABASE_URL:
          "postgresql://cruzible:secret@db.cruzible.org:5432/cruzible#token",
      }),
    ).rejects.toThrow("DATABASE_URL must not contain fragments");
  });

  it("rejects missing REDIS_URL in production", async () => {
    await expect(
      loadConfigWithEnv({
        ...productionBaseEnv,
        REDIS_URL: undefined,
      }),
    ).rejects.toThrow("Refusing to start without REDIS_URL in production");
  });

  it("rejects unsupported Redis URL protocols", async () => {
    await expect(
      loadConfigWithEnv({
        NODE_ENV: "development",
        REDIS_URL: "https://cache.cruzible.org",
      }),
    ).rejects.toThrow("REDIS_URL must use redis:// or rediss://");
  });

  it("rejects Redis URL fragments", async () => {
    await expect(
      loadConfigWithEnv({
        NODE_ENV: "development",
        REDIS_URL: "redis://127.0.0.1:6379#secret",
      }),
    ).rejects.toThrow("REDIS_URL must not contain fragments");
  });

  it("requires TLS Redis URLs in production", async () => {
    await expect(
      loadConfigWithEnv({
        ...productionBaseEnv,
        REDIS_URL: "redis://cache.cruzible.org:6379",
      }),
    ).rejects.toThrow("Refusing to start with non-TLS REDIS_URL in production");
  });

  it("rejects invalid alert webhook URLs", async () => {
    await expect(
      loadConfigWithEnv({
        ...productionBaseEnv,
        ALERT_WEBHOOK_URL: "not-a-url",
      }),
    ).rejects.toThrow(/ALERT_WEBHOOK_URL/);
  });

  it("rejects non-HTTPS alert webhooks in production", async () => {
    await expect(
      loadConfigWithEnv({
        ...productionBaseEnv,
        ALERT_WEBHOOK_URL: "http://alerts.cruzible.org/hook",
      }),
    ).rejects.toThrow(
      "Refusing to start with non-HTTPS ALERT_WEBHOOK_URL in production",
    );
  });

  it("rejects private or local alert webhooks in production", async () => {
    await expect(
      loadConfigWithEnv({
        ...productionBaseEnv,
        ALERT_WEBHOOK_URL: "https://10.0.0.5/hook",
      }),
    ).rejects.toThrow(
      "Refusing to start with private or local ALERT_WEBHOOK_URL in production",
    );
  });

  it("rejects reserved test or documentation alert webhooks in production", async () => {
    await expect(
      loadConfigWithEnv({
        ...productionBaseEnv,
        ALERT_WEBHOOK_URL: "https://alerts.cruzible.test/hook",
      }),
    ).rejects.toThrow(
      "Refusing to start with private or local ALERT_WEBHOOK_URL in production",
    );
  });

  it("rejects secret-bearing RPC and indexer URLs", async () => {
    await expect(
      loadConfigWithEnv({
        NODE_ENV: "development",
        RPC_URL: "https://user:pass@rpc.cruzible.test",
      }),
    ).rejects.toThrow("RPC_URL must not contain credentials or fragments");

    await expect(
      loadConfigWithEnv({
        NODE_ENV: "development",
        INDEXER_RPC_URL: "https://rpc.cruzible.test#provider-token",
      }),
    ).rejects.toThrow(
      "INDEXER_RPC_URL must not contain credentials or fragments",
    );

    await expect(
      loadConfigWithEnv({
        NODE_ENV: "development",
        INDEXER_WS_URL: "wss://user:pass@rpc.cruzible.test/ws",
      }),
    ).rejects.toThrow(
      "INDEXER_WS_URL must not contain credentials or fragments",
    );
  });

  it("rejects unsupported RPC and indexer URL protocols", async () => {
    await expect(
      loadConfigWithEnv({
        NODE_ENV: "development",
        RPC_URL: "ftp://rpc.cruzible.test",
      }),
    ).rejects.toThrow("RPC_URL must use http:// or https://");

    await expect(
      loadConfigWithEnv({
        NODE_ENV: "development",
        INDEXER_RPC_URL: "wss://rpc.cruzible.test/ws",
      }),
    ).rejects.toThrow("INDEXER_RPC_URL must use http:// or https://");

    await expect(
      loadConfigWithEnv({
        NODE_ENV: "development",
        INDEXER_WS_URL: "https://rpc.cruzible.test",
      }),
    ).rejects.toThrow("INDEXER_WS_URL must use ws:// or wss://");

    await expect(
      loadConfigWithEnv({
        NODE_ENV: "development",
        WS_URL: "https://rpc.cruzible.test",
      }),
    ).rejects.toThrow("WS_URL must use ws:// or wss://");
  });

  it("rejects alert webhook credentials and fragments", async () => {
    await expect(
      loadConfigWithEnv({
        ...productionBaseEnv,
        ALERT_WEBHOOK_URL: "https://user:pass@alerts.cruzible.org/hook#token",
      }),
    ).rejects.toThrow(
      "ALERT_WEBHOOK_URL must not contain credentials or fragments",
    );
  });

  it("treats blank optional URLs as unset", async () => {
    const { config } = await loadConfigWithEnv({
      NODE_ENV: "development",
      ALERT_WEBHOOK_URL: "",
      REDIS_URL: "",
      INDEXER_RPC_URL: "",
      INDEXER_WS_URL: "",
      WS_URL: "",
    });

    expect(config.alertWebhookUrl).toBeUndefined();
    expect(config.redisUrl).toBeUndefined();
    expect(config.indexerRpcUrl).toBe("http://127.0.0.1:8545");
    expect(config.indexerWsUrl).toBe("ws://127.0.0.1:8546");
  });

  it("normalizes and deduplicates configured auth role address lists", async () => {
    const { config } = await loadConfigWithEnv({
      ...productionBaseEnv,
      AUTH_ADMIN_ADDRESSES: " AETH1ADMIN , aeth1second, aeth1admin ",
      AUTH_OPERATOR_ADDRESSES: "aeth1operator, AETH1OPERATOR",
    });

    expect(config.authAdminAddresses).toEqual(["aeth1admin", "aeth1second"]);
    expect(config.authOperatorAddresses).toEqual(["aeth1operator"]);
  });

  it("rejects production startup without an operator-capable wallet", async () => {
    await expect(
      loadConfigWithEnv({
        ...productionBaseEnv,
        AUTH_ADMIN_ADDRESSES: "",
        AUTH_OPERATOR_ADDRESSES: "",
      }),
    ).rejects.toThrow(
      "Refusing to start production API without AUTH_OPERATOR_ADDRESSES or AUTH_ADMIN_ADDRESSES",
    );
  });

  it("does not require interactive auth roles for the production indexer runtime", async () => {
    const { config } = await loadConfigWithEnv({
      ...productionBaseEnv,
      CRUZIBLE_RUNTIME_ROLE: "indexer",
      AUTH_ADMIN_ADDRESSES: "",
      AUTH_OPERATOR_ADDRESSES: "",
      INDEXER_ENABLED: "true",
      INDEXER_RPC_URL: "http://127.0.0.1:8545",
      INDEXER_WS_URL: "ws://127.0.0.1:8546",
      INDEXER_EXPECTED_CHAIN_ID: "31337",
      CRUZIBLE_VAULT_ADDRESS: "0x1111111111111111111111111111111111111111",
      STAETHEL_ADDRESS: "0x2222222222222222222222222222222222222222",
    });

    expect(config.runtimeRole).toBe("indexer");
    expect(config.authAdminAddresses).toEqual([]);
    expect(config.authOperatorAddresses).toEqual([]);
  });

  it("requires an explicit EVM RPC for production API vault reconciliation", async () => {
    await expect(
      loadConfigWithEnv({
        ...productionBaseEnv,
        CRUZIBLE_VAULT_ADDRESS: "0x1111111111111111111111111111111111111111",
        INDEXER_RPC_URL: "",
      }),
    ).rejects.toThrow(
      "Refusing to start production API vault reconciliation without explicit INDEXER_RPC_URL",
    );

    const { config } = await loadConfigWithEnv({
      ...productionBaseEnv,
      CRUZIBLE_VAULT_ADDRESS: "0x1111111111111111111111111111111111111111",
      INDEXER_RPC_URL: "https://evm-rpc.cruzible.org",
    });
    expect(config.indexerRpcUrl).toBe("https://evm-rpc.cruzible.org");
  });

  it("rejects malformed auth role addresses", async () => {
    await expect(
      loadConfigWithEnv({
        ...productionBaseEnv,
        AUTH_OPERATOR_ADDRESSES: "not-an-address",
      }),
    ).rejects.toThrow(
      /AUTH_OPERATOR_ADDRESSES contains invalid wallet address/,
    );
  });

  it("rejects unbounded trust proxy mode in production", async () => {
    await expect(
      loadConfigWithEnv({
        ...productionBaseEnv,
        TRUST_PROXY: "true",
      }),
    ).rejects.toThrow(
      "Refusing to start with TRUST_PROXY=true in production; configure a hop count or explicit proxy subnet",
    );
  });

  it("accepts explicit trust proxy hop counts", async () => {
    const { config } = await loadConfigWithEnv({
      ...productionBaseEnv,
      TRUST_PROXY: "2",
    });

    expect(config.trustProxy).toBe(2);
  });

  it("validates HTTP timeout ordering", async () => {
    await expect(
      loadConfigWithEnv({
        ...productionBaseEnv,
        HTTP_HEADERS_TIMEOUT_MS: "120000",
        HTTP_REQUEST_TIMEOUT_MS: "120000",
      }),
    ).rejects.toThrow(
      "HTTP_HEADERS_TIMEOUT_MS must be lower than HTTP_REQUEST_TIMEOUT_MS",
    );

    await expect(
      loadConfigWithEnv({
        ...productionBaseEnv,
        HTTP_KEEP_ALIVE_TIMEOUT_MS: "65000",
        HTTP_HEADERS_TIMEOUT_MS: "65000",
      }),
    ).rejects.toThrow(
      "HTTP_KEEP_ALIVE_TIMEOUT_MS must be lower than HTTP_HEADERS_TIMEOUT_MS",
    );
  });

  it("parses explicit HTTP timeout controls", async () => {
    const { config } = await loadConfigWithEnv({
      NODE_ENV: "development",
      HTTP_HEADERS_TIMEOUT_MS: "30000",
      HTTP_REQUEST_TIMEOUT_MS: "90000",
      HTTP_KEEP_ALIVE_TIMEOUT_MS: "4000",
      HTTP_MAX_REQUESTS_PER_SOCKET: "250",
    });

    expect(config.httpHeadersTimeoutMs).toBe(30_000);
    expect(config.httpRequestTimeoutMs).toBe(90_000);
    expect(config.httpKeepAliveTimeoutMs).toBe(4_000);
    expect(config.httpMaxRequestsPerSocket).toBe(250);
  });

  it("rejects non-decimal numeric environment values", async () => {
    await expect(
      loadConfigWithEnv({
        NODE_ENV: "development",
        RATE_LIMIT_MAX: "0x10",
      }),
    ).rejects.toThrow(/RATE_LIMIT_MAX/);

    await expect(
      loadConfigWithEnv({
        NODE_ENV: "development",
        PORT: "1e3",
      }),
    ).rejects.toThrow(/PORT/);
  });

  it("treats blank numeric environment values as unset defaults", async () => {
    const { config } = await loadConfigWithEnv({
      NODE_ENV: "development",
      RATE_LIMIT_MAX: "",
      RECONCILIATION_RATE_WARN_PCT: "",
      RECONCILIATION_RATE_CRIT_PCT: "",
      RECONCILIATION_TVL_DRIFT_PCT: "",
    });

    expect(config.rateLimitMax).toBe(120);
    expect(config.reconciliationRateWarnThreshold).toBe(0.01);
    expect(config.reconciliationRateCriticalThreshold).toBe(0.05);
    expect(config.reconciliationTvlDriftThreshold).toBe(0.02);
  });

  it("parses operational endpoint controls", async () => {
    const { config } = await loadConfigWithEnv({
      NODE_ENV: "development",
      METRICS_ENABLED: "false",
      API_DOCS_ENABLED: "true",
      OPERATIONAL_ENDPOINTS_TOKEN: "12345678901234567890123456789012",
      ALLOW_UNAUTHENTICATED_OPERATIONAL_ENDPOINTS: "false",
    });

    expect(config.metricsEnabled).toBe(false);
    expect(config.apiDocsEnabled).toBe(true);
    expect(config.operationalEndpointsToken).toBe(
      "12345678901234567890123456789012",
    );
    expect(config.allowUnauthenticatedOperationalEndpoints).toBe(false);
  });

  it("rejects unauthenticated operational endpoint bypasses in production", async () => {
    await expect(
      loadConfigWithEnv({
        ...productionBaseEnv,
        ALLOW_UNAUTHENTICATED_OPERATIONAL_ENDPOINTS: "true",
      }),
    ).rejects.toThrow(
      "ALLOW_UNAUTHENTICATED_OPERATIONAL_ENDPOINTS cannot be enabled in production",
    );
  });

  it("rejects short operational endpoint tokens", async () => {
    await expect(
      loadConfigWithEnv({
        NODE_ENV: "development",
        OPERATIONAL_ENDPOINTS_TOKEN: "too-short",
      }),
    ).rejects.toThrow(/OPERATIONAL_ENDPOINTS_TOKEN/);
  });

  it("rejects invalid reconciliation threshold ordering", async () => {
    await expect(
      loadConfigWithEnv({
        ...productionBaseEnv,
        RECONCILIATION_RATE_WARN_PCT: "0.10",
        RECONCILIATION_RATE_CRIT_PCT: "0.05",
      }),
    ).rejects.toThrow(
      "RECONCILIATION_RATE_CRIT_PCT must be greater than RECONCILIATION_RATE_WARN_PCT",
    );
  });

  it("rejects production indexer startup without contract addresses", async () => {
    await expect(
      loadConfigWithEnv({
        ...productionBaseEnv,
        CRUZIBLE_RUNTIME_ROLE: "indexer",
        INDEXER_ENABLED: "true",
        INDEXER_RPC_URL: "http://127.0.0.1:8545",
        INDEXER_WS_URL: "ws://127.0.0.1:8546",
        INDEXER_EXPECTED_CHAIN_ID: "31337",
        CRUZIBLE_VAULT_ADDRESS: undefined,
        STAETHEL_ADDRESS: undefined,
      }),
    ).rejects.toThrow(
      "Refusing to start production indexer without CRUZIBLE_VAULT_ADDRESS",
    );
  });

  it("rejects production indexer startup without expected chain id", async () => {
    await expect(
      loadConfigWithEnv({
        ...productionBaseEnv,
        CRUZIBLE_RUNTIME_ROLE: "indexer",
        INDEXER_ENABLED: "true",
        INDEXER_RPC_URL: "http://127.0.0.1:8545",
        INDEXER_WS_URL: "ws://127.0.0.1:8546",
        INDEXER_EXPECTED_CHAIN_ID: undefined,
      }),
    ).rejects.toThrow(
      "Refusing to start production indexer without INDEXER_EXPECTED_CHAIN_ID",
    );
  });

  it("requires explicit wallet-login network domain separation in production", async () => {
    await expect(
      loadConfigWithEnv({
        ...productionBaseEnv,
        CRUZIBLE_NETWORK: undefined,
      }),
    ).rejects.toThrow(
      "Refusing to start any production runtime without CRUZIBLE_NETWORK",
    );

    await expect(
      loadConfigWithEnv({
        ...productionBaseEnv,
        INDEXER_EXPECTED_CHAIN_ID: undefined,
      }),
    ).rejects.toThrow(
      "Refusing to start production API without INDEXER_EXPECTED_CHAIN_ID for wallet-login domain separation",
    );

    await expect(
      loadConfigWithEnv({
        ...productionBaseEnv,
        INDEXER_EXPECTED_GENESIS_HASH: undefined,
      }),
    ).rejects.toThrow(
      "Refusing to start production API without INDEXER_EXPECTED_GENESIS_HASH for wallet-login domain separation",
    );
  });

  it("requires CRUZIBLE_NETWORK for the production indexer runtime too", async () => {
    await expect(
      loadConfigWithEnv({
        ...productionBaseEnv,
        CRUZIBLE_RUNTIME_ROLE: "indexer",
        AUTH_OPERATOR_ADDRESSES: "",
        CRUZIBLE_NETWORK: undefined,
        INDEXER_ENABLED: "true",
        INDEXER_WS_URL: "ws://127.0.0.1:8546",
      }),
    ).rejects.toThrow(
      "Refusing to start any production runtime without CRUZIBLE_NETWORK",
    );
  });

  it("requires explicit plaintext opt-in for production testnet API RPC", async () => {
    await expect(
      loadConfigWithEnv({
        ...productionBaseEnv,
        CRUZIBLE_ALLOW_PLAINTEXT_HTTP: "false",
      }),
    ).rejects.toThrow(
      "RPC_URL plaintext transport requires CRUZIBLE_ALLOW_PLAINTEXT_HTTP=true",
    );
  });

  it("requires HTTPS for production mainnet API RPC", async () => {
    await expect(
      loadConfigWithEnv({
        ...productionBaseEnv,
        CRUZIBLE_NETWORK: "mainnet",
        STABLECOIN_BRIDGE_ADDRESS: "0x3333333333333333333333333333333333333333",
      }),
    ).rejects.toThrow("RPC_URL must use https:// on production mainnet");
  });

  it("requires WSS for the production mainnet indexer", async () => {
    await expect(
      loadConfigWithEnv({
        ...productionBaseEnv,
        CRUZIBLE_RUNTIME_ROLE: "indexer",
        AUTH_OPERATOR_ADDRESSES: "",
        CRUZIBLE_NETWORK: "mainnet",
        RPC_URL: "https://rpc.cruzible.org",
        INDEXER_RPC_URL: "https://evm-rpc.cruzible.org",
        INDEXER_WS_URL: "ws://evm-rpc.cruzible.org/ws",
        STABLECOIN_BRIDGE_ADDRESS: "0x3333333333333333333333333333333333333333",
        INDEXER_ENABLED: "true",
      }),
    ).rejects.toThrow("INDEXER_WS_URL must use wss:// on production mainnet");
  });

  it("requires identical indexed-source identity inputs for production API cursor reads", async () => {
    await expect(
      loadConfigWithEnv({
        ...productionBaseEnv,
        STAETHEL_ADDRESS: undefined,
      }),
    ).rejects.toThrow(
      "Refusing to start production API without STAETHEL_ADDRESS for indexer identity",
    );

    await expect(
      loadConfigWithEnv({
        ...productionBaseEnv,
        CRUZIBLE_NETWORK: "mainnet",
        RPC_URL: "https://rpc.cruzible.org",
        INDEXER_RPC_URL: "https://evm-rpc.cruzible.org",
        STABLECOIN_BRIDGE_ADDRESS: undefined,
      }),
    ).rejects.toThrow(
      "Refusing to start production API without STABLECOIN_BRIDGE_ADDRESS for the mainnet indexer identity",
    );
  });

  it("derives the same cursor key for API and indexer runtime profiles", async () => {
    const apiModule = await loadConfigWithEnv({
      ...productionBaseEnv,
      CRUZIBLE_RUNTIME_ROLE: "api",
    });
    const apiConfig = apiModule.config;
    const { buildIndexerNetworkKeys } =
      await import("../src/lib/indexerNetworkIdentity");
    const apiKey = buildIndexerNetworkKeys({
      chainId: apiConfig.indexerExpectedChainId!,
      anchorHash: apiConfig.indexerExpectedGenesisHash!,
      vaultAddress: apiConfig.cruzibleVaultAddress,
      staethelAddress: apiConfig.staethelAddress,
      stablecoinBridgeAddress: apiConfig.stablecoinBridgeAddress,
    }).cursorKey;

    const indexerModule = await loadConfigWithEnv({
      ...productionBaseEnv,
      CRUZIBLE_RUNTIME_ROLE: "indexer",
      AUTH_OPERATOR_ADDRESSES: "",
      INDEXER_ENABLED: "true",
      INDEXER_WS_URL: "ws://127.0.0.1:8546",
    });
    const indexerConfig = indexerModule.config;
    const indexerKey = buildIndexerNetworkKeys({
      chainId: indexerConfig.indexerExpectedChainId!,
      anchorHash: indexerConfig.indexerExpectedGenesisHash!,
      vaultAddress: indexerConfig.cruzibleVaultAddress,
      staethelAddress: indexerConfig.staethelAddress,
      stablecoinBridgeAddress: indexerConfig.stablecoinBridgeAddress,
    }).cursorKey;

    expect(indexerKey).toBe(apiKey);
  });

  it("rejects invalid production indexer expected chain ids", async () => {
    await expect(
      loadConfigWithEnv({
        ...productionBaseEnv,
        INDEXER_ENABLED: "true",
        INDEXER_RPC_URL: "http://127.0.0.1:8545",
        INDEXER_WS_URL: "ws://127.0.0.1:8546",
        INDEXER_EXPECTED_CHAIN_ID: "0",
      }),
    ).rejects.toThrow(/INDEXER_EXPECTED_CHAIN_ID/);
  });

  it("accepts production indexer configuration with non-zero contract addresses", async () => {
    const { config } = await loadConfigWithEnv({
      ...productionBaseEnv,
      INDEXER_ENABLED: "true",
      INDEXER_RPC_URL: "http://127.0.0.1:8545",
      INDEXER_WS_URL: "ws://127.0.0.1:8546",
      INDEXER_EXPECTED_CHAIN_ID: "31337",
      CRUZIBLE_VAULT_ADDRESS: "0x1111111111111111111111111111111111111111",
      STAETHEL_ADDRESS: "0x2222222222222222222222222222222222222222",
      STABLECOIN_BRIDGE_ADDRESS: "0x3333333333333333333333333333333333333333",
    });

    expect(config.indexerEnabled).toBe(true);
    expect(config.cruzibleVaultAddress).toBe(
      "0x1111111111111111111111111111111111111111",
    );
    expect(config.stablecoinBridgeAddress).toBe(
      "0x3333333333333333333333333333333333333333",
    );
    expect(config.indexerExpectedChainId).toBe("31337");
  });

  it("accepts the production public-testnet indexer without an undeployed bridge", async () => {
    const { config } = await loadConfigWithEnv({
      ...productionBaseEnv,
      CRUZIBLE_RUNTIME_ROLE: "indexer",
      AUTH_OPERATOR_ADDRESSES: "",
      INDEXER_ENABLED: "true",
      INDEXER_RPC_URL: "http://127.0.0.1:8545",
      INDEXER_WS_URL: "ws://127.0.0.1:8546",
      INDEXER_EXPECTED_CHAIN_ID: "31337",
      CRUZIBLE_VAULT_ADDRESS: "0x1111111111111111111111111111111111111111",
      STAETHEL_ADDRESS: "0x2222222222222222222222222222222222222222",
      STABLECOIN_BRIDGE_ADDRESS: "",
      INDEXER_REQUIRE_STABLECOIN_BRIDGE: "false",
    });

    expect(config.stablecoinBridgeAddress).toBe("");
    expect(config.indexerRequireStablecoinBridge).toBe(false);
  });

  it("requires the bridge address for the all-periphery indexer profile", async () => {
    await expect(
      loadConfigWithEnv({
        ...productionBaseEnv,
        CRUZIBLE_RUNTIME_ROLE: "indexer",
        AUTH_OPERATOR_ADDRESSES: "",
        INDEXER_ENABLED: "true",
        INDEXER_RPC_URL: "http://127.0.0.1:8545",
        INDEXER_WS_URL: "ws://127.0.0.1:8546",
        INDEXER_EXPECTED_CHAIN_ID: "31337",
        CRUZIBLE_VAULT_ADDRESS: "0x1111111111111111111111111111111111111111",
        STAETHEL_ADDRESS: "0x2222222222222222222222222222222222222222",
        STABLECOIN_BRIDGE_ADDRESS: "",
        INDEXER_REQUIRE_STABLECOIN_BRIDGE: "true",
      }),
    ).rejects.toThrow(
      "Refusing to start production indexer without STABLECOIN_BRIDGE_ADDRESS for the all-periphery/mainnet profile",
    );
  });
});
