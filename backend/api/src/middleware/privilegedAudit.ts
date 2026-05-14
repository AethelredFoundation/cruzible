import "reflect-metadata";
import { createHash } from "crypto";
import { PrismaClient } from "@prisma/client";
import type { Request, Response } from "express";
import { container } from "tsyringe";
import { config } from "../config";
import {
  AlertService,
  AlertSeverity,
  AlertType,
} from "../services/AlertService";
import { errorContext } from "../utils/errorContext";
import { logger } from "../utils/logger";

type PrivilegedPrincipalType = "wallet" | "operational-token";
type PrivilegedDecision = "allowed" | "rejected";
type PrivilegedOutcome = "succeeded" | "denied" | "failed" | "rejected";

export interface PrivilegedAuditContext {
  principalType: PrivilegedPrincipalType;
  decision: PrivilegedDecision;
  reason?: string;
  actorAddress?: string;
  tokenRoles?: readonly string[];
  currentRoles?: readonly string[];
  requiredRoles?: readonly string[];
}

interface PrivilegedAuditEntry {
  type: "privileged_access_audit";
  timestamp: string;
  requestId: string;
  method: string;
  path: string;
  principalType: PrivilegedPrincipalType;
  actorAddress?: string;
  requiredRoles?: readonly string[];
  tokenRoles?: readonly string[];
  currentRoles?: readonly string[];
  decision: PrivilegedDecision;
  reason?: string;
  outcome: PrivilegedOutcome;
  statusCode: number;
  responseTimeMs: number;
  ip: string;
  userAgent: string;
}

export interface PersistedPrivilegedAuditEvent {
  requestId: string;
  method: string;
  path: string;
  principalType: PrivilegedPrincipalType;
  actorAddress: string | null;
  requiredRoles: string[];
  tokenRoles: string[];
  currentRoles: string[];
  decision: PrivilegedDecision;
  reason: string | null;
  outcome: PrivilegedOutcome;
  statusCode: number;
  responseTimeMs: number;
  ipHash: string;
  userAgentHash: string;
  eventHash: string;
  previousEventHash: string | null;
  createdAt: Date;
}

const MAX_MEMORY_AUDIT_EVENTS = 500;
const PRIVILEGED_AUDIT_DRAIN_TIMEOUT_MS = 5_000;
const auditPrisma = config.databaseUrl ? new PrismaClient() : null;
const memoryAuditEvents: PersistedPrivilegedAuditEvent[] = [];
const pendingPrivilegedAuditTasks = new Set<Promise<void>>();

function trackPrivilegedAuditTask(task: Promise<void>): void {
  const tracked = task.finally(() => {
    pendingPrivilegedAuditTasks.delete(tracked);
  });
  pendingPrivilegedAuditTasks.add(tracked);
}

function getClientIp(req: Request): string {
  return req.ip || req.socket.remoteAddress || "unknown";
}

function getAuditPath(req: Request): string {
  const rawPath = req.originalUrl || req.url || req.path || "unknown";
  return rawPath.split("?")[0] || "unknown";
}

function getOutcome(
  statusCode: number,
  decision: PrivilegedDecision,
): PrivilegedOutcome {
  if (decision === "rejected") {
    return "rejected";
  }
  if (statusCode >= 500) {
    return "failed";
  }
  if (statusCode >= 400) {
    return "denied";
  }
  return "succeeded";
}

function hashValue(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function stableAuditJson(value: Record<string, unknown>): string {
  return JSON.stringify(
    Object.keys(value)
      .sort()
      .reduce<Record<string, unknown>>((accumulator, key) => {
        accumulator[key] = value[key];
        return accumulator;
      }, {}),
  );
}

function buildPersistedAuditEvent(
  entry: PrivilegedAuditEntry,
  previousEventHash: string | null,
): PersistedPrivilegedAuditEvent {
  const createdAt = new Date(entry.timestamp);
  const persisted = {
    requestId: entry.requestId,
    method: entry.method,
    path: entry.path,
    principalType: entry.principalType,
    actorAddress: entry.actorAddress ?? null,
    requiredRoles: [...(entry.requiredRoles ?? [])],
    tokenRoles: [...(entry.tokenRoles ?? [])],
    currentRoles: [...(entry.currentRoles ?? [])],
    decision: entry.decision,
    reason: entry.reason ?? null,
    outcome: entry.outcome,
    statusCode: entry.statusCode,
    responseTimeMs: entry.responseTimeMs,
    ipHash: hashValue(entry.ip),
    userAgentHash: hashValue(entry.userAgent),
    previousEventHash,
    createdAt,
  };
  const eventHash = hashValue(stableAuditJson(persisted));

  return {
    ...persisted,
    eventHash,
  };
}

function auditAlertMetadata(
  entry: PrivilegedAuditEntry,
): Record<string, unknown> {
  return {
    requestId: entry.requestId,
    method: entry.method,
    path: entry.path,
    principalType: entry.principalType,
    actorAddress: entry.actorAddress,
    requiredRoles: entry.requiredRoles,
    decision: entry.decision,
    reason: entry.reason,
    outcome: entry.outcome,
    statusCode: entry.statusCode,
  };
}

function errorType(error: unknown): string {
  return error instanceof Error ? error.name : typeof error;
}

async function emitPrivilegedAccessAlert(
  entry: PrivilegedAuditEntry,
): Promise<void> {
  await container
    .resolve(AlertService)
    .sendAlert(
      AlertSeverity.WARNING,
      AlertType.PRIVILEGED_ACCESS_REJECTED,
      "Privileged access request rejected",
      auditAlertMetadata(entry),
    );
}

async function emitPrivilegedAuditPersistenceAlert(
  entry: PrivilegedAuditEntry,
  error: unknown,
): Promise<void> {
  await container
    .resolve(AlertService)
    .sendAlert(
      AlertSeverity.CRITICAL,
      AlertType.PRIVILEGED_AUDIT_PERSISTENCE_FAILURE,
      "Privileged access audit persistence failed",
      {
        ...auditAlertMetadata(entry),
        errorType: errorType(error),
      },
    );
}

async function persistPrivilegedAuditEvent(
  entry: PrivilegedAuditEntry,
): Promise<void> {
  if (!auditPrisma) {
    const previousEventHash =
      memoryAuditEvents[memoryAuditEvents.length - 1]?.eventHash ?? null;
    memoryAuditEvents.push(buildPersistedAuditEvent(entry, previousEventHash));
    while (memoryAuditEvents.length > MAX_MEMORY_AUDIT_EVENTS) {
      memoryAuditEvents.shift();
    }
    return;
  }

  await auditPrisma.$transaction(async (tx) => {
    const previousEvent = await tx.privilegedAuditEvent.findFirst({
      orderBy: { createdAt: "desc" },
      select: { eventHash: true },
    });
    const persisted = buildPersistedAuditEvent(
      entry,
      previousEvent?.eventHash ?? null,
    );

    await tx.privilegedAuditEvent.create({
      data: persisted,
    });
  });
}

export function getMemoryPrivilegedAuditEvents(): readonly PersistedPrivilegedAuditEvent[] {
  return memoryAuditEvents;
}

export function clearMemoryPrivilegedAuditEvents(): void {
  memoryAuditEvents.length = 0;
}

export function getPendingPrivilegedAuditTaskCount(): number {
  return pendingPrivilegedAuditTasks.size;
}

export async function flushPendingPrivilegedAuditTasks(
  timeoutMs = PRIVILEGED_AUDIT_DRAIN_TIMEOUT_MS,
): Promise<void> {
  const pendingTasks = [...pendingPrivilegedAuditTasks];
  if (pendingTasks.length === 0) {
    return;
  }

  let timeoutId: NodeJS.Timeout | undefined;
  const timeout = new Promise<"timeout">((resolve) => {
    timeoutId = setTimeout(() => resolve("timeout"), timeoutMs);
  });
  const drained = Promise.allSettled(pendingTasks).then(
    () => "drained" as const,
  );
  const result = await Promise.race([drained, timeout]);

  if (timeoutId) {
    clearTimeout(timeoutId);
  }

  if (result === "timeout") {
    logger.warn("Timed out draining privileged audit tasks", {
      pendingTasks: pendingPrivilegedAuditTasks.size,
      timeoutMs,
    });
  }
}

export async function shutdownPrivilegedAudit(): Promise<void> {
  await flushPendingPrivilegedAuditTasks();
  await auditPrisma?.$disconnect();
}

export function auditPrivilegedAccess(
  req: Request,
  res: Response,
  context: PrivilegedAuditContext,
): void {
  const startTime = process.hrtime.bigint();
  let emitted = false;

  const emitAudit = () => {
    if (emitted) {
      return;
    }
    emitted = true;

    const elapsedNs = process.hrtime.bigint() - startTime;
    const elapsedMs = Number(elapsedNs) / 1_000_000;
    const statusCode = res.statusCode || 0;
    const auditEntry: PrivilegedAuditEntry = {
      type: "privileged_access_audit",
      timestamp: new Date().toISOString(),
      requestId: req.requestId || "unknown",
      method: req.method,
      path: getAuditPath(req),
      principalType: context.principalType,
      actorAddress: context.actorAddress,
      requiredRoles: context.requiredRoles,
      tokenRoles: context.tokenRoles,
      currentRoles: context.currentRoles,
      decision: context.decision,
      reason: context.reason,
      outcome: getOutcome(statusCode, context.decision),
      statusCode,
      responseTimeMs: Math.round(elapsedMs * 100) / 100,
      ip: getClientIp(req),
      userAgent: req.get("user-agent") || "unknown",
    };

    if (context.decision === "rejected" || statusCode >= 400) {
      logger.warn("Privileged access audit", auditEntry);
    } else {
      logger.info("Privileged access audit", auditEntry);
    }

    if (context.decision === "rejected") {
      trackPrivilegedAuditTask(
        emitPrivilegedAccessAlert(auditEntry).catch((error: unknown) => {
          logger.error("Failed to emit privileged access alert", {
            requestId: auditEntry.requestId,
            ...errorContext(error),
          });
        }),
      );
    }

    trackPrivilegedAuditTask(
      persistPrivilegedAuditEvent(auditEntry).catch((error: unknown) => {
        logger.error("Failed to persist privileged access audit", {
          requestId: auditEntry.requestId,
          ...errorContext(error),
        });
        return emitPrivilegedAuditPersistenceAlert(auditEntry, error).catch(
          (alertError: unknown) => {
            logger.error("Failed to emit privileged audit persistence alert", {
              requestId: auditEntry.requestId,
              ...errorContext(alertError),
            });
          },
        );
      }),
    );
  };

  res.once("finish", emitAudit);
  res.once("close", emitAudit);
}
