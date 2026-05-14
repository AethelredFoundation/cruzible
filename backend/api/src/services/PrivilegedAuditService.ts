import { Prisma, PrismaClient } from "@prisma/client";
import { config } from "../config";
import {
  getMemoryPrivilegedAuditEvents,
  type PersistedPrivilegedAuditEvent,
} from "../middleware/privilegedAudit";

export type PrivilegedAuditDecision = "allowed" | "rejected";
export type PrivilegedAuditPrincipalType = "wallet" | "operational-token";

export interface PrivilegedAuditQuery {
  limit: number;
  offset: number;
  decision?: PrivilegedAuditDecision;
  principalType?: PrivilegedAuditPrincipalType;
  actorAddress?: string;
  requestId?: string;
  from?: Date;
  to?: Date;
}

export interface PrivilegedAuditRecord {
  id: string;
  requestId: string;
  method: string;
  path: string;
  principalType: PrivilegedAuditPrincipalType;
  actorAddress: string | null;
  requiredRoles: string[];
  tokenRoles: string[];
  currentRoles: string[];
  decision: PrivilegedAuditDecision;
  reason: string | null;
  outcome: string;
  statusCode: number;
  responseTimeMs: number;
  ipHash: string;
  userAgentHash: string;
  eventHash: string;
  previousEventHash: string | null;
  createdAt: string;
}

export interface PrivilegedAuditResult {
  data: PrivilegedAuditRecord[];
  total: number;
}

const prisma = config.databaseUrl ? new PrismaClient() : null;

function normalizeQuery(query: PrivilegedAuditQuery): PrivilegedAuditQuery {
  return {
    ...query,
    actorAddress: query.actorAddress?.trim().toLowerCase(),
    requestId: query.requestId?.trim(),
  };
}

function matchesMemoryEvent(
  event: PersistedPrivilegedAuditEvent,
  query: PrivilegedAuditQuery,
): boolean {
  if (query.decision && event.decision !== query.decision) {
    return false;
  }
  if (query.principalType && event.principalType !== query.principalType) {
    return false;
  }
  if (query.actorAddress && event.actorAddress !== query.actorAddress) {
    return false;
  }
  if (query.requestId && event.requestId !== query.requestId) {
    return false;
  }
  if (query.from && event.createdAt < query.from) {
    return false;
  }
  if (query.to && event.createdAt > query.to) {
    return false;
  }
  return true;
}

function mapMemoryEvent(
  event: PersistedPrivilegedAuditEvent,
): PrivilegedAuditRecord {
  return {
    id: event.eventHash,
    requestId: event.requestId,
    method: event.method,
    path: event.path,
    principalType: event.principalType,
    actorAddress: event.actorAddress,
    requiredRoles: event.requiredRoles,
    tokenRoles: event.tokenRoles,
    currentRoles: event.currentRoles,
    decision: event.decision,
    reason: event.reason,
    outcome: event.outcome,
    statusCode: event.statusCode,
    responseTimeMs: event.responseTimeMs,
    ipHash: event.ipHash,
    userAgentHash: event.userAgentHash,
    eventHash: event.eventHash,
    previousEventHash: event.previousEventHash,
    createdAt: event.createdAt.toISOString(),
  };
}

function mapDatabaseEvent(event: {
  id: string;
  requestId: string;
  method: string;
  path: string;
  principalType: string;
  actorAddress: string | null;
  requiredRoles: string[];
  tokenRoles: string[];
  currentRoles: string[];
  decision: string;
  reason: string | null;
  outcome: string;
  statusCode: number;
  responseTimeMs: number;
  ipHash: string;
  userAgentHash: string;
  eventHash: string;
  previousEventHash: string | null;
  createdAt: Date;
}): PrivilegedAuditRecord {
  return {
    ...event,
    principalType: event.principalType as PrivilegedAuditPrincipalType,
    decision: event.decision as PrivilegedAuditDecision,
    createdAt: event.createdAt.toISOString(),
  };
}

function buildWhereClause(
  query: PrivilegedAuditQuery,
): Prisma.PrivilegedAuditEventWhereInput {
  return {
    decision: query.decision,
    principalType: query.principalType,
    actorAddress: query.actorAddress,
    requestId: query.requestId,
    createdAt:
      query.from || query.to
        ? {
            gte: query.from,
            lte: query.to,
          }
        : undefined,
  };
}

export async function listPrivilegedAuditEvents(
  input: PrivilegedAuditQuery,
): Promise<PrivilegedAuditResult> {
  const query = normalizeQuery(input);

  if (!prisma) {
    const filtered = getMemoryPrivilegedAuditEvents()
      .filter((event) => matchesMemoryEvent(event, query))
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    return {
      data: filtered
        .slice(query.offset, query.offset + query.limit)
        .map(mapMemoryEvent),
      total: filtered.length,
    };
  }

  const where = buildWhereClause(query);
  const [total, events] = await prisma.$transaction([
    prisma.privilegedAuditEvent.count({ where }),
    prisma.privilegedAuditEvent.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: query.offset,
      take: query.limit,
    }),
  ]);

  return {
    data: events.map(mapDatabaseEvent),
    total,
  };
}
