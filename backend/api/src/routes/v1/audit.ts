import { Router, Request, Response } from "express";
import { z } from "zod";
import { authenticate, requireRoles } from "../../auth/middleware";
import { opsRateLimiter } from "../../middleware/rateLimiter";
import { noStore } from "../../middleware/noStore";
import {
  listPrivilegedAuditEvents,
  type PrivilegedAuditRecord,
} from "../../services/PrivilegedAuditService";
import { asyncHandler } from "../../utils/asyncHandler";
import { ApiError } from "../../utils/ApiError";
import { integerParamSchema } from "../../validation/schemas";

const router = Router();
const MAX_AUDIT_PAGINATION_OFFSET = 10_000;
const SAFE_AUDIT_ACTOR_PATTERN = /^[a-z0-9._:-]{1,64}$/;
const SAFE_AUDIT_REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{1,64}$/;

router.use(opsRateLimiter);
router.use(authenticate);
router.use(requireRoles("operator", "admin"));
router.use(noStore);

const DateTimeSchema = z
  .string()
  .trim()
  .datetime({ offset: true })
  .transform((value) => new Date(value));

const AuditQuerySchema = z.object({
  limit: integerParamSchema({ min: 1, max: 100, defaultValue: 50 }),
  offset: integerParamSchema({
    min: 0,
    max: MAX_AUDIT_PAGINATION_OFFSET,
    defaultValue: 0,
  }),
  decision: z.enum(["allowed", "rejected"]).optional(),
  principal_type: z.enum(["wallet", "operational-token"]).optional(),
  actor_address: z
    .string()
    .trim()
    .toLowerCase()
    .regex(SAFE_AUDIT_ACTOR_PATTERN, "Invalid actor address filter")
    .optional(),
  request_id: z
    .string()
    .trim()
    .regex(SAFE_AUDIT_REQUEST_ID_PATTERN, "Invalid request ID filter")
    .optional(),
  from: DateTimeSchema.optional(),
  to: DateTimeSchema.optional(),
});

const AuditExportQuerySchema = AuditQuerySchema.extend({
  limit: integerParamSchema({ min: 1, max: 1000, defaultValue: 1000 }),
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
