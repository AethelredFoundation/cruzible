import 'reflect-metadata';
import express from 'express';
import { container } from 'tsyringe';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { withHttpServer } from './helpers/http';

// ---------------------------------------------------------------------------
// Mocks — hoisted by vitest before any imports
// ---------------------------------------------------------------------------

// Mock Prisma so the database health probe succeeds (tagged-template $queryRaw).
vi.mock('@prisma/client', () => {
  const MockPrismaClient = vi.fn().mockImplementation(function () {
    return ({
    $queryRaw: vi.fn().mockResolvedValue([1]),
  });
  });
  return { PrismaClient: MockPrismaClient };
});

// Suppress logger output in test runs.
vi.mock('../src/utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('/health/ready readiness gating', () => {
  beforeEach(() => {
    vi.resetModules();
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
    const { BlockchainService } = await import(
      '../src/services/BlockchainService'
    );
    container.registerInstance(BlockchainService, {
      getLatestHeight: vi.fn().mockResolvedValue(12345),
    } as any);
  }

  /** Register mock ReconciliationScheduler and AlertService. */
  async function registerReconciliation(
    status: string | null,
    criticalAlerts: number,
  ) {
    const { ReconciliationScheduler } = await import(
      '../src/services/ReconciliationScheduler'
    );
    const { AlertService } = await import('../src/services/AlertService');

    const latestResult =
      status != null
        ? { status, timestamp: new Date().toISOString() }
        : null;

    container.registerInstance(ReconciliationScheduler, {
      getLatestResult: vi.fn().mockReturnValue(latestResult),
    } as any);

    container.registerInstance(AlertService, {
      getActiveCriticalCount: vi.fn().mockReturnValue(criticalAlerts),
    } as any);
  }

  /** Register mock IndexerService with a specific lag value. */
  async function registerIndexer(lag: number) {
    const { IndexerService } = await import(
      '../src/services/IndexerService'
    );
    container.registerInstance(IndexerService, {
      getMetrics: vi.fn().mockReturnValue({ lag }),
    } as any);
  }

  /** Import the health router from a fresh module graph and mount it. */
  async function mountRouter() {
    const { router } = await import('../src/routes/health');
    const app = express();
    app.use('/health', router);
    return app;
  }

  // -----------------------------------------------------------------------
  // Regression tests for P2 finding: readiness semantic coverage
  // -----------------------------------------------------------------------

  it('returns 200 when all systems are healthy (baseline)', async () => {
    await setupHealthyCore();
    await registerReconciliation('OK', 0);
    await registerIndexer(10);
    const app = await mountRouter();

    await withHttpServer(app, async (baseUrl) => {
      const res = await fetch(`${baseUrl}/health/ready`);
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.ready).toBe(true);
      expect(body.checks.reconciliation.ready).toBe(true);
    });
  });

  it('returns 503 when reconciliation status is CRITICAL', async () => {
    await setupHealthyCore();
    await registerReconciliation('CRITICAL', 0);
    await registerIndexer(10);
    const app = await mountRouter();

    await withHttpServer(app, async (baseUrl) => {
      const res = await fetch(`${baseUrl}/health/ready`);
      const body = await res.json();

      expect(res.status).toBe(503);
      expect(body.ready).toBe(false);
      expect(body.checks.reconciliation.status).toBe('CRITICAL');
      expect(body.checks.reconciliation.ready).toBe(false);
    });
  });

  it('returns 503 when critical alerts are active (reconciliation OK)', async () => {
    await setupHealthyCore();
    await registerReconciliation('OK', 3);
    await registerIndexer(10);
    const app = await mountRouter();

    await withHttpServer(app, async (baseUrl) => {
      const res = await fetch(`${baseUrl}/health/ready`);
      const body = await res.json();

      expect(res.status).toBe(503);
      expect(body.ready).toBe(false);
      expect(body.checks.reconciliation.activeCriticalAlerts).toBe(3);
      expect(body.checks.reconciliation.ready).toBe(false);
    });
  });

  it('returns 503 when indexer lag exceeds critical threshold (>500 blocks)', async () => {
    await setupHealthyCore();
    await registerReconciliation('OK', 0);
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

  it('returns 200 when reconciliation is WARNING (only CRITICAL gates readiness)', async () => {
    await setupHealthyCore();
    await registerReconciliation('WARNING', 0);
    await registerIndexer(10);
    const app = await mountRouter();

    await withHttpServer(app, async (baseUrl) => {
      const res = await fetch(`${baseUrl}/health/ready`);
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.ready).toBe(true);
      expect(body.checks.reconciliation.status).toBe('WARNING');
      expect(body.checks.reconciliation.ready).toBe(true);
    });
  });
});
