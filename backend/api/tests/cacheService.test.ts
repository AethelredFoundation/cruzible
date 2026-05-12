import "reflect-metadata";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const originalEnv = { ...process.env };

type RedisMock = {
  connect: ReturnType<typeof vi.fn>;
  del: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
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
      RPC_URL: "http://127.0.0.1:26657",
      DATABASE_URL: "postgresql://cruzible:cruzible@127.0.0.1:5432/cruzible",
      REDIS_URL: "redis://127.0.0.1:6379",
      CORS_ORIGINS: "https://app.cruzible.org",
      JWT_SECRET: "production-jwt-secret-012345678901",
      JWT_REFRESH_SECRET: "production-refresh-secret-012345678",
      ALLOW_MOCK_SIGNATURES: "false",
      AUTH_OPERATOR_ADDRESSES: "aeth1operator",
      INDEXER_ENABLED: "false",
    };

    const { CacheService } = await import("../src/services/CacheService");
    const service = new CacheService();

    await expect(service.connect()).rejects.toThrow(
      "Redis cache connection failed",
    );
  });
});
