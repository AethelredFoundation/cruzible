import "reflect-metadata";
import express from "express";
import { container } from "tsyringe";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { withHttpServer } from "./helpers/http";

const OPERATIONAL_TOKEN = "12345678901234567890123456789012";

// ---------------------------------------------------------------------------
// Mocks — hoisted by vitest before any imports
// ---------------------------------------------------------------------------

// Mock Prisma so the database health probe succeeds (tagged-template $queryRaw).
const prismaMocks = vi.hoisted(() => ({
  queryRaw: vi.fn(),
  disconnect: vi.fn(),
  indexerCursorFindUnique: vi.fn(),
}));

vi.mock("@prisma/client", () => {
  const MockPrismaClient = vi.fn().mockImplementation(function () {
    return {
      $queryRaw: prismaMocks.queryRaw,
      $disconnect: prismaMocks.disconnect,
      indexerCursor: { findUnique: prismaMocks.indexerCursorFindUnique },
    };
  });
  return { PrismaClient: MockPrismaClient };
});

// Suppress logger output in test runs.
vi.mock("../src/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("/health/ready readiness gating", () => {
  beforeEach(() => {
    vi.resetModules();
    prismaMocks.queryRaw.mockResolvedValue([1]);
    prismaMocks.disconnect.mockResolvedValue(undefined);
    prismaMocks.indexerCursorFindUnique.mockResolvedValue({
      blockNumber: 12343n,
      pendingBlockNumber: null,
      requiresRebuild: false,
      updatedAt: new Date(),
    });
  });

  afterEach(() => {
    container.clearInstances();
    (container as unknown as { reset?: () => void }).reset?.();
    // Use clearAllMocks (not restoreAllMocks) to preserve the mock
    // implementations installed by vi.mock() factories above.
    vi.clearAllMocks();
    vi.resetModules();
  });

  // -----------------------------------------------------------------------
  // Helpers — register mock service instances in the DI container so the
  // health route's `container.resolve(...)` calls return controlled values.
  // -----------------------------------------------------------------------

  /** Register a mock BlockchainService so the RPC probe returns healthy. */
  async function setupHealthyCore() {
    const { BlockchainService } =
      await import("../src/services/BlockchainService");
    container.registerInstance(BlockchainService, {
      getLatestHeight: vi.fn().mockResolvedValue(12345),
    } as any);
  }

  /** Register a mock BlockchainService that fails with a sensitive upstream detail. */
  async function setupFailingBlockchainRpc(message: string) {
    const { BlockchainService } =
      await import("../src/services/BlockchainService");
    container.registerInstance(BlockchainService, {
      getLatestHeight: vi.fn().mockRejectedValue(new Error(message)),
    } as any);
  }

  /** Force the health route down its production-only response path. */
  async function setProductionMode(enabled: boolean) {
    const { config } = await import("../src/config");
    (config as unknown as { isProduction: boolean }).isProduction = enabled;
    (
      config as unknown as { operationalEndpointsToken?: string }
    ).operationalEndpointsToken = enabled ? OPERATIONAL_TOKEN : undefined;
  }

  /** Register mock ReconciliationScheduler and AlertService. */
  async function registerReconciliation(
    status: string | null,
    criticalAlerts: number,
    timestamp = new Date().toISOString(),
  ) {
    const { ReconciliationScheduler } =
      await import("../src/services/ReconciliationScheduler");
    const { AlertService } = await import("../src/services/AlertService");

    const latestResult = status != null ? { status, timestamp } : null;

    container.registerInstance(ReconciliationScheduler, {
      getLatestResult: vi.fn().mockReturnValue(latestResult),
    } as any);

    container.registerInstance(AlertService, {
      getActiveCriticalCount: vi.fn().mockReturnValue(criticalAlerts),
    } as any);
  }

  /** Register mock IndexerService with a specific lag value. */
  async function registerIndexer(lag: number, requiresRebuild = false) {
    const { IndexerService } = await import("../src/services/IndexerService");
    container.registerInstance(IndexerService, {
      getMetrics: vi.fn().mockReturnValue({ lag, requiresRebuild }),
    } as any);
  }

  /** Register a broken IndexerService to model enabled-but-unavailable wiring. */
  async function registerUnavailableIndexer() {
    const { IndexerService } = await import("../src/services/IndexerService");
    container.registerInstance(IndexerService, null as any);
  }

  /** Register a broken scheduler to model unavailable reconciliation wiring. */
  async function registerUnavailableReconciliation() {
    const { ReconciliationScheduler } =
      await import("../src/services/ReconciliationScheduler");
    container.registerInstance(ReconciliationScheduler, null as any);
  }

  /** Import the health router from a fresh module graph and mount it. */
  async function mountRouter() {
    const { router } = await import("../src/routes/health");
    const app = express();
    app.use("/health", router);
    return app;
  }

  // -----------------------------------------------------------------------
  // Regression tests for P2 finding: readiness semantic coverage
  // -----------------------------------------------------------------------

  it("returns 200 when all systems are healthy (baseline)", async () => {
    await setupHealthyCore();
    await registerReconciliation("OK", 0);
    await registerIndexer(10);
    const app = await mountRouter();

    await withHttpServer(app, async (baseUrl) => {
      const res = await fetch(`${baseUrl}/health/ready`);
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.ready).toBe(true);
      expect(body.protocolStatus).toBe("healthy");
      expect(body.checks.reconciliation.ready).toBe(true);
    });
  });

  it("reads and validates the cursor for the configured network and vault namespace", async () => {
    await setupHealthyCore();
    await registerReconciliation("OK", 0);
    await registerIndexer(2);
    const { config } = await import("../src/config");
    const { buildIndexerNetworkKeys } =
      await import("../src/lib/indexerNetworkIdentity");
    const identity = {
      chainId: "7332",
      anchorHash: "0x" + "aa".repeat(32),
      vaultAddress: "0x1111111111111111111111111111111111111111",
    };
    Object.assign(config as object, {
      indexerExpectedChainId: identity.chainId,
      indexerExpectedGenesisHash: identity.anchorHash,
      cruzibleVaultAddress: identity.vaultAddress,
    });
    prismaMocks.indexerCursorFindUnique.mockResolvedValue({
      blockNumber: 12343n,
      pendingBlockNumber: null,
      requiresRebuild: false,
      networkChainId: identity.chainId,
      networkAnchorHash: identity.anchorHash,
      networkVaultAddress: identity.vaultAddress,
      networkStaethelAddress: "no-staethel",
      networkStablecoinBridgeAddress: "no-bridge",
      updatedAt: new Date(),
    });
    const app = await mountRouter();

    await withHttpServer(app, async (baseUrl) => {
      const res = await fetch(`${baseUrl}/health/ready`);
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.checks.indexer.networkIdentityValid).toBe(true);
      expect(prismaMocks.indexerCursorFindUnique).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            cursorKey: buildIndexerNetworkKeys(identity).cursorKey,
          },
        }),
      );
    });
  });

  it("returns 503 when a configured cursor is bound to another vault", async () => {
    await setupHealthyCore();
    await registerReconciliation("OK", 0);
    await registerIndexer(2);
    const { config } = await import("../src/config");
    const identity = {
      chainId: "7332",
      anchorHash: "0x" + "aa".repeat(32),
      vaultAddress: "0x1111111111111111111111111111111111111111",
    };
    Object.assign(config as object, {
      indexerExpectedChainId: identity.chainId,
      indexerExpectedGenesisHash: identity.anchorHash,
      cruzibleVaultAddress: identity.vaultAddress,
    });
    prismaMocks.indexerCursorFindUnique.mockResolvedValue({
      blockNumber: 12343n,
      pendingBlockNumber: null,
      requiresRebuild: false,
      networkChainId: identity.chainId,
      networkAnchorHash: identity.anchorHash,
      networkVaultAddress: "0x2222222222222222222222222222222222222222",
      networkStaethelAddress: "no-staethel",
      networkStablecoinBridgeAddress: "no-bridge",
      updatedAt: new Date(),
    });
    const app = await mountRouter();

    await withHttpServer(app, async (baseUrl) => {
      const res = await fetch(`${baseUrl}/health/ready`);
      const body = await res.json();

      expect(res.status).toBe(503);
      expect(body.ready).toBe(false);
      expect(body.protocolStatus).toBe("unavailable");
      expect(body.checks.indexer).toMatchObject({
        networkIdentityValid: false,
        ready: false,
      });
    });
  });

  it("returns 503 when the durable cursor is ahead of the RPC head", async () => {
    await setupHealthyCore();
    await registerReconciliation("OK", 0);
    await registerIndexer(0);
    prismaMocks.indexerCursorFindUnique.mockResolvedValue({
      blockNumber: 12346n,
      pendingBlockNumber: null,
      requiresRebuild: false,
      updatedAt: new Date(),
    });
    const app = await mountRouter();

    await withHttpServer(app, async (baseUrl) => {
      const res = await fetch(`${baseUrl}/health/ready`);
      const body = await res.json();

      expect(res.status).toBe(503);
      expect(body.protocolStatus).toBe("unavailable");
      expect(body.checks.indexer).toMatchObject({
        lag: 0,
        cursorAheadOfRpc: true,
        ready: false,
      });
    });
  });

  it("prevents public probe responses from being cached", async () => {
    await setupHealthyCore();
    await registerReconciliation("OK", 0);
    await registerIndexer(10);
    const app = await mountRouter();

    await withHttpServer(app, async (baseUrl) => {
      const liveRes = await fetch(`${baseUrl}/health/live`);
      const readyRes = await fetch(`${baseUrl}/health/ready`);

      expect(liveRes.status).toBe(200);
      expect(liveRes.headers.get("cache-control")).toBe("no-store");
      expect(readyRes.status).toBe(200);
      expect(readyRes.headers.get("cache-control")).toBe("no-store");
    });
  });

  it("returns 503 when the enabled indexer service is unavailable", async () => {
    await setupHealthyCore();
    await registerReconciliation("OK", 0);
    await registerUnavailableIndexer();
    const { config } = await import("../src/config");
    (
      config as unknown as { operationalEndpointsToken?: string }
    ).operationalEndpointsToken = OPERATIONAL_TOKEN;
    const app = await mountRouter();

    await withHttpServer(app, async (baseUrl) => {
      const readyRes = await fetch(`${baseUrl}/health/ready`);
      const readyBody = await readyRes.json();
      const fullHealthRes = await fetch(`${baseUrl}/health`, {
        headers: { "x-operational-token": OPERATIONAL_TOKEN },
      });
      const fullHealthBody = await fullHealthRes.json();

      expect(readyRes.status).toBe(503);
      expect(readyBody.ready).toBe(false);
      expect(readyBody.checks.indexer).toEqual({
        lag: null,
        pendingBlockNumber: null,
        requiresRebuild: false,
        networkIdentityValid: true,
        cursorAheadOfRpc: false,
        stale: false,
        ready: false,
      });
      expect(fullHealthRes.status).toBe(503);
      expect(fullHealthBody.status).toBe("unhealthy");
      expect(fullHealthBody.indexer).toEqual({
        ready: false,
        status: "UNAVAILABLE",
        lag: 2,
        pendingBlockNumber: null,
        requiresRebuild: false,
        networkIdentityValid: true,
        cursorAheadOfRpc: false,
        stale: false,
      });
    });
  });

  it("keeps the API ready while reporting unavailable reconciliation wiring", async () => {
    await setupHealthyCore();
    await registerIndexer(10);
    await registerUnavailableReconciliation();
    const app = await mountRouter();

    await withHttpServer(app, async (baseUrl) => {
      const res = await fetch(`${baseUrl}/health/ready`);
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.ready).toBe(true);
      expect(body.protocolStatus).toBe("unavailable");
      expect(body.checks.reconciliation.status).toBe("UNAVAILABLE");
      expect(body.checks.reconciliation.ready).toBe(false);
    });
  });

  it("disconnects the lazy health-check database client on shutdown", async () => {
    await setupHealthyCore();
    await registerReconciliation("OK", 0);
    await registerIndexer(10);
    const app = await mountRouter();
    const { shutdownHealthCheckResources } =
      await import("../src/routes/health");

    await withHttpServer(app, async (baseUrl) => {
      const res = await fetch(`${baseUrl}/health/ready`);
      expect(res.status).toBe(200);
    });

    await shutdownHealthCheckResources();
    await shutdownHealthCheckResources();

    expect(prismaMocks.disconnect).toHaveBeenCalledTimes(1);
  });

  it("redacts production probe failure details from readiness responses", async () => {
    await setProductionMode(true);
    await setupFailingBlockchainRpc(
      "dial tcp secret-rpc.internal:26657 refused",
    );
    await registerReconciliation("OK", 0);
    await registerIndexer(10);
    const app = await mountRouter();

    await withHttpServer(app, async (baseUrl) => {
      const res = await fetch(`${baseUrl}/health/ready`);
      const body = await res.json();
      const serializedBody = JSON.stringify(body);
      const fullHealthRes = await fetch(`${baseUrl}/health`);
      const fullHealthUnauthorizedBody = await fullHealthRes.json();
      const authorizedFullHealthRes = await fetch(`${baseUrl}/health`, {
        headers: { "x-operational-token": OPERATIONAL_TOKEN },
      });
      const authorizedFullHealthBody = await authorizedFullHealthRes.json();
      const serializedFullHealthBody = JSON.stringify(authorizedFullHealthBody);

      expect(res.status).toBe(503);
      expect(body.ready).toBe(false);
      expect(body.status).toBe("not_ready");
      expect(body.protocolStatus).toBe("unavailable");
      expect(body.checks).toBeUndefined();
      expect(serializedBody).not.toContain("secret-rpc.internal");
      expect(serializedBody).not.toContain("26657");

      expect(fullHealthRes.status).toBe(401);
      expect(fullHealthUnauthorizedBody.error).toBe("Unauthorized");
      expect(authorizedFullHealthRes.status).toBe(503);
      expect(authorizedFullHealthBody.checks.blockchainRpc.status).toBe(
        "error",
      );
      expect(authorizedFullHealthBody.checks.blockchainRpc.message).toBe(
        "Probe failed; see server logs for details.",
      );
      expect(serializedFullHealthBody).not.toContain("secret-rpc.internal");
      expect(serializedFullHealthBody).not.toContain("26657");
    });
  });

  it("keeps infrastructure ready while reporting CRITICAL protocol posture", async () => {
    await setupHealthyCore();
    await registerReconciliation("CRITICAL", 0);
    await registerIndexer(10);
    const app = await mountRouter();

    await withHttpServer(app, async (baseUrl) => {
      const res = await fetch(`${baseUrl}/health/ready`);
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.ready).toBe(true);
      expect(body.protocolStatus).toBe("degraded");
      expect(body.checks.reconciliation.status).toBe("CRITICAL");
      expect(body.checks.reconciliation.ready).toBe(false);
    });
  });

  it("reports protocol unavailable until the first reconciliation result exists", async () => {
    await setupHealthyCore();
    await registerReconciliation(null, 0);
    await registerIndexer(10);
    const app = await mountRouter();

    await withHttpServer(app, async (baseUrl) => {
      const res = await fetch(`${baseUrl}/health/ready`);
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.ready).toBe(true);
      expect(body.protocolStatus).toBe("unavailable");
      expect(body.checks.reconciliation.status).toBe("UNKNOWN");
      expect(body.checks.reconciliation.lastRun).toBeNull();
      expect(body.checks.reconciliation.ready).toBe(false);
    });
  });

  it("keeps infrastructure ready while reporting active critical alerts", async () => {
    await setupHealthyCore();
    await registerReconciliation("OK", 3);
    await registerIndexer(10);
    const app = await mountRouter();

    await withHttpServer(app, async (baseUrl) => {
      const res = await fetch(`${baseUrl}/health/ready`);
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.ready).toBe(true);
      expect(body.protocolStatus).toBe("degraded");
      expect(body.checks.reconciliation.activeCriticalAlerts).toBe(3);
      expect(body.checks.reconciliation.ready).toBe(false);
    });
  });

  it("returns 503 when indexer lag exceeds critical threshold (>500 blocks)", async () => {
    await setupHealthyCore();
    await registerReconciliation("OK", 0);
    await registerIndexer(600);
    const app = await mountRouter();

    await withHttpServer(app, async (baseUrl) => {
      const res = await fetch(`${baseUrl}/health/ready`);
      const body = await res.json();

      expect(res.status).toBe(503);
      expect(body.ready).toBe(false);
      expect(body.checks.indexer.lag).toBe(600);
      expect(body.checks.indexer.ready).toBe(false);
    });
  });

  it("returns 503 while indexer materialized projections require rebuilding", async () => {
    await setupHealthyCore();
    await registerReconciliation("OK", 0);
    await registerIndexer(10, true);
    const app = await mountRouter();

    await withHttpServer(app, async (baseUrl) => {
      const res = await fetch(`${baseUrl}/health/ready`);
      const body = await res.json();

      expect(res.status).toBe(503);
      expect(body.ready).toBe(false);
      expect(body.checks.indexer).toEqual({
        lag: 10,
        pendingBlockNumber: null,
        requiresRebuild: true,
        networkIdentityValid: true,
        cursorAheadOfRpc: false,
        stale: false,
        ready: false,
      });
    });
  });

  it("returns 503 while a projection generation is pending commit", async () => {
    await setupHealthyCore();
    await registerReconciliation("OK", 0);
    prismaMocks.indexerCursorFindUnique.mockResolvedValue({
      blockNumber: 12343n,
      pendingBlockNumber: 12344n,
      requiresRebuild: false,
      updatedAt: new Date(),
    });
    const { config } = await import("../src/config");
    (config as unknown as { indexerEnabled: boolean }).indexerEnabled = false;
    const app = await mountRouter();

    await withHttpServer(app, async (baseUrl) => {
      const res = await fetch(`${baseUrl}/health/ready`);
      const body = await res.json();

      expect(res.status).toBe(503);
      expect(body.checks.indexer).toEqual({
        lag: 2,
        pendingBlockNumber: 12344,
        requiresRebuild: false,
        networkIdentityValid: true,
        cursorAheadOfRpc: false,
        stale: false,
        ready: false,
      });
    });
  });

  it("returns 503 from the durable rebuild marker when the indexer runs in another process", async () => {
    await setupHealthyCore();
    await registerReconciliation("OK", 0);
    prismaMocks.indexerCursorFindUnique.mockResolvedValue({
      blockNumber: 12343n,
      requiresRebuild: true,
      updatedAt: new Date(),
    });
    const { config } = await import("../src/config");
    (config as unknown as { indexerEnabled: boolean }).indexerEnabled = false;
    const app = await mountRouter();

    await withHttpServer(app, async (baseUrl) => {
      const res = await fetch(`${baseUrl}/health/ready`);
      const body = await res.json();

      expect(res.status).toBe(503);
      expect(body.ready).toBe(false);
      expect(body.checks.indexer).toEqual({
        lag: 2,
        pendingBlockNumber: null,
        requiresRebuild: true,
        networkIdentityValid: true,
        cursorAheadOfRpc: false,
        stale: false,
        ready: false,
      });
    });
  });

  it("returns 503 for a stale no-progress cursor when the indexer runs separately", async () => {
    await setupHealthyCore();
    await registerReconciliation("OK", 0);
    prismaMocks.indexerCursorFindUnique.mockResolvedValue({
      blockNumber: 12340n,
      requiresRebuild: false,
      updatedAt: new Date(Date.now() - 120_000),
    });
    const { config } = await import("../src/config");
    (config as unknown as { indexerEnabled: boolean }).indexerEnabled = false;
    const app = await mountRouter();

    await withHttpServer(app, async (baseUrl) => {
      const res = await fetch(`${baseUrl}/health/ready`);
      const body = await res.json();

      expect(res.status).toBe(503);
      expect(body.ready).toBe(false);
      expect(body.checks.indexer).toEqual({
        lag: 5,
        pendingBlockNumber: null,
        requiresRebuild: false,
        networkIdentityValid: true,
        cursorAheadOfRpc: false,
        stale: true,
        ready: false,
      });
    });
  });

  it("returns 503 for critical durable cursor lag when the indexer runs separately", async () => {
    await setupHealthyCore();
    await registerReconciliation("OK", 0);
    prismaMocks.indexerCursorFindUnique.mockResolvedValue({
      blockNumber: 11700n,
      requiresRebuild: false,
      updatedAt: new Date(),
    });
    const { config } = await import("../src/config");
    (config as unknown as { indexerEnabled: boolean }).indexerEnabled = false;
    const app = await mountRouter();

    await withHttpServer(app, async (baseUrl) => {
      const res = await fetch(`${baseUrl}/health/ready`);
      const body = await res.json();

      expect(res.status).toBe(503);
      expect(body.ready).toBe(false);
      expect(body.checks.indexer).toEqual({
        lag: 645,
        pendingBlockNumber: null,
        requiresRebuild: false,
        networkIdentityValid: true,
        cursorAheadOfRpc: false,
        stale: false,
        ready: false,
      });
    });
  });

  it("returns 200 with a degraded protocol status for reconciliation WARNING", async () => {
    await setupHealthyCore();
    await registerReconciliation("WARNING", 0);
    await registerIndexer(10);
    const app = await mountRouter();

    await withHttpServer(app, async (baseUrl) => {
      const res = await fetch(`${baseUrl}/health/ready`);
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.ready).toBe(true);
      expect(body.protocolStatus).toBe("degraded");
      expect(body.checks.reconciliation.status).toBe("WARNING");
      expect(body.checks.reconciliation.ready).toBe(true);
    });
  });

  it("keeps infrastructure ready but rejects a stale protocol result", async () => {
    await setupHealthyCore();
    await registerReconciliation(
      "OK",
      0,
      new Date(Date.now() - 700_000).toISOString(),
    );
    await registerIndexer(10);
    const app = await mountRouter();

    await withHttpServer(app, async (baseUrl) => {
      const res = await fetch(`${baseUrl}/health/ready`);
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.ready).toBe(true);
      expect(body.protocolStatus).toBe("unavailable");
      expect(body.checks.reconciliation).toMatchObject({
        status: "STALE",
        ready: false,
      });
    });
  });
});
