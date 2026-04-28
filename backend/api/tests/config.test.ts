import { afterEach, describe, expect, it, vi } from "vitest";

const originalEnv = { ...process.env };
const CONFIG_ENV_KEYS = [
  "NODE_ENV",
  "PORT",
  "RPC_URL",
  "DATABASE_URL",
  "REDIS_URL",
  "CORS_ORIGINS",
  "JWT_SECRET",
  "JWT_REFRESH_SECRET",
  "JWT_EXPIRES_IN",
  "JWT_REFRESH_EXPIRES_IN",
  "TRUST_PROXY",
  "RATE_LIMIT_WINDOW_MS",
  "RATE_LIMIT_MAX",
  "ALLOW_MOCK_SIGNATURES",
  "AUTH_ADMIN_ADDRESSES",
  "AUTH_OPERATOR_ADDRESSES",
  "AUTH_NONCE_TTL_MS",
  "AUTH_RATE_LIMIT_WINDOW_MS",
  "AUTH_RATE_LIMIT_MAX",
  "OPS_RATE_LIMIT_WINDOW_MS",
  "OPS_RATE_LIMIT_MAX",
  "INDEXER_ENABLED",
  "INDEXER_RPC_URL",
  "INDEXER_WS_URL",
  "WS_URL",
  "INDEXER_START_BLOCK",
  "CRUZIBLE_VAULT_ADDRESS",
  "STAETHEL_ADDRESS",
  "STABLECOIN_BRIDGE_ADDRESS",
  "ALERT_WEBHOOK_URL",
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
  RPC_URL: "http://127.0.0.1:26657",
  DATABASE_URL: "postgresql://cruzible:cruzible@127.0.0.1:5432/cruzible",
  REDIS_URL: "redis://127.0.0.1:6379",
  CORS_ORIGINS: "https://app.cruzible.test",
  JWT_SECRET: "production-secret-123456",
  JWT_REFRESH_SECRET: "production-refresh-123456",
  ALLOW_MOCK_SIGNATURES: "false",
  AUTH_OPERATOR_ADDRESSES: "aeth1operator",
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

afterEach(() => {
  process.env = { ...originalEnv };
  vi.resetModules();
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

  it("accepts explicit production-safe configuration", async () => {
    const { config } = await loadConfigWithEnv({
      ...productionBaseEnv,
      CORS_ORIGINS: "https://app.cruzible.test,https://admin.cruzible.test",
      TRUST_PROXY: "1",
    });

    expect(config.isProduction).toBe(true);
    expect(config.corsOrigins).toEqual([
      "https://app.cruzible.test",
      "https://admin.cruzible.test",
    ]);
    expect(config.databaseUrl).toBe(productionBaseEnv.DATABASE_URL);
    expect(config.redisUrl).toBe(productionBaseEnv.REDIS_URL);
    expect(config.authOperatorAddresses).toEqual(["aeth1operator"]);
    expect(config.trustProxy).toBe(1);
  });

  it("rejects missing DATABASE_URL in production", async () => {
    await expect(
      loadConfigWithEnv({
        ...productionBaseEnv,
        DATABASE_URL: undefined,
      }),
    ).rejects.toThrow("Refusing to start without DATABASE_URL in production");
  });

  it("rejects missing REDIS_URL in production", async () => {
    await expect(
      loadConfigWithEnv({
        ...productionBaseEnv,
        REDIS_URL: undefined,
      }),
    ).rejects.toThrow("Refusing to start without REDIS_URL in production");
  });

  it("rejects invalid alert webhook URLs", async () => {
    await expect(
      loadConfigWithEnv({
        ...productionBaseEnv,
        ALERT_WEBHOOK_URL: "not-a-url",
      }),
    ).rejects.toThrow(/ALERT_WEBHOOK_URL/);
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
        INDEXER_ENABLED: "true",
        INDEXER_RPC_URL: "http://127.0.0.1:8545",
        INDEXER_WS_URL: "ws://127.0.0.1:8546",
      }),
    ).rejects.toThrow(
      "Refusing to start production indexer without CRUZIBLE_VAULT_ADDRESS",
    );
  });

  it("accepts production indexer configuration with non-zero contract addresses", async () => {
    const { config } = await loadConfigWithEnv({
      ...productionBaseEnv,
      INDEXER_ENABLED: "true",
      INDEXER_RPC_URL: "http://127.0.0.1:8545",
      INDEXER_WS_URL: "ws://127.0.0.1:8546",
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
  });
});
