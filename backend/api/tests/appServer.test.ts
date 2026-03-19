import "reflect-metadata";
import { container } from "tsyringe";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mocks — hoisted by vitest before any imports
// ---------------------------------------------------------------------------

vi.mock("@prisma/client", () => ({
  PrismaClient: vi.fn().mockImplementation(() => ({
    $queryRaw: vi.fn().mockResolvedValue([1]),
    vaultState: { findFirst: vi.fn().mockResolvedValue(null) },
  })),
}));

vi.mock("../src/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ApiGateway lifecycle (server.ts)", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    container.clearInstances();
    (container as unknown as { reset?: () => void }).reset?.();
    vi.clearAllMocks();
    vi.resetModules();
  });

  /**
   * Register mock instances for EVERY service that route modules resolve
   * at module scope via container.resolve().  This includes both the core
   * services (BlockchainService, CacheService, etc.) AND the route-level
   * services (JobsService, ReconciliationService, AlertService) that are
   * resolved when the v1 router is imported.
   */
  async function registerMockServices() {
    // Core services used by start() / shutdown()
    const { BlockchainService } =
      await import("../src/services/BlockchainService");
    const { CacheService } = await import("../src/services/CacheService");
    const { ReconciliationScheduler } =
      await import("../src/services/ReconciliationScheduler");
    const { IndexerService } = await import("../src/services/IndexerService");

    // Route-level services resolved at module scope in v1 routes
    const { JobsService } = await import("../src/services/JobsService");
    const { ReconciliationService } =
      await import("../src/services/ReconciliationService");
    const { AlertService } = await import("../src/services/AlertService");
    const { StablecoinBridgeService } =
      await import("../src/services/StablecoinBridgeService");

    container.registerInstance(BlockchainService, {
      initialize: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
      getLatestHeight: vi.fn().mockResolvedValue(100),
      getValidators: vi.fn().mockResolvedValue({ data: [] }),
      getBlocks: vi.fn().mockResolvedValue({ data: [], total: 0 }),
      getBlock: vi.fn().mockResolvedValue(null),
      getTransactions: vi.fn().mockResolvedValue({ data: [], total: 0 }),
    } as any);

    container.registerInstance(CacheService, {
      connect: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
      set: vi.fn().mockResolvedValue(undefined),
      get: vi.fn().mockReturnValue(null),
    } as any);

    container.registerInstance(ReconciliationScheduler, {
      start: vi.fn(),
      stop: vi.fn(),
      getLatestResult: vi.fn().mockReturnValue(null),
    } as any);

    container.registerInstance(IndexerService, {
      initialize: vi.fn().mockResolvedValue(undefined),
      shutdown: vi.fn().mockResolvedValue(undefined),
      getMetrics: vi.fn().mockReturnValue({ lag: 0 }),
    } as any);

    container.registerInstance(JobsService, {
      getJobs: vi.fn().mockResolvedValue({ data: [], total: 0 }),
      getJob: vi.fn().mockResolvedValue(null),
      submitJob: vi.fn().mockResolvedValue(null),
    } as any);

    container.registerInstance(ReconciliationService, {
      getLatestResult: vi.fn().mockReturnValue(null),
      getHistory: vi.fn().mockReturnValue([]),
    } as any);

    container.registerInstance(AlertService, {
      getActiveCriticalCount: vi.fn().mockReturnValue(0),
      sendAlert: vi.fn().mockResolvedValue(undefined),
      getHistory: vi.fn().mockReturnValue([]),
    } as any);

    container.registerInstance(StablecoinBridgeService, {
      getConfigs: vi.fn().mockResolvedValue([]),
      getConfig: vi.fn().mockResolvedValue(null),
      getBridgeHistory: vi
        .fn()
        .mockResolvedValue({
          data: [],
          pagination: { total: 0, limit: 50, offset: 0 },
        }),
      getStatus: vi.fn().mockResolvedValue(null),
    } as any);
  }

  // -----------------------------------------------------------------------
  // Startup
  // -----------------------------------------------------------------------

  it("createAppServer() returns an ApiGateway without side effects", async () => {
    await registerMockServices();
    const { createAppServer } = await import("../src/server");

    const api = createAppServer();

    // The server object exists but is NOT listening
    expect(api).toBeDefined();
    expect(api.app).toBeDefined();
    expect(api.httpServer).toBeDefined();
    expect(api.httpServer.listening).toBe(false);
  });

  it("start() binds to a port, wires up the scheduler, and health responds", async () => {
    await registerMockServices();
    const { createAppServer } = await import("../src/server");

    const api = createAppServer();

    // Override config.port to 0 so the OS picks a random free port
    const { config } = await import("../src/config");
    const originalPort = config.port;
    (config as any).port = 0;

    try {
      await api.start();

      expect(api.httpServer.listening).toBe(true);

      const address = api.httpServer.address();
      expect(address).not.toBeNull();

      const port =
        typeof address === "object" && address !== null ? address.port : 0;
      expect(port).toBeGreaterThan(0);

      // Verify that start() wired up the reconciliation scheduler
      const { ReconciliationScheduler } =
        await import("../src/services/ReconciliationScheduler");
      const scheduler = container.resolve(ReconciliationScheduler);
      expect(scheduler.start).toHaveBeenCalledTimes(1);

      // Health endpoint should respond
      const res = await fetch(`http://127.0.0.1:${port}/health`);
      expect(res.status).toBe(200);
    } finally {
      await api.shutdown();
      (config as any).port = originalPort;
    }
  });

  // -----------------------------------------------------------------------
  // Shutdown
  // -----------------------------------------------------------------------

  it("shutdown() closes the HTTP server and stops services", async () => {
    await registerMockServices();
    const { createAppServer } = await import("../src/server");
    const { config } = await import("../src/config");
    const originalPort = config.port;
    (config as any).port = 0;

    const api = createAppServer();
    await api.start();
    expect(api.httpServer.listening).toBe(true);

    await api.shutdown();
    expect(api.httpServer.listening).toBe(false);

    // Services should have been torn down
    const { ReconciliationScheduler } =
      await import("../src/services/ReconciliationScheduler");
    const scheduler = container.resolve(ReconciliationScheduler);
    expect(scheduler.stop).toHaveBeenCalled();

    (config as any).port = originalPort;
  });

  it("shutdown() is idempotent — calling twice is a no-op", async () => {
    await registerMockServices();
    const { createAppServer } = await import("../src/server");
    const { config } = await import("../src/config");
    const originalPort = config.port;
    (config as any).port = 0;

    const api = createAppServer();
    await api.start();

    await api.shutdown();
    // Second call should not throw
    await api.shutdown();
    expect(api.httpServer.listening).toBe(false);

    (config as any).port = originalPort;
  });
});
