/**
 * Reconciliation API Routes
 */

import { Router, Request, Response } from 'express';
import { query } from 'express-validator';
import { container } from 'tsyringe';
import { CacheService } from '../../services/CacheService';
import { ReconciliationService } from '../../services/ReconciliationService';
import { validate } from '../../middleware/validate';
import { asyncHandler } from '../../utils/asyncHandler';

const router = Router();
const cacheService = container.resolve(CacheService);
const reconciliationService = container.resolve(ReconciliationService);

/**
 * @swagger
 * /v1/reconciliation/live:
 *   get:
 *     summary: Build a live reconciliation document from current chain/indexed state
 *     tags: [Reconciliation]
 *     parameters:
 *       - in: query
 *         name: validator_limit
 *         schema:
 *           type: integer
 *           default: 200
 *           maximum: 500
 *         description: Maximum number of validators to include in the live universe snapshot
 *     responses:
 *       200:
 *         description: Live reconciliation document
 */
router.get(
  '/live',
  [
    query('validator_limit').optional().isInt({ min: 1, max: 500 }).toInt(),
    validate,
  ],
  asyncHandler(async (req: Request, res: Response) => {
    const validatorLimit = Number(req.query.validator_limit ?? 200);
    const cacheKey = `reconciliation:live:${validatorLimit}`;
    const cached = await cacheService.get(cacheKey);

    if (cached) {
      return res.json(cached);
    }

    const result = await reconciliationService.getLiveDocument({
      validatorLimit,
    });

    await cacheService.set(cacheKey, result, 5);
    res.json(result);
  })
);

export { router as reconciliationRouter };
