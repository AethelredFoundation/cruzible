import "reflect-metadata";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const originalEnv = { ...process.env };

type RedisMock = {
  connect: ReturnType<typeof vi.fn>;
  del: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
  eval: ReturnType<typeof vi.fn>;
  get: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
  ping: ReturnType<typeof vi.fn>;
  quit: ReturnType<typeof vi.fn>;
  set: ReturnType<typeof vi.fn>;
};

function installRedisMock(overrides: Partial<RedisMock> = {}) {
  const redisClient: RedisMock = {
    connect: vi.fn().mockResolvedValue(undefined),
    del: vi.fn().mockResolvedValue(1),
    disconnect: vi.fn(),
    eval: vi.fn().mockResolvedValue(1),
    get: vi.fn().mockResolvedValue(null),
    on: vi.fn(),
    ping: vi.fn().mockResolvedValue("PONG"),
    quit: vi.fn().mockResolvedValue("OK"),
    set: vi.fn().mockResolvedValue("OK"),
    ...overrides,
  };

  const RedisConstructor = vi.fn(function () {
    return redisClient;
  });

  vi.doMock("ioredis", () => ({
    default: RedisConstructor,
  }));

  return { RedisConstructor, redisClient };
}

beforeEach(() => {
  vi.resetModules();
  process.env = {
    ...originalEnv,
    NODE_ENV: "test",
  };
  delete process.env.REDIS_URL;
});

afterEach(() => {
  process.env = { ...originalEnv };
  vi.doUnmock("ioredis");
  vi.useRealTimers();
  vi.resetModules();
});

describe("CacheService", () => {
  function memoryCacheSize(service: unknown): number {
    return (service as { cache: Map<string, unknown> }).cache.size;
  }

  it("builds delimiter-safe keys for user-controlled public filters", async () => {
    const { buildCacheKey } = await import("../src/services/CacheService");

    const modelListKey = buildCacheKey(
      "models",
      "list",
      50,
      0,
      "all",
      "all",
      "owner:with:delimiters",
      "registered_at:desc",
    );
    const modelDetailKey = buildCacheKey(
      "models",
      "list:50:0:all:all:owner",
      "with",
      "delimiters:registered_at:desc",
    );

    expect(modelListKey).toBe(
      "models:list:50:0:all:all:owner%3Awith%3Adelimiters:registered_at%3Adesc",
    );
    expect(modelDetailKey).toBe(
      "models:list%3A50%3A0%3Aall%3Aall%3Aowner:with:delimiters%3Aregistered_at%3Adesc",
    );
    expect(modelListKey).not.toBe(modelDetailKey);
  });

  it("stores and expires values in the in-memory fallback", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-27T00:00:00.000Z"));

    const { CacheService } = await import("../src/services/CacheService");
    const service = new CacheService();

    await service.connect();
    await service.set("validators:top", { count: 4 }, 1);

    await expect(service.get("validators:top")).resolves.toEqual({ count: 4 });

    vi.advanceTimersByTime(1001);

    await expect(service.get("validators:top")).resolves.toBeNull();
  });

  it("uses Redis when REDIS_URL is configured", async () => {
    const { RedisConstructor, redisClient } = installRedisMock();
    process.env.REDIS_URL = "redis://127.0.0.1:6379";

    const { CacheService } = await import("../src/services/CacheService");
    const service = new CacheService();

    await service.connect();
    await service.set("reconciliation:live", { status: "GREEN" }, 15);

    expect(memoryCacheSize(service)).toBe(0);
    expect(RedisConstructor).toHaveBeenCalledWith(
      "redis://127.0.0.1:6379",
      expect.objectContaining({
        enableReadyCheck: true,
        lazyConnect: true,
        maxRetriesPerRequest: 2,
      }),
    );
    expect(redisClient.set).toHaveBeenCalledWith(
      "cruzible:api:reconciliation:live",
      JSON.stringify({ value: { status: "GREEN" } }),
      "EX",
      15,
    );

    redisClient.get.mockResolvedValue(
      JSON.stringify({ value: { status: "GREEN" } }),
    );

    await expect(service.get("reconciliation:live")).resolves.toEqual({
      status: "GREEN",
    });

    await service.disconnect();

    expect(redisClient.quit).toHaveBeenCalled();
  });

  it("uses owner-checked Redis leases for scheduler leadership", async () => {
    const { redisClient } = installRedisMock();
    process.env.REDIS_URL = "redis://127.0.0.1:6379";

    const { CacheService } = await import("../src/services/CacheService");
    const service = new CacheService();
    await service.connect();

    await expect(
      service.tryAcquireLease("reconciliation", "replica-a", 30_000),
    ).resolves.toBe(true);
    expect(redisClient.set).toHaveBeenCalledWith(
      "cruzible:api:lease:reconciliation",
      "replica-a",
      "PX",
      30_000,
      "NX",
    );

    await expect(
      service.renewLease("reconciliation", "replica-a", 30_000),
    ).resolves.toBe(true);
    redisClient.get.mockResolvedValue("replica-a");
    await expect(
      service.isLeaseOwner("reconciliation", "replica-a"),
    ).resolves.toBe(true);
    await expect(
      service.releaseLease("reconciliation", "replica-a"),
    ).resolves.toBe(true);
    expect(redisClient.eval).toHaveBeenCalledTimes(2);
  });

  it("publishes and claims side effects through atomic lease-fenced Redis scripts", async () => {
    const { redisClient } = installRedisMock();
    process.env.REDIS_URL = "redis://127.0.0.1:6379";
    const { CacheService } = await import("../src/services/CacheService");
    const service = new CacheService();
    await service.connect();

    await expect(
      service.publishWhileLeaseOwner(
        "leader",
        "replica-a",
        "result",
        { status: "OK" },
        600,
      ),
    ).resolves.toBe(true);
    await expect(
      service.claimLeaseAction("leader", "replica-a", "tick-1:alert-0", 600),
    ).resolves.toBe(true);

    expect(redisClient.eval).toHaveBeenCalledTimes(2);
    expect(redisClient.set).not.toHaveBeenCalled();
  });

  it("allows only one owner of an in-memory development lease", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-27T00:00:00.000Z"));
    const { CacheService } = await import("../src/services/CacheService");
    const service = new CacheService();

    await expect(
      service.tryAcquireLease("reconciliation", "replica-a", 30_000),
    ).resolves.toBe(true);
    await expect(
      service.tryAcquireLease("reconciliation", "replica-b", 30_000),
    ).resolves.toBe(false);
    await expect(
      service.renewLease("reconciliation", "replica-b", 30_000),
    ).resolves.toBe(false);
    await expect(
      service.isLeaseOwner("reconciliation", "replica-a"),
    ).resolves.toBe(true);
    await expect(
      service.releaseLease("reconciliation", "replica-b"),
    ).resolves.toBe(false);
    await expect(
      service.releaseLease("reconciliation", "replica-a"),
    ).resolves.toBe(true);
  });

  it("bounds high-cardinality in-memory fallback entries", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-27T00:00:00.000Z"));

    const { CacheService } = await import("../src/services/CacheService");
    const service = new CacheService();

    for (let index = 0; index < 1_050; index += 1) {
      await service.set(`public:list:${index}`, { index }, 60);
    }

    expect(memoryCacheSize(service)).toBe(1_000);
    await expect(service.get("public:list:0")).resolves.toBeNull();
    await expect(service.get("public:list:1049")).resolves.toEqual({
      index: 1049,
    });
  });

  it("uses bounded memory only when Redis writes fail", async () => {
    const { redisClient } = installRedisMock({
      set: vi.fn().mockRejectedValue(new Error("write failed")),
    });
    process.env.REDIS_URL = "redis://127.0.0.1:6379";

    const { CacheService } = await import("../src/services/CacheService");
    const service = new CacheService();

    await service.connect();
    await service.set("reconciliation:live", { status: "GREEN" }, 15);

    expect(redisClient.set).toHaveBeenCalled();
    expect(memoryCacheSize(service)).toBe(1);
    await expect(service.get("reconciliation:live")).resolves.toEqual({
      status: "GREEN",
    });
  });

  it("does not log Redis error messages that may contain connection secrets", async () => {
    const warnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);

    try {
      installRedisMock({
        set: vi
          .fn()
          .mockRejectedValue(
            new Error(
              "AUTH failed for redis://:super-secret-token@cache.internal:6379/0",
            ),
          ),
      });
      process.env.REDIS_URL = "redis://127.0.0.1:6379";

      const { CacheService } = await import("../src/services/CacheService");
      const service = new CacheService();

      await service.connect();
      await service.set("reconciliation:live", { status: "GREEN" }, 15);

      const renderedLogs = JSON.stringify(warnSpy.mock.calls);

      expect(renderedLogs).toContain("Redis cache write failed");
      expect(renderedLogs).toContain("errorName");
      expect(renderedLogs).not.toContain("super-secret-token");
      expect(renderedLogs).not.toContain("cache.internal");
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("falls back to memory when Redis is unavailable outside production", async () => {
    const { redisClient } = installRedisMock({
      connect: vi.fn().mockRejectedValue(new Error("connection refused")),
    });
    process.env.NODE_ENV = "development";
    process.env.REDIS_URL = "redis://127.0.0.1:6379";

    const { CacheService } = await import("../src/services/CacheService");
    const service = new CacheService();

    await expect(service.connect()).resolves.toBeUndefined();
    expect(redisClient.disconnect).toHaveBeenCalled();

    await service.set("blocks:latest", { height: 42 }, 30);
    await expect(service.get("blocks:latest")).resolves.toEqual({ height: 42 });
  });

  it("fails production startup when Redis cannot connect", async () => {
    installRedisMock({
      connect: vi.fn().mockRejectedValue(new Error("connection refused")),
    });
    process.env = {
      ...originalEnv,
      NODE_ENV: "production",
      RPC_URL: "https://rpc.cruzible.org",
      INDEXER_RPC_URL: "https://evm-rpc.cruzible.org",
      DATABASE_URL: "postgresql://cruzible:cruzible@127.0.0.1:5432/cruzible",
      REDIS_URL: "rediss://cache.cruzible.org:6379",
      CORS_ORIGINS: "https://app.cruzible.org",
      JWT_SECRET: "production-jwt-secret-012345678901",
      JWT_REFRESH_SECRET: "production-refresh-secret-012345678",
      LOG_HASH_SECRET: "production-log-hash-secret-0123456789",
      ALLOW_MOCK_SIGNATURES: "false",
      AUTH_OPERATOR_ADDRESSES: "aeth1operator",
      CRUZIBLE_NETWORK: "testnet",
      INDEXER_EXPECTED_CHAIN_ID: "7332",
      INDEXER_EXPECTED_GENESIS_HASH:
        "0xf4b43647f4d3255a7e9321ea4b32057101ed143623390bc30d59e69a91ceafa7",
      CRUZIBLE_VAULT_ADDRESS: "0x1111111111111111111111111111111111111111",
      STAETHEL_ADDRESS: "0x2222222222222222222222222222222222222222",
      INDEXER_ENABLED: "false",
    };

    const { CacheService } = await import("../src/services/CacheService");
    const service = new CacheService();

    await expect(service.connect()).rejects.toThrow(
      "Redis cache connection failed",
    );
  });
});
