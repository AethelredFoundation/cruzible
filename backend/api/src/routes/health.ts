/**
 * Health Check Routes
 *
 * Production-grade health endpoint that reports on:
 * - Database connectivity (Prisma)
 * - Blockchain RPC connectivity
 * - Memory usage statistics
 * - Process uptime
 * - Service version info
 * - Indexer metrics (if enabled)
 */

import { Router, Request, Response } from 'express';
import { container } from 'tsyringe';
import { PrismaClient } from '@prisma/client';
import { IndexerService } from '../services/IndexerService';
import { BlockchainService } from '../services/BlockchainService';
import { ReconciliationScheduler } from '../services/ReconciliationScheduler';
import { AlertService } from '../services/AlertService';
import { config } from '../config';
import { logger } from '../utils/logger';

const router = Router();

// Track server start time for uptime calculation
const serverStartTime = Date.now();

/**
 * Lazily resolved Prisma client for health checks.
 * We create our own instance rather than pulling from a service to ensure
 * the health check itself does not depend on service initialization order.
 */
let prisma: PrismaClient | null = null;
function getPrisma(): PrismaClient {
  if (!prisma) {
    prisma = new PrismaClient();
  }
  return prisma;
}

// ---------------------------------------------------------------------------
// Individual probe functions
// ---------------------------------------------------------------------------

interface ProbeResult {
  status: 'ok' | 'degraded' | 'error';
  latencyMs?: number;
  message?: string;
}

async function checkDatabase(): Promise<ProbeResult> {
  const start = Date.now();
  try {
    await getPrisma().$queryRaw`SELECT 1`;
    return { status: 'ok', latencyMs: Date.now() - start };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown database error';
    logger.error('Health check: database probe failed', { error: message });
    return { status: 'error', latencyMs: Date.now() - start, message };
  }
}

async function checkBlockchainRpc(): Promise<ProbeResult> {
  const start = Date.now();
  try {
    const blockchainService = container.resolve(BlockchainService);
    const height = await blockchainService.getLatestHeight();
    return {
      status: 'ok',
      latencyMs: Date.now() - start,
      message: `Latest block height: ${height}`,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown RPC error';
    logger.error('Health check: blockchain RPC probe failed', { error: message });
    return { status: 'error', latencyMs: Date.now() - start, message };
  }
}

function getMemoryUsage(): Record<string, string> {
  const mem = process.memoryUsage();
  const toMB = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(2)} MB`;
  return {
    rss: toMB(mem.rss),
    heapTotal: toMB(mem.heapTotal),
    heapUsed: toMB(mem.heapUsed),
    external: toMB(mem.external),
    arrayBuffers: toMB(mem.arrayBuffers),
  };
}

function getUptime(): { seconds: number; human: string } {
  const uptimeSeconds = Math.floor((Date.now() - serverStartTime) / 1000);
  const days = Math.floor(uptimeSeconds / 86400);
  const hours = Math.floor((uptimeSeconds % 86400) / 3600);
  const minutes = Math.floor((uptimeSeconds % 3600) / 60);
  const secs = uptimeSeconds % 60;
  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  parts.push(`${secs}s`);
  return { seconds: uptimeSeconds, human: parts.join(' ') };
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

/**
 * GET /health
 * Comprehensive health probe. Returns 200 when all systems are healthy or
 * degraded, 503 when any critical system (DB, RPC, indexer lag >500, or
 * reconciliation CRITICAL) is failing.
 */
router.get('/', async (_req: Request, res: Response) => {
  // Run probes in parallel
  const [dbResult, rpcResult] = await Promise.allSettled([
    checkDatabase(),
    checkBlockchainRpc(),
  ]);

  const db = dbResult.status === 'fulfilled' ? dbResult.value : { status: 'error' as const, message: 'probe threw' };
  const rpc = rpcResult.status === 'fulfilled' ? rpcResult.value : { status: 'error' as const, message: 'probe threw' };

  // Indexer metrics (optional)
  let indexer: Record<string, unknown> | null = null;
  try {
    if (config.indexerEnabled) {
      const indexerService = container.resolve(IndexerService);
      indexer = indexerService.getMetrics();
    }
  } catch {
    // Indexer not registered or not started
  }

  // Reconciliation status (optional)
  let reconciliation: Record<string, unknown> | null = null;

  // Indexer lag check (if enabled)
  let indexerDegraded = false;
  let indexerCritical = false;
  try {
    if (config.indexerEnabled) {
      const indexerService = container.resolve(IndexerService);
      const metrics = indexerService.getMetrics();
      const lag = typeof metrics.lag === 'number' ? metrics.lag : 0;
      // >100 blocks behind → degraded; >500 blocks behind → critical
      if (lag > 500) {
        indexerCritical = true;
      } else if (lag > 100) {
        indexerDegraded = true;
      }
    }
  } catch {
    // Indexer not registered
  }

  // Reconciliation status check
  let reconciliationDegraded = false;
  let reconciliationCritical = false;
  try {
    const scheduler = container.resolve(ReconciliationScheduler);
    const latestResult = scheduler.getLatestResult();
    const alertServiceInstance = container.resolve(AlertService);
    const activeCritical = await alertServiceInstance.getActiveCriticalCount();

    if (latestResult?.status === 'CRITICAL' || activeCritical > 0) {
      reconciliationCritical = true;
    } else if (latestResult?.status === 'WARNING') {
      reconciliationDegraded = true;
    }

    reconciliation = {
      lastRun: latestResult?.timestamp ?? null,
      epoch: latestResult?.epoch ?? null,
      epochSource: latestResult?.epochSource ?? null,
      status: latestResult?.status ?? 'UNKNOWN',
      lastDurationMs: latestResult?.durationMs ?? null,
      activeCriticalAlerts: activeCritical,
    };
  } catch {
    // Scheduler not registered or not started
  }

  // Determine overall status — now gates on ALL operational signals
  const coreOk = db.status === 'ok' && rpc.status === 'ok';
  const coreError = db.status === 'error' || rpc.status === 'error';
  const anyDegraded = indexerDegraded || reconciliationDegraded
    || db.status === 'degraded' || rpc.status === 'degraded';
  const anyCritical = coreError || indexerCritical || reconciliationCritical;

  const overallStatus = anyCritical ? 'unhealthy' : !coreOk || anyDegraded ? 'degraded' : 'healthy';
  const httpStatus = anyCritical ? 503 : !coreOk || anyDegraded ? 200 : 200;

  const uptime = getUptime();

  res.status(httpStatus).json({
    ok: overallStatus === 'healthy',
    status: overallStatus,
    service: 'cruzible-api',
    version: config.version,
    environment: config.env,
    timestamp: new Date().toISOString(),
    uptime,
    checks: {
      database: db,
      blockchainRpc: rpc,
    },
    memory: getMemoryUsage(),
    ...(indexer ? { indexer } : {}),
    ...(reconciliation ? { reconciliation } : {}),
  });
});

/**
 * GET /health/live
 * Kubernetes-style liveness probe. Minimal check — is the process alive?
 */
router.get('/live', (_req: Request, res: Response) => {
  res.status(200).json({ ok: true, timestamp: new Date().toISOString() });
});

/**
 * GET /health/ready
 * Kubernetes-style readiness probe. Checks that all critical dependencies are
 * up: database, RPC, indexer lag (if enabled), and reconciliation status.
 * Returns 503 when any critical signal fails.
 */
router.get('/ready', async (_req: Request, res: Response) => {
  const [dbResult, rpcResult] = await Promise.allSettled([
    checkDatabase(),
    checkBlockchainRpc(),
  ]);

  const db = dbResult.status === 'fulfilled' ? dbResult.value : { status: 'error' as const, message: 'probe threw' };
  const rpc = rpcResult.status === 'fulfilled' ? rpcResult.value : { status: 'error' as const, message: 'probe threw' };

  const coreReady = db.status === 'ok' && rpc.status === 'ok';

  // Indexer readiness (critical lag = not ready)
  let indexerReady = true;
  let indexerLag: number | null = null;
  try {
    if (config.indexerEnabled) {
      const indexerService = container.resolve(IndexerService);
      const metrics = indexerService.getMetrics();
      indexerLag = typeof metrics.lag === 'number' ? metrics.lag : 0;
      if (indexerLag > 500) {
        indexerReady = false;
      }
    }
  } catch {
    // Indexer not registered
  }

  // Reconciliation readiness (CRITICAL status = not ready)
  let reconciliationReady = true;
  let reconciliationStatus: string | null = null;
  let activeCriticalAlerts = 0;
  let latestResult: { epoch?: number; epochSource?: string; status?: string; timestamp?: string } | null = null;
  try {
    const scheduler = container.resolve(ReconciliationScheduler);
    latestResult = scheduler.getLatestResult();
    reconciliationStatus = latestResult?.status ?? null;

    const alertServiceInstance = container.resolve(AlertService);
    activeCriticalAlerts = await alertServiceInstance.getActiveCriticalCount();

    if (latestResult?.status === 'CRITICAL' || activeCriticalAlerts > 0) {
      reconciliationReady = false;
    }
  } catch {
    // Scheduler not registered
  }

  const ready = coreReady && indexerReady && reconciliationReady;

  res.status(ready ? 200 : 503).json({
    ready,
    checks: {
      database: db,
      blockchainRpc: rpc,
      ...(config.indexerEnabled ? { indexer: { lag: indexerLag, ready: indexerReady } } : {}),
      reconciliation: {
        epoch: latestResult?.epoch ?? null,
        epochSource: latestResult?.epochSource ?? null,
        status: reconciliationStatus ?? 'UNKNOWN',
        lastRun: latestResult?.timestamp ?? null,
        activeCriticalAlerts,
        ready: reconciliationReady,
      },
    },
    timestamp: new Date().toISOString(),
  });
});

export { router };
