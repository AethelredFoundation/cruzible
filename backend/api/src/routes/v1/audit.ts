import { Router, Request, Response } from "express";
import { z } from "zod";
import { authenticate, requireRoles } from "../../auth/middleware";
import { opsRateLimiter } from "../../middleware/rateLimiter";
import {
  listPrivilegedAuditEvents,
  type PrivilegedAuditRecord,
} from "../../services/PrivilegedAuditService";
import { asyncHandler } from "../../utils/asyncHandler";
import { ApiError } from "../../utils/ApiError";

const router = Router();
const MAX_AUDIT_PAGINATION_OFFSET = 10_000;

router.use(opsRateLimiter);
router.use(authenticate);
router.use(requireRoles("operator", "admin"));

const DateTimeSchema = z
  .string()
  .trim()
  .datetime({ offset: true })
  .transform((value) => new Date(value));

const AuditQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce
    .number()
    .int()
    .min(0)
    .max(MAX_AUDIT_PAGINATION_OFFSET)
    .default(0),
  decision: z.enum(["allowed", "rejected"]).optional(),
  principal_type: z.enum(["wallet", "operational-token"]).optional(),
  actor_address: z.string().trim().toLowerCase().min(1).max(64).optional(),
  request_id: z.string().trim().min(1).max(128).optional(),
  from: DateTimeSchema.optional(),
  to: DateTimeSchema.optional(),
});

const AuditExportQuerySchema = AuditQuerySchema.extend({
  limit: z.coerce.number().int().min(1).max(1000).default(1000),
  format: z.enum(["ndjson", "csv"]).default("ndjson"),
});

function parseQuery<T extends z.ZodTypeAny>(
  schema: T,
  value: unknown,
): z.infer<T> {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new ApiError(400, "Validation failed", result.error.issues);
  }
  return result.data;
}

function assertDateRange(from?: Date, to?: Date): void {
  if (from && to && from > to) {
    throw new ApiError(400, "`from` must be before or equal to `to`");
  }
}

function toServiceQuery(query: z.infer<typeof AuditQuerySchema>) {
  assertDateRange(query.from, query.to);
  return {
    limit: query.limit,
    offset: query.offset,
    decision: query.decision,
    principalType: query.principal_type,
    actorAddress: query.actor_address,
    requestId: query.request_id,
    from: query.from,
    to: query.to,
  };
}

function escapeCsv(value: unknown): string {
  const text = Array.isArray(value) ? value.join("|") : String(value ?? "");
  const safeText = /^[\s]*[=+\-@\t\r\n]/.test(text) ? `'${text}` : text;
  return `"${safeText.replace(/"/g, '""')}"`;
}

function renderCsv(records: PrivilegedAuditRecord[]): string {
  const headers = [
    "createdAt",
    "requestId",
    "method",
    "path",
    "principalType",
    "actorAddress",
    "requiredRoles",
    "decision",
    "reason",
    "outcome",
    "statusCode",
    "eventHash",
    "previousEventHash",
  ];
  const rows = records.map((record) =>
    headers
      .map((header) => escapeCsv(record[header as keyof PrivilegedAuditRecord]))
      .join(","),
  );

  return `${headers.join(",")}\n${rows.join("\n")}${rows.length > 0 ? "\n" : ""}`;
}

/**
 * @swagger
 * /v1/audit/privileged-access:
 *   get:
 *     summary: List privileged access audit events
 *     tags: [Audit]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Paginated privileged audit events
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 */
router.get(
  "/privileged-access",
  asyncHandler(async (req: Request, res: Response) => {
    const query = parseQuery(AuditQuerySchema, req.query);
    const serviceQuery = toServiceQuery(query);
    const result = await listPrivilegedAuditEvents(serviceQuery);

    res.json({
      data: result.data,
      pagination: {
        limit: serviceQuery.limit,
        offset: serviceQuery.offset,
        total: result.total,
        hasMore: serviceQuery.offset + serviceQuery.limit < result.total,
      },
    });
  }),
);

/**
 * @swagger
 * /v1/audit/privileged-access/export:
 *   get:
 *     summary: Export privileged access audit events
 *     tags: [Audit]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: NDJSON or CSV export
 */
router.get(
  "/privileged-access/export",
  asyncHandler(async (req: Request, res: Response) => {
    const query = parseQuery(AuditExportQuerySchema, req.query);
    const serviceQuery = toServiceQuery(query);
    const result = await listPrivilegedAuditEvents(serviceQuery);

    res.setHeader("Cache-Control", "no-store");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="privileged-audit.${query.format === "csv" ? "csv" : "ndjson"}"`,
    );

    if (query.format === "csv") {
      res.type("text/csv").send(renderCsv(result.data));
      return;
    }

    res
      .type("application/x-ndjson")
      .send(result.data.map((record) => JSON.stringify(record)).join("\n"));
  }),
);

export { router as auditRouter };
