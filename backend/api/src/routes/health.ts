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

import { Router, Request, Response } from "express";
import { container } from "tsyringe";
import { PrismaClient } from "@prisma/client";
import { IndexerService } from "../services/IndexerService";
import { BlockchainService } from "../services/BlockchainService";
import { ReconciliationScheduler } from "../services/ReconciliationScheduler";
import { AlertService } from "../services/AlertService";
import { config } from "../config";
import { logger } from "../utils/logger";
import { errorContext } from "../utils/errorContext";
import { requireOperationalAccess } from "../middleware/operationalAccess";
import { noStore } from "../middleware/noStore";
import {
  getConfiguredIndexerCursorKey,
  getConfiguredIndexerNetworkKeys,
} from "../lib/indexerNetworkIdentity";

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

export async function shutdownHealthCheckResources(): Promise<void> {
  const healthPrisma = prisma;
  prisma = null;

  if (!healthPrisma) {
    return;
  }

  await healthPrisma.$disconnect();
}

// ---------------------------------------------------------------------------
// Individual probe functions
// ---------------------------------------------------------------------------

interface ProbeResult {
  status: "ok" | "degraded" | "error";
  latencyMs?: number;
  message?: string;
  height?: number;
}

interface IndexerCursorState {
  blockNumber: number;
  pendingBlockNumber: number | null;
  requiresRebuild: boolean;
  networkChainId: string | null;
  networkAnchorHash: string | null;
  networkVaultAddress: string | null;
  networkStaethelAddress: string | null;
  networkStablecoinBridgeAddress: string | null;
  networkIdentityValid: boolean;
  updatedAt: Date;
}

interface IndexerCursorHealth {
  lag: number | null;
  pendingBlockNumber: number | null;
  requiresRebuild: boolean | null;
  networkIdentityValid: boolean | null;
  cursorAheadOfRpc: boolean;
  stale: boolean;
  ready: boolean;
}

interface ReadinessChecks {
  database: ProbeResult;
  blockchainRpc: ProbeResult;
  indexer?: {
    lag: number | null;
    pendingBlockNumber: number | null;
    requiresRebuild: boolean | null;
    networkIdentityValid: boolean | null;
    cursorAheadOfRpc: boolean;
    stale: boolean;
    ready: boolean;
  };
  reconciliation: {
    epoch: number | null;
    epochSource: string | null;
    status: string;
    lastRun: string | null;
    activeCriticalAlerts: number;
    leadership: string;
    ready: boolean;
  };
}

type ProtocolStatus = "healthy" | "degraded" | "unavailable";

const PRODUCTION_PROBE_FAILURE_MESSAGE =
  "Probe failed; see server logs for details.";
const INDEXER_CRITICAL_LAG_BLOCKS = 500;
const INDEXER_DEGRADED_LAG_BLOCKS = 100;
const INDEXER_CONFIRMATION_DEPTH = 2;
const INDEXER_CURSOR_STALE_AFTER_MS = 60_000;
const RECONCILIATION_RESULT_MIN_FRESH_MS = 60_000;

function toClientProbeResult(result: ProbeResult): ProbeResult {
  if (!config.isProduction || result.status !== "error") {
    return result;
  }

  return {
    status: result.status,
    latencyMs: result.latencyMs,
    message: PRODUCTION_PROBE_FAILURE_MESSAGE,
  };
}

async function checkDatabase(): Promise<ProbeResult> {
  const start = Date.now();
  try {
    await getPrisma().$queryRaw`SELECT 1`;
    return { status: "ok", latencyMs: Date.now() - start };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Unknown database error";
    logger.error("Health check: database probe failed", errorContext(err));
    return { status: "error", latencyMs: Date.now() - start, message };
  }
}

async function checkBlockchainRpc(): Promise<ProbeResult> {
  const start = Date.now();
  try {
    const blockchainService = container.resolve(BlockchainService);
    const height = await blockchainService.getLatestHeight();
    return {
      status: "ok",
      latencyMs: Date.now() - start,
      message: `Latest block height: ${height}`,
      height,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown RPC error";
    logger.error(
      "Health check: blockchain RPC probe failed",
      errorContext(err),
    );
    return { status: "error", latencyMs: Date.now() - start, message };
  }
}

async function checkIndexerCursorState(): Promise<IndexerCursorState | null> {
  const expectedNetwork = getConfiguredIndexerNetworkKeys();
  const cursor = await getPrisma().indexerCursor.findUnique({
    where: { cursorKey: getConfiguredIndexerCursorKey() },
    select: {
      blockNumber: true,
      pendingBlockNumber: true,
      requiresRebuild: true,
      networkChainId: true,
      networkAnchorHash: true,
      networkVaultAddress: true,
      networkStaethelAddress: true,
      networkStablecoinBridgeAddress: true,
      updatedAt: true,
    },
  });
  return cursor
    ? {
        blockNumber: Number(cursor.blockNumber),
        pendingBlockNumber:
          cursor.pendingBlockNumber == null
            ? null
            : Number(cursor.pendingBlockNumber),
        requiresRebuild: cursor.requiresRebuild,
        networkChainId: cursor.networkChainId,
        networkAnchorHash: cursor.networkAnchorHash,
        networkVaultAddress: cursor.networkVaultAddress,
        networkStaethelAddress: cursor.networkStaethelAddress,
        networkStablecoinBridgeAddress: cursor.networkStablecoinBridgeAddress,
        networkIdentityValid:
          expectedNetwork === null ||
          (cursor.networkChainId === expectedNetwork.identity.chainId &&
            cursor.networkAnchorHash?.toLowerCase() ===
              expectedNetwork.identity.anchorHash &&
            cursor.networkVaultAddress?.toLowerCase() ===
              expectedNetwork.identity.vaultAddress &&
            cursor.networkStaethelAddress?.toLowerCase() ===
              expectedNetwork.identity.staethelAddress &&
            cursor.networkStablecoinBridgeAddress?.toLowerCase() ===
              expectedNetwork.identity.stablecoinBridgeAddress),
        updatedAt: cursor.updatedAt,
      }
    : null;
}

function assessIndexerCursor(
  rpc: ProbeResult,
  cursor: IndexerCursorState | null,
  cursorProbeSucceeded: boolean,
): IndexerCursorHealth {
  if (
    !cursorProbeSucceeded ||
    cursor === null ||
    rpc.status !== "ok" ||
    typeof rpc.height !== "number"
  ) {
    return {
      lag: null,
      pendingBlockNumber: cursor?.pendingBlockNumber ?? null,
      requiresRebuild: cursor?.requiresRebuild ?? null,
      networkIdentityValid: cursor?.networkIdentityValid ?? null,
      cursorAheadOfRpc: false,
      stale: false,
      ready: false,
    };
  }

  const cursorAheadOfRpc = cursor.blockNumber > rpc.height;
  const lag = Math.max(0, rpc.height - cursor.blockNumber);
  const stale =
    lag > INDEXER_CONFIRMATION_DEPTH &&
    Date.now() - cursor.updatedAt.getTime() > INDEXER_CURSOR_STALE_AFTER_MS;
  return {
    lag,
    pendingBlockNumber: cursor.pendingBlockNumber,
    requiresRebuild: cursor.requiresRebuild,
    networkIdentityValid: cursor.networkIdentityValid,
    cursorAheadOfRpc,
    stale,
    ready:
      cursor.pendingBlockNumber === null &&
      !cursor.requiresRebuild &&
      cursor.networkIdentityValid &&
      !cursorAheadOfRpc &&
      lag <= INDEXER_CRITICAL_LAG_BLOCKS &&
      !stale,
  };
}

function isReconciliationResultFresh(timestamp: string | undefined): boolean {
  if (!timestamp) return false;
  const parsed = Date.parse(timestamp);
  const maxAgeMs = Math.max(
    RECONCILIATION_RESULT_MIN_FRESH_MS,
    config.reconciliationIntervalMs * 2,
  );
  return (
    Number.isFinite(parsed) &&
    parsed <= Date.now() + 5_000 &&
    Date.now() - parsed <= maxAgeMs
  );
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
  return { seconds: uptimeSeconds, human: parts.join(" ") };
}

function readinessResponseBody(
  ready: boolean,
  checks: ReadinessChecks,
): Record<string, unknown> {
  const protocolStatus: ProtocolStatus =
    !ready ||
    checks.reconciliation.status === "UNKNOWN" ||
    checks.reconciliation.status === "UNAVAILABLE" ||
    checks.reconciliation.status === "STALE"
      ? "unavailable"
      : checks.reconciliation.status === "CRITICAL" ||
          checks.reconciliation.status === "WARNING" ||
          checks.reconciliation.activeCriticalAlerts > 0
        ? "degraded"
        : "healthy";
  const body = {
    ready,
    status: ready ? "ready" : "not_ready",
    protocolStatus,
    timestamp: new Date().toISOString(),
  };

  if (config.isProduction) {
    return body;
  }

  return {
    ...body,
    checks,
  };
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
router.get(
  "/",
  requireOperationalAccess,
  noStore,
  async (_req: Request, res: Response) => {
    // Run probes in parallel
    const [dbResult, rpcResult, recoveryResult] = await Promise.allSettled([
      checkDatabase(),
      checkBlockchainRpc(),
      checkIndexerCursorState(),
    ]);

    const db =
      dbResult.status === "fulfilled"
        ? dbResult.value
        : { status: "error" as const, message: "probe threw" };
    const rpc =
      rpcResult.status === "fulfilled"
        ? rpcResult.value
        : { status: "error" as const, message: "probe threw" };
    const clientDb = toClientProbeResult(db);
    const clientRpc = toClientProbeResult(rpc);

    // The API and indexer run as separate processes in production. Read the
    // durable recovery marker directly so API readiness cannot report healthy
    // while the indexer is repairing partially rebuilt projections.
    const cursorState =
      recoveryResult.status === "fulfilled" ? recoveryResult.value : null;
    const durableIndexer = assessIndexerCursor(
      rpc,
      cursorState,
      recoveryResult.status === "fulfilled",
    );
    let indexer: Record<string, unknown> | null = {
      ...durableIndexer,
    };
    let indexerDegraded =
      durableIndexer.lag !== null &&
      durableIndexer.lag > INDEXER_DEGRADED_LAG_BLOCKS;
    let indexerCritical = !durableIndexer.ready;
    if (config.indexerEnabled) {
      try {
        const indexerService = container.resolve(IndexerService);
        const metrics = indexerService.getMetrics();
        indexer = {
          ...metrics,
          lag: Math.max(
            durableIndexer.lag ?? 0,
            typeof metrics.lag === "number" ? metrics.lag : 0,
          ),
          requiresRebuild:
            durableIndexer.requiresRebuild === true ||
            metrics.requiresRebuild === true,
          networkIdentityValid: durableIndexer.networkIdentityValid,
          cursorAheadOfRpc: durableIndexer.cursorAheadOfRpc,
          stale: durableIndexer.stale,
        };
        const lag = indexer.lag as number;
        const requiresRebuild =
          durableIndexer.requiresRebuild === true ||
          metrics.requiresRebuild === true;
        const pendingBlockNumber =
          typeof metrics.pendingBlockNumber === "number"
            ? metrics.pendingBlockNumber
            : durableIndexer.pendingBlockNumber;
        // >100 blocks behind → degraded; >500 blocks behind → critical
        if (
          pendingBlockNumber !== null ||
          requiresRebuild ||
          durableIndexer.networkIdentityValid !== true ||
          durableIndexer.cursorAheadOfRpc ||
          durableIndexer.stale ||
          lag > INDEXER_CRITICAL_LAG_BLOCKS
        ) {
          indexerCritical = true;
        } else if (lag > INDEXER_DEGRADED_LAG_BLOCKS) {
          indexerDegraded = true;
        }
      } catch (err) {
        logger.error(
          "Health check: enabled indexer probe unavailable",
          errorContext(err),
        );
        indexerCritical = true;
        indexer = {
          ready: false,
          status: "UNAVAILABLE",
          lag: durableIndexer.lag,
          pendingBlockNumber: durableIndexer.pendingBlockNumber,
          requiresRebuild: durableIndexer.requiresRebuild,
          networkIdentityValid: durableIndexer.networkIdentityValid,
          cursorAheadOfRpc: durableIndexer.cursorAheadOfRpc,
          stale: durableIndexer.stale,
        };
      }
    }

    // Reconciliation status (required operational signal)
    let reconciliation: Record<string, unknown> | null;

    // Reconciliation status check
    let reconciliationDegraded = false;
    let reconciliationCritical = false;
    try {
      const scheduler = container.resolve(ReconciliationScheduler);
      const latestResult = scheduler.getLatestResult();
      const resultFresh = isReconciliationResultFresh(latestResult?.timestamp);
      const alertServiceInstance = container.resolve(AlertService);
      const activeCritical =
        await alertServiceInstance.getActiveCriticalCount();

      if (!latestResult || !resultFresh) {
        reconciliationCritical = true;
      } else if (latestResult.status === "CRITICAL" || activeCritical > 0) {
        reconciliationCritical = true;
      } else if (latestResult?.status === "WARNING") {
        reconciliationDegraded = true;
      }

      reconciliation = {
        lastRun: latestResult?.timestamp ?? null,
        epoch: latestResult?.epoch ?? null,
        epochSource: latestResult?.epochSource ?? null,
        status: latestResult
          ? resultFresh
            ? latestResult.status
            : "STALE"
          : "UNKNOWN",
        lastDurationMs: latestResult?.durationMs ?? null,
        activeCriticalAlerts: activeCritical,
        leadership:
          typeof scheduler.getLeadershipStatus === "function"
            ? scheduler.getLeadershipStatus()
            : "unknown",
      };
    } catch (err) {
      logger.error(
        "Health check: reconciliation probe unavailable",
        errorContext(err),
      );
      reconciliationCritical = true;
      reconciliation = {
        lastRun: null,
        epoch: null,
        epochSource: null,
        status: "UNAVAILABLE",
        lastDurationMs: null,
        activeCriticalAlerts: null,
        leadership: "unavailable",
        ready: false,
      };
    }

    // Determine overall status — now gates on ALL operational signals
    const coreOk = db.status === "ok" && rpc.status === "ok";
    const coreError = db.status === "error" || rpc.status === "error";
    const anyDegraded =
      indexerDegraded ||
      reconciliationDegraded ||
      db.status === "degraded" ||
      rpc.status === "degraded";
    const anyCritical = coreError || indexerCritical || reconciliationCritical;

    const overallStatus = anyCritical
      ? "unhealthy"
      : !coreOk || anyDegraded
        ? "degraded"
        : "healthy";
    const httpStatus = anyCritical ? 503 : !coreOk || anyDegraded ? 200 : 200;

    const uptime = getUptime();

    res.status(httpStatus).json({
      ok: overallStatus === "healthy",
      status: overallStatus,
      service: "cruzible-api",
      version: config.version,
      environment: config.env,
      timestamp: new Date().toISOString(),
      uptime,
      checks: {
        database: clientDb,
        blockchainRpc: clientRpc,
      },
      memory: getMemoryUsage(),
      ...(indexer ? { indexer } : {}),
      ...(reconciliation ? { reconciliation } : {}),
    });
  },
);

/**
 * GET /health/live
 * Kubernetes-style liveness probe. Minimal check — is the process alive?
 */
router.get("/live", noStore, (_req: Request, res: Response) => {
  res.status(200).json({ ok: true, timestamp: new Date().toISOString() });
});

/**
 * GET /health/ready
 * Kubernetes-style readiness probe. Checks that all critical dependencies are
 * up: database, RPC, and indexer projection freshness. Protocol safety is
 * reported independently as `protocolStatus`; a slashing/accounting alert must
 * not evict every API replica and make the diagnostic/control plane unreachable.
 */
router.get("/ready", noStore, async (_req: Request, res: Response) => {
  const [dbResult, rpcResult, recoveryResult] = await Promise.allSettled([
    checkDatabase(),
    checkBlockchainRpc(),
    checkIndexerCursorState(),
  ]);

  const db =
    dbResult.status === "fulfilled"
      ? dbResult.value
      : { status: "error" as const, message: "probe threw" };
  const rpc =
    rpcResult.status === "fulfilled"
      ? rpcResult.value
      : { status: "error" as const, message: "probe threw" };
  const clientDb = toClientProbeResult(db);
  const clientRpc = toClientProbeResult(rpc);

  const coreReady = db.status === "ok" && rpc.status === "ok";

  // Indexer readiness (critical lag = not ready)
  const cursorState =
    recoveryResult.status === "fulfilled" ? recoveryResult.value : null;
  const durableIndexer = assessIndexerCursor(
    rpc,
    cursorState,
    recoveryResult.status === "fulfilled",
  );
  let indexerReady = durableIndexer.ready;
  let indexerLag = durableIndexer.lag;
  let indexerPendingBlockNumber = durableIndexer.pendingBlockNumber;
  let indexerRequiresRebuild = durableIndexer.requiresRebuild;
  if (config.indexerEnabled) {
    try {
      const indexerService = container.resolve(IndexerService);
      const metrics = indexerService.getMetrics();
      indexerLag = Math.max(
        indexerLag ?? 0,
        typeof metrics.lag === "number" ? metrics.lag : 0,
      );
      indexerRequiresRebuild =
        indexerRequiresRebuild === true || metrics.requiresRebuild === true;
      indexerPendingBlockNumber =
        typeof metrics.pendingBlockNumber === "number"
          ? metrics.pendingBlockNumber
          : indexerPendingBlockNumber;
      if (
        indexerPendingBlockNumber !== null ||
        indexerRequiresRebuild ||
        durableIndexer.networkIdentityValid !== true ||
        durableIndexer.cursorAheadOfRpc ||
        durableIndexer.stale ||
        indexerLag > INDEXER_CRITICAL_LAG_BLOCKS
      ) {
        indexerReady = false;
      }
    } catch (err) {
      logger.error(
        "Health check: enabled indexer readiness unavailable",
        errorContext(err),
      );
      indexerReady = false;
      indexerLag = null;
      indexerPendingBlockNumber = null;
    }
  }

  // Protocol reconciliation posture is deliberately separate from pod
  // readiness. It remains visible to clients/operators without causing
  // Kubernetes to remove the API that exposes the diagnostic signal.
  let reconciliationReady: boolean;
  let reconciliationStatus: string | null;
  let activeCriticalAlerts = 0;
  let reconciliationLeadership = "unknown";
  let reconciliationLastRun: string | null = null;
  let latestResult: {
    epoch?: number;
    epochSource?: string;
    status?: string;
    timestamp?: string;
  } | null = null;
  try {
    const scheduler = container.resolve(ReconciliationScheduler);
    const candidate = scheduler.getLatestResult();
    reconciliationLastRun = candidate?.timestamp ?? null;
    const candidateFresh = isReconciliationResultFresh(candidate?.timestamp);
    latestResult = candidateFresh ? candidate : null;
    reconciliationStatus = candidate
      ? candidateFresh
        ? (candidate.status ?? null)
        : "STALE"
      : null;
    reconciliationLeadership =
      typeof scheduler.getLeadershipStatus === "function"
        ? scheduler.getLeadershipStatus()
        : "unknown";

    const alertServiceInstance = container.resolve(AlertService);
    activeCriticalAlerts = await alertServiceInstance.getActiveCriticalCount();

    // Fail closed until the scheduler has completed its first tick. start()
    // launches that tick asynchronously, so a null result means operational
    // safety has not yet been evaluated.
    reconciliationReady =
      latestResult !== null &&
      latestResult.status !== "CRITICAL" &&
      activeCriticalAlerts === 0;
  } catch (err) {
    logger.error(
      "Health check: reconciliation readiness unavailable",
      errorContext(err),
    );
    reconciliationReady = false;
    reconciliationStatus = "UNAVAILABLE";
  }

  const ready = coreReady && indexerReady;
  const checks: ReadinessChecks = {
    database: clientDb,
    blockchainRpc: clientRpc,
    indexer: {
      lag: indexerLag,
      requiresRebuild: indexerRequiresRebuild,
      pendingBlockNumber: indexerPendingBlockNumber,
      networkIdentityValid: durableIndexer.networkIdentityValid,
      cursorAheadOfRpc: durableIndexer.cursorAheadOfRpc,
      stale: durableIndexer.stale,
      ready: indexerReady,
    },
    reconciliation: {
      epoch: latestResult?.epoch ?? null,
      epochSource: latestResult?.epochSource ?? null,
      status: reconciliationStatus ?? "UNKNOWN",
      lastRun: reconciliationLastRun,
      activeCriticalAlerts,
      leadership: reconciliationLeadership,
      ready: reconciliationReady,
    },
  };

  res.status(ready ? 200 : 503).json(readinessResponseBody(ready, checks));
});

export { router };
