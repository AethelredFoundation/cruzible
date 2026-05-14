/**
 * Blocks API Routes
 */

import { Router, Request, Response } from "express";
import { param, query } from "express-validator";
import { container } from "tsyringe";
import { BlockchainService } from "../../services/BlockchainService";
import { CacheService } from "../../services/CacheService";
import { asyncHandler } from "../../utils/asyncHandler";
import { ApiError } from "../../utils/ApiError";
import { validate } from "../../middleware/validate";
import { MAX_PUBLIC_PAGINATION_OFFSET } from "../../validation/schemas";

const router = Router();
const blockchainService = container.resolve(BlockchainService);
const cacheService = container.resolve(CacheService);
const blockHeightValidator = param("height").isInt({ min: 1 }).toInt();

/**
 * @swagger
 * /v1/blocks:
 *   get:
 *     summary: Get blocks list
 *     tags: [Blocks]
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 20
 *           maximum: 100
 *         description: Number of blocks to return
 *       - in: query
 *         name: offset
 *         schema:
 *           type: integer
 *           default: 0
 *         description: Offset for pagination
 *       - in: query
 *         name: height
 *         schema:
 *           type: integer
 *         description: Specific block height to fetch
 *     responses:
 *       200:
 *         description: List of blocks
 */
router.get(
  "/",
  [
    query("limit").optional().isInt({ min: 1, max: 100 }).toInt(),
    query("offset")
      .optional()
      .isInt({ min: 0, max: MAX_PUBLIC_PAGINATION_OFFSET })
      .toInt(),
    query("height").optional().isInt({ min: 1 }).toInt(),
    validate,
  ],
  asyncHandler(async (req: Request, res: Response) => {
    const {
      limit = 20,
      offset = 0,
      height,
    } = req.query as {
      limit?: number;
      offset?: number;
      height?: number;
    };

    const cacheKey = `blocks:list:${limit}:${offset}:${height || "all"}`;
    const cached = await cacheService.get(cacheKey);

    if (cached) {
      return res.json(cached);
    }

    const result = await blockchainService.getBlocks({ limit, offset, height });

    // Cache for 3 seconds (blocks update frequently)
    await cacheService.set(cacheKey, result, 3);

    res.json(result);
  }),
);

/**
 * @swagger
 * /v1/blocks/latest:
 *   get:
 *     summary: Get latest block
 *     tags: [Blocks]
 *     responses:
 *       200:
 *         description: Latest block data
 */
router.get(
  "/latest",
  asyncHandler(async (req: Request, res: Response) => {
    const cacheKey = "blocks:latest";
    const cached = await cacheService.get(cacheKey);

    if (cached) {
      return res.json(cached);
    }

    const block = await blockchainService.getLatestBlock();

    // Cache for 1 second
    await cacheService.set(cacheKey, block, 1);

    res.json(block);
  }),
);

/**
 * @swagger
 * /v1/blocks/{height}:
 *   get:
 *     summary: Get block by height
 *     tags: [Blocks]
 *     parameters:
 *       - in: path
 *         name: height
 *         required: true
 *         schema:
 *           type: integer
 *         description: Block height
 *     responses:
 *       200:
 *         description: Block details
 *       404:
 *         description: Block not found
 */
router.get(
  "/:height",
  [blockHeightValidator, validate],
  asyncHandler(async (req: Request, res: Response) => {
    const height = Number(req.params.height);

    if (!Number.isInteger(height) || height < 1) {
      throw new ApiError(400, "Invalid block height");
    }

    const cacheKey = `blocks:height:${height}`;
    const cached = await cacheService.get(cacheKey);

    if (cached) {
      return res.json(cached);
    }

    const block = await blockchainService.getBlockByHeight(height);

    if (!block) {
      throw new ApiError(404, `Block ${height} not found`);
    }

    // Cache for 60 seconds (blocks are immutable)
    await cacheService.set(cacheKey, block, 60);

    res.json(block);
  }),
);

/**
 * @swagger
 * /v1/blocks/{height}/transactions:
 *   get:
 *     summary: Get transactions in a block
 *     tags: [Blocks]
 *     parameters:
 *       - in: path
 *         name: height
 *         required: true
 *         schema:
 *           type: integer
 *         description: Block height
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
 *     responses:
 *       200:
 *         description: Block transactions
 */
router.get(
  "/:height/transactions",
  [
    blockHeightValidator,
    query("limit").optional().isInt({ min: 1, max: 100 }).toInt(),
    query("offset")
      .optional()
      .isInt({ min: 0, max: MAX_PUBLIC_PAGINATION_OFFSET })
      .toInt(),
    validate,
  ],
  asyncHandler(async (req: Request, res: Response) => {
    const height = Number(req.params.height);
    const { limit = 50, offset = 0 } = req.query as {
      limit?: number;
      offset?: number;
    };

    if (!Number.isInteger(height) || height < 1) {
      throw new ApiError(400, "Invalid block height");
    }

    const cacheKey = `blocks:${height}:txs:${limit}:${offset}`;
    const cached = await cacheService.get(cacheKey);

    if (cached) {
      return res.json(cached);
    }

    const result = await blockchainService.getBlockTransactions(height, {
      limit,
      offset,
    });

    // Cache for 60 seconds
    await cacheService.set(cacheKey, result, 60);

    res.json(result);
  }),
);

export { router as blocksRouter };
