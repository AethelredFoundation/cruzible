import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const originalEnv = { ...process.env };
const baseTime = new Date("2026-05-12T00:00:00.000Z");

const prismaMocks = vi.hoisted(() => ({
  authNonceCreate: vi.fn(),
  authNonceDeleteMany: vi.fn(),
  authRefreshSessionDeleteMany: vi.fn(),
  disconnect: vi.fn(),
}));

const loggerMocks = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));

vi.mock("@prisma/client", () => {
  const MockPrismaClient = vi.fn().mockImplementation(function () {
    return {
      authNonce: {
        create: prismaMocks.authNonceCreate,
        deleteMany: prismaMocks.authNonceDeleteMany,
      },
      authRefreshSession: {
        deleteMany: prismaMocks.authRefreshSessionDeleteMany,
      },
      $disconnect: prismaMocks.disconnect,
    };
  });

  return { PrismaClient: MockPrismaClient };
});

vi.mock("../src/utils/logger", () => ({
  logger: loggerMocks,
}));

describe("auth artifact cleanup", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(baseTime);
    process.env = {
      ...originalEnv,
      NODE_ENV: "test",
      DATABASE_URL: "postgresql://cruzible:cruzible@127.0.0.1:5432/cruzible",
    };
    delete process.env.DATABASE_URL_FILE;

    prismaMocks.authNonceCreate.mockResolvedValue({});
    prismaMocks.authNonceDeleteMany.mockResolvedValue({ count: 0 });
    prismaMocks.authRefreshSessionDeleteMany.mockResolvedValue({ count: 0 });
    prismaMocks.disconnect.mockResolvedValue(undefined);
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.useRealTimers();
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("removes expired or consumed database-backed auth artifacts", async () => {
    prismaMocks.authNonceDeleteMany.mockResolvedValueOnce({ count: 3 });
    prismaMocks.authRefreshSessionDeleteMany.mockResolvedValueOnce({
      count: 2,
    });
    const { cleanupExpiredAuthArtifacts } = await import("../src/auth/service");

    await cleanupExpiredAuthArtifacts();

    expect(prismaMocks.authNonceDeleteMany).toHaveBeenCalledWith({
      where: {
        OR: [{ expiresAt: { lte: baseTime } }, { consumedAt: { not: null } }],
      },
    });
    expect(prismaMocks.authRefreshSessionDeleteMany).toHaveBeenCalledWith({
      where: {
        expiresAt: { lte: baseTime },
      },
    });
    expect(loggerMocks.info).toHaveBeenCalledWith(
      "Expired auth artifacts cleaned up",
      {
        authNonceCount: 3,
        authRefreshSessionCount: 2,
      },
    );
  });

  it("throttles database cleanup attempts", async () => {
    const { cleanupExpiredAuthArtifacts } = await import("../src/auth/service");

    await cleanupExpiredAuthArtifacts();
    await cleanupExpiredAuthArtifacts();
    vi.setSystemTime(new Date(baseTime.getTime() + 59_999));
    await cleanupExpiredAuthArtifacts();

    expect(prismaMocks.authNonceDeleteMany).toHaveBeenCalledTimes(1);
    expect(prismaMocks.authRefreshSessionDeleteMany).toHaveBeenCalledTimes(1);

    vi.setSystemTime(new Date(baseTime.getTime() + 60_000));
    await cleanupExpiredAuthArtifacts();

    expect(prismaMocks.authNonceDeleteMany).toHaveBeenCalledTimes(2);
    expect(prismaMocks.authRefreshSessionDeleteMany).toHaveBeenCalledTimes(2);
  });

  it("logs cleanup failures without rejecting callers", async () => {
    const cleanupError = new Error("cleanup failed");
    prismaMocks.authNonceDeleteMany.mockRejectedValueOnce(cleanupError);
    const { cleanupExpiredAuthArtifacts } = await import("../src/auth/service");

    await expect(cleanupExpiredAuthArtifacts()).resolves.toBeUndefined();

    expect(loggerMocks.warn).toHaveBeenCalledWith(
      "Expired auth artifact cleanup failed",
      { error: cleanupError },
    );
  });

  it("disconnects database-backed auth state on shutdown", async () => {
    const { shutdownAuthState } = await import("../src/auth/service");

    await shutdownAuthState();
    await shutdownAuthState();

    expect(prismaMocks.disconnect).toHaveBeenCalledTimes(1);
  });

  it("schedules cleanup when issuing a new login challenge", async () => {
    const { createLoginChallenge } = await import("../src/auth/service");

    const challenge = await createLoginChallenge("AETH1OPERATOR");

    expect(challenge.address).toBe("aeth1operator");
    expect(prismaMocks.authNonceDeleteMany).toHaveBeenCalledTimes(1);
    expect(prismaMocks.authRefreshSessionDeleteMany).toHaveBeenCalledTimes(1);
    expect(prismaMocks.authNonceCreate).toHaveBeenCalledWith({
      data: {
        address: "aeth1operator",
        nonceHash: expect.any(String),
        message: challenge.message,
        expiresAt: new Date(baseTime.getTime() + 300_000),
      },
    });
  });
});
