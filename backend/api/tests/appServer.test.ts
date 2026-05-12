import "reflect-metadata";
import { container } from "tsyringe";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { withHttpServer } from "./helpers/http";

// ---------------------------------------------------------------------------
// Mocks — hoisted by vitest before any imports
// ---------------------------------------------------------------------------

vi.mock("@prisma/client", () => {
  const MockPrismaClient = vi.fn().mockImplementation(function () {
    return {
      $queryRaw: vi.fn().mockResolvedValue([1]),
      vaultState: { findFirst: vi.fn().mockResolvedValue(null) },
    };
  });
  return { PrismaClient: MockPrismaClient };
});

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
      getBridgeHistory: vi.fn().mockResolvedValue({
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
  }, 10_000);

  it("configures explicit HTTP timeout and socket-drain limits", async () => {
    await registerMockServices();
    const { createAppServer } = await import("../src/server");
    const { config } = await import("../src/config");

    const api = createAppServer();

    expect(api.httpServer.headersTimeout).toBe(config.httpHeadersTimeoutMs);
    expect(api.httpServer.requestTimeout).toBe(config.httpRequestTimeoutMs);
    expect(api.httpServer.timeout).toBe(config.httpRequestTimeoutMs);
    expect(api.httpServer.keepAliveTimeout).toBe(config.httpKeepAliveTimeoutMs);
    expect(api.httpServer.maxRequestsPerSocket).toBe(
      config.httpMaxRequestsPerSocket,
    );
  });

  it("refuses to expose production operational routes without a token", async () => {
    await registerMockServices();
    const { config } = await import("../src/config");
    const originalConfig = {
      isProduction: config.isProduction,
      metricsEnabled: config.metricsEnabled,
      apiDocsEnabled: config.apiDocsEnabled,
      operationalEndpointsToken: config.operationalEndpointsToken,
    };

    (config as any).isProduction = true;
    (config as any).metricsEnabled = true;
    (config as any).apiDocsEnabled = false;
    (config as any).operationalEndpointsToken = undefined;

    try {
      const { createAppServer } = await import("../src/server");

      expect(() => createAppServer()).toThrow(
        "Refusing to expose operational endpoints in production without OPERATIONAL_ENDPOINTS_TOKEN",
      );
    } finally {
      Object.assign(config as any, originalConfig);
    }
  });

  it("protects production metrics and docs with the operational token", async () => {
    await registerMockServices();
    const { config } = await import("../src/config");
    const originalConfig = {
      isProduction: config.isProduction,
      metricsEnabled: config.metricsEnabled,
      apiDocsEnabled: config.apiDocsEnabled,
      operationalEndpointsToken: config.operationalEndpointsToken,
    };
    const operationalToken = "12345678901234567890123456789012";

    (config as any).isProduction = true;
    (config as any).metricsEnabled = true;
    (config as any).apiDocsEnabled = true;
    (config as any).operationalEndpointsToken = operationalToken;

    try {
      const { createAppServer } = await import("../src/server");
      const api = createAppServer();

      await withHttpServer(api.app, async (baseUrl) => {
        const unauthorizedHealth = await fetch(`${baseUrl}/health`);
        const authorizedHealth = await fetch(`${baseUrl}/health`, {
          headers: { authorization: `Bearer ${operationalToken}` },
        });
        const publicLive = await fetch(`${baseUrl}/health/live`);
        const publicReady = await fetch(`${baseUrl}/health/ready`);
        const publicReadyBody = await publicReady.json();
        const unauthorizedMetrics = await fetch(`${baseUrl}/metrics`);
        const authorizedMetrics = await fetch(`${baseUrl}/metrics`, {
          headers: { authorization: `Bearer ${operationalToken}` },
        });
        const unauthorizedDocs = await fetch(`${baseUrl}/docs/`);
        const authorizedDocs = await fetch(`${baseUrl}/docs/`, {
          headers: { authorization: `Bearer ${operationalToken}` },
        });

        expect(unauthorizedHealth.status).toBe(401);
        expect(authorizedHealth.status).toBe(200);
        expect(publicLive.status).toBe(200);
        expect(publicReady.status).toBe(200);
        expect(publicReadyBody.ready).toBe(true);
        expect(publicReadyBody.checks).toBeUndefined();
        expect(unauthorizedMetrics.status).toBe(401);
        expect(authorizedMetrics.status).toBe(200);
        expect(authorizedMetrics.headers.get("content-type")).toContain(
          "text/plain",
        );
        expect(unauthorizedDocs.status).toBe(401);
        expect(authorizedDocs.status).toBe(200);
      });
    } finally {
      Object.assign(config as any, originalConfig);
    }
  });

  it("serves non-credentialed CORS preflights for browser API clients", async () => {
    await registerMockServices();
    const { config } = await import("../src/config");
    const originalConfig = {
      corsOrigins: config.corsOrigins,
    };

    (config as any).corsOrigins = ["https://app.example"];

    try {
      const { createAppServer } = await import("../src/server");
      const api = createAppServer();

      await withHttpServer(api.app, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/v1/jobs`, {
          method: "OPTIONS",
          headers: {
            Origin: "https://app.example",
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers":
              "Content-Type, Authorization, X-Request-ID, X-Operational-Token, X-Client-Name, X-Client-Version",
          },
        });

        const methods = response.headers.get("access-control-allow-methods");
        const headers = response.headers.get("access-control-allow-headers");

        expect(response.status).toBe(204);
        expect(response.headers.get("access-control-allow-origin")).toBe(
          "https://app.example",
        );
        expect(response.headers.get("access-control-allow-credentials")).toBe(
          "true",
        );
        expect(methods).toContain("GET");
        expect(methods).toContain("POST");
        expect(methods).toContain("OPTIONS");
        expect(methods).not.toContain("PUT");
        expect(methods).not.toContain("DELETE");
        expect(headers).not.toContain("X-Operational-Token");
        expect(headers).toContain("X-Client-Name");
        expect(headers).toContain("X-Client-Version");
      });
    } finally {
      Object.assign(config as any, originalConfig);
    }
  });

  it("rejects malformed JSON as a safe client error", async () => {
    await registerMockServices();
    const { createAppServer } = await import("../src/server");
    const api = createAppServer();

    await withHttpServer(api.app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/v1/jobs`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: '{"broken"',
      });
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body).toMatchObject({
        error: "BadRequest",
        message: "Malformed request body",
      });
      expect(body.requestId).toEqual(expect.any(String));
    });
  });

  it("rejects oversized JSON as a safe payload-too-large error", async () => {
    await registerMockServices();
    const { createAppServer } = await import("../src/server");
    const api = createAppServer();

    await withHttpServer(api.app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/v1/jobs`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ payload: "x".repeat(1_100_000) }),
      });
      const body = await response.json();

      expect(response.status).toBe(413);
      expect(body).toMatchObject({
        error: "PayloadTooLarge",
        message: "Request body exceeds the maximum allowed size",
      });
      expect(body.requestId).toEqual(expect.any(String));
    });
  });

  it("applies the global rate limit before parsing request bodies", async () => {
    await registerMockServices();
    const { config } = await import("../src/config");
    const originalConfig = {
      rateLimitWindowMs: config.rateLimitWindowMs,
      rateLimitMax: config.rateLimitMax,
    };

    (config as any).rateLimitWindowMs = 60_000;
    (config as any).rateLimitMax = 1;

    try {
      const { createAppServer } = await import("../src/server");
      const api = createAppServer();

      await withHttpServer(api.app, async (baseUrl) => {
        const first = await fetch(`${baseUrl}/v1/jobs`);
        const second = await fetch(`${baseUrl}/v1/jobs`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: '{"broken"',
        });
        const body = await second.json();

        expect(first.status).toBe(200);
        expect(second.status).toBe(429);
        expect(body).toMatchObject({
          error: "TooManyRequests",
          message: "Rate limit exceeded",
        });
      });
    } finally {
      Object.assign(config as any, originalConfig);
    }
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
