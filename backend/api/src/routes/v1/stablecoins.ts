/**
 * Stablecoins API Routes
 *
 * Exposes stablecoin bridge configuration, history, and status data
 * from the indexed InstitutionalStablecoinBridge contract events.
 */

import { Router, Request, Response, NextFunction } from "express";
import { param, query, validationResult } from "express-validator";
import { container } from "tsyringe";
import { StablecoinBridgeService } from "../../services/StablecoinBridgeService";
import { CacheService } from "../../services/CacheService";
import { asyncHandler } from "../../utils/asyncHandler";
import { ApiError } from "../../utils/ApiError";

const router = Router();
const stablecoinService = container.resolve(StablecoinBridgeService);
const cacheService = container.resolve(CacheService);

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

/** bytes32 hex string: 0x + 64 hex chars */
const assetIdValidator = param("assetId")
  .trim()
  .matches(/^0x[a-fA-F0-9]{64}$/)
  .withMessage(
    "assetId must be a valid bytes32 hex string (0x + 64 hex chars)",
  );

/**
 * Allowed bridge event types — must exactly match the events the IndexerService
 * actually indexes.  Adding values here without corresponding indexer handlers
 * causes the API to accept filters that always return empty results.
 */
const BRIDGE_EVENT_TYPES = [
  "StablecoinConfigured",
  "CCTPBurnInitiated",
  "MintExecuted",
  "CircuitBreakerTriggered",
] as const;

const validate = (req: Request, _res: Response, next: NextFunction) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    throw new ApiError(400, "Validation failed", errors.array());
  }
  next();
};

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

/**
 * GET /v1/stablecoins
 * List all stablecoin configurations.
 */
router.get(
  "/",
  asyncHandler(async (_req: Request, res: Response) => {
    const cacheKey = "stablecoins:configs";
    const cached = await cacheService.get(cacheKey);

    if (cached) {
      return res.json(cached);
    }

    const configs = await stablecoinService.getConfigs();
    const result = { data: configs };

    // Cache for 30 seconds (configs change infrequently)
    await cacheService.set(cacheKey, result, 30);

    res.json(result);
  }),
);

/**
 * GET /v1/stablecoins/:assetId
 * Get a single stablecoin configuration.
 */
router.get(
  "/:assetId",
  [assetIdValidator, validate],
  asyncHandler(async (req: Request, res: Response) => {
    const { assetId } = req.params;

    const cacheKey = `stablecoins:config:${assetId}`;
    const cached = await cacheService.get(cacheKey);

    if (cached) {
      return res.json(cached);
    }

    const config = await stablecoinService.getConfig(assetId);

    if (!config) {
      throw new ApiError(
        404,
        `Stablecoin config not found for assetId: ${assetId}`,
      );
    }

    const result = { data: config };
    await cacheService.set(cacheKey, result, 30);

    res.json(result);
  }),
);

/**
 * GET /v1/stablecoins/:assetId/history
 * Get paginated bridge events for a stablecoin.
 */
router.get(
  "/:assetId/history",
  [
    assetIdValidator,
    query("limit").optional().isInt({ min: 1, max: 100 }).toInt(),
    query("offset").optional().isInt({ min: 0 }).toInt(),
    query("event_type")
      .optional()
      .isIn(BRIDGE_EVENT_TYPES)
      .withMessage(
        `event_type must be one of: ${BRIDGE_EVENT_TYPES.join(", ")}`,
      ),
    validate,
  ],
  asyncHandler(async (req: Request, res: Response) => {
    const { assetId } = req.params;
    const {
      limit = 50,
      offset = 0,
      event_type,
    } = req.query as {
      limit?: number;
      offset?: number;
      event_type?: string;
    };

    const cacheKey = `stablecoins:history:${assetId}:${limit}:${offset}:${event_type || "all"}`;
    const cached = await cacheService.get(cacheKey);

    if (cached) {
      return res.json(cached);
    }

    const result = await stablecoinService.getBridgeHistory(assetId, {
      limit,
      offset,
      eventType: event_type,
    });

    // Cache for 10 seconds (events come in with new blocks)
    await cacheService.set(cacheKey, result, 10);

    res.json(result);
  }),
);

/**
 * GET /v1/stablecoins/:assetId/status
 * Get circuit breaker and daily usage status for a stablecoin.
 */
router.get(
  "/:assetId/status",
  [assetIdValidator, validate],
  asyncHandler(async (req: Request, res: Response) => {
    const { assetId } = req.params;

    const cacheKey = `stablecoins:status:${assetId}`;
    const cached = await cacheService.get(cacheKey);

    if (cached) {
      return res.json(cached);
    }

    const status = await stablecoinService.getStatus(assetId);

    if (!status) {
      throw new ApiError(404, `Stablecoin not found for assetId: ${assetId}`);
    }

    const result = { data: status };

    // Cache for 15 seconds (status changes with bridge activity)
    await cacheService.set(cacheKey, result, 15);

    res.json(result);
  }),
);

export { router as stablecoinsRouter };
