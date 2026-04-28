/**
 * Model registry API routes.
 */

import { Router, Request, Response } from 'express';
import { param, query } from 'express-validator';
import { container } from 'tsyringe';
import { CacheService } from '../../services/CacheService';
import { ModelsService } from '../../services/ModelsService';
import { asyncHandler } from '../../utils/asyncHandler';
import { validate } from '../../middleware/validate';
import { ApiError } from '../../utils/ApiError';

const router = Router();
const modelsService = container.resolve(ModelsService);
const cacheService = container.resolve(CacheService);

const MODEL_CATEGORIES = [
  'GENERAL',
  'MEDICAL',
  'SCIENTIFIC',
  'FINANCIAL',
  'LEGAL',
  'EDUCATIONAL',
  'ENVIRONMENTAL',
] as const;

const MODEL_SORT_FIELDS = ['registered_at', 'total_jobs', 'name'] as const;

function isAllowedSort(value: unknown, allowedFields: readonly string[]): boolean {
  if (typeof value !== 'string' || value.length === 0) {
    return false;
  }

  const [field, direction = 'desc'] = value.split(':');
  return allowedFields.includes(field) && ['asc', 'desc'].includes(direction);
}

/**
 * @swagger
 * /v1/models:
 *   get:
 *     summary: Get registered AI models
 *     tags: [Models]
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
 *         name: category
 *         schema:
 *           type: string
 *           enum: [GENERAL, MEDICAL, SCIENTIFIC, FINANCIAL, LEGAL, EDUCATIONAL, ENVIRONMENTAL]
 *       - in: query
 *         name: verified
 *         schema:
 *           type: boolean
 *       - in: query
 *         name: owner
 *         schema:
 *           type: string
 *       - in: query
 *         name: sort
 *         schema:
 *           type: string
 *           default: registered_at:desc
 *     responses:
 *       200:
 *         description: List of registered models
 */
router.get(
  '/',
  [
    query('limit').optional().isInt({ min: 1, max: 100 }).toInt(),
    query('offset').optional().isInt({ min: 0 }).toInt(),
    query('category').optional().isIn(MODEL_CATEGORIES),
    query('verified').optional().isBoolean().toBoolean(),
    query('owner').optional().isString().trim().notEmpty(),
    query('sort')
      .optional()
      .custom((value) => isAllowedSort(value, MODEL_SORT_FIELDS))
      .withMessage(`sort must be one of: ${MODEL_SORT_FIELDS.join(', ')} with :asc or :desc`),
    validate,
  ],
  asyncHandler(async (req: Request, res: Response) => {
    const {
      limit = 50,
      offset = 0,
      category,
      verified,
      owner,
      sort = 'registered_at:desc',
    } = req.query as {
      limit?: number;
      offset?: number;
      category?: string;
      verified?: boolean;
      owner?: string;
      sort?: string;
    };

    const cacheKey = [
      'models:list',
      limit,
      offset,
      category ?? 'all',
      typeof verified === 'boolean' ? String(verified) : 'all',
      owner ?? 'all',
      sort,
    ].join(':');

    const cached = await cacheService.get(cacheKey);
    if (cached) {
      return res.json(cached);
    }

    const result = await modelsService.getModels({
      limit,
      offset,
      category,
      verified,
      owner,
      sort,
    });

    await cacheService.set(cacheKey, result, 30);
    res.json(result);
  }),
);

/**
 * @swagger
 * /v1/models/{modelHash}:
 *   get:
 *     summary: Get a model registry entry by hash
 *     tags: [Models]
 */
router.get(
  '/:modelHash',
  [
    param('modelHash').isString().trim().notEmpty().isLength({ max: 128 }),
    validate,
  ],
  asyncHandler(async (req: Request, res: Response) => {
    const { modelHash } = req.params;
    const cacheKey = `models:${modelHash}`;

    const cached = await cacheService.get(cacheKey);
    if (cached) {
      return res.json(cached);
    }

    const model = await modelsService.getModelByHash(modelHash);
    if (!model) {
      throw new ApiError(404, `Model ${modelHash} not found`);
    }

    await cacheService.set(cacheKey, model, 30);
    res.json(model);
  }),
);

export { router as modelsRouter };
