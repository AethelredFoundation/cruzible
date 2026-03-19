/**
 * Alerts & Reconciliation Status API Routes
 *
 * Provides endpoints for querying alert history, alert summaries,
 * and the latest reconciliation result. All endpoints require
 * JWT authentication.
 */

import { Router, Request, Response } from "express";
import { query } from "express-validator";
import { container } from "tsyringe";
import {
  AlertService,
  AlertSeverity,
  AlertType,
} from "../../services/AlertService";
import { ReconciliationScheduler } from "../../services/ReconciliationScheduler";
import { authenticate } from "../../auth/middleware";
import { validate } from "../../middleware/validate";
import { asyncHandler } from "../../utils/asyncHandler";

const router = Router();

// All alert routes require authentication
router.use(authenticate);

const alertService = container.resolve(AlertService);
const reconciliationScheduler = container.resolve(ReconciliationScheduler);

// ---------------------------------------------------------------------------
// Enum value arrays for validation
// ---------------------------------------------------------------------------

const SEVERITY_VALUES = Object.values(AlertSeverity);
const TYPE_VALUES = Object.values(AlertType);

// ---------------------------------------------------------------------------
// GET /v1/alerts — List recent alerts (paginated)
// ---------------------------------------------------------------------------

/**
 * @swagger
 * /v1/alerts:
 *   get:
 *     summary: List recent alerts
 *     tags: [Alerts]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 50
 *           maximum: 100
 *       - in: query
 *         name: offset
 *         schema:
 *           type: integer
 *           default: 0
 *       - in: query
 *         name: severity
 *         schema:
 *           type: string
 *           enum: [INFO, WARNING, CRITICAL]
 *       - in: query
 *         name: type
 *         schema:
 *           type: string
 *           enum: [RECONCILIATION_MISMATCH, EXCHANGE_RATE_DRIFT, TVL_ANOMALY, EPOCH_STALE, VALIDATOR_COUNT_DROP]
 *     responses:
 *       200:
 *         description: Paginated list of alerts
 *       401:
 *         description: Unauthorized
 */
router.get(
  "/",
  [
    query("limit").optional().isInt({ min: 1, max: 100 }).toInt(),
    query("offset").optional().isInt({ min: 0 }).toInt(),
    query("severity").optional().isIn(SEVERITY_VALUES),
    query("type").optional().isIn(TYPE_VALUES),
    validate,
  ],
  asyncHandler(async (req: Request, res: Response) => {
    const limit = Number(req.query.limit ?? 50);
    const offset = Number(req.query.offset ?? 0);
    const severity = req.query.severity as AlertSeverity | undefined;
    const type = req.query.type as AlertType | undefined;

    const result = alertService.getAlertHistory({
      severity,
      type,
      limit,
      offset,
    });

    res.json({
      data: result.data,
      pagination: {
        limit,
        offset,
        total: result.total,
        hasMore: offset + limit < result.total,
      },
    });
  }),
);

// ---------------------------------------------------------------------------
// GET /v1/alerts/summary — Current alert counts by severity
// ---------------------------------------------------------------------------

/**
 * @swagger
 * /v1/alerts/summary:
 *   get:
 *     summary: Get alert count summary by severity and type
 *     tags: [Alerts]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Alert summary
 *       401:
 *         description: Unauthorized
 */
router.get(
  "/summary",
  asyncHandler(async (_req: Request, res: Response) => {
    const summary = alertService.getAlertSummary();
    res.json(summary);
  }),
);

// ---------------------------------------------------------------------------
// GET /v1/reconciliation/status — Latest reconciliation result
// ---------------------------------------------------------------------------
// Note: This route is mounted under /v1/alerts but the full path will be
// /v1/reconciliation/status via the parent router mount point.
// To keep it co-located we export it separately and the v1 index mounts it.
// ---------------------------------------------------------------------------

const reconciliationStatusRouter = Router();
reconciliationStatusRouter.use(authenticate);

/**
 * @swagger
 * /v1/reconciliation/status:
 *   get:
 *     summary: Get latest scheduled reconciliation result
 *     tags: [Reconciliation]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Latest reconciliation result
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: No reconciliation has run yet
 */
reconciliationStatusRouter.get(
  "/status",
  asyncHandler(async (_req: Request, res: Response) => {
    const result = reconciliationScheduler.getLatestResult();

    if (!result) {
      res.status(404).json({
        error: "Not Found",
        message:
          "No reconciliation result available yet. The scheduler may not have run.",
      });
      return;
    }

    res.json(result);
  }),
);

export { router as alertsRouter, reconciliationStatusRouter };
