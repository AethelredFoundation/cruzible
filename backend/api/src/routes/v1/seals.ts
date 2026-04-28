/**
 * Digital seals API routes.
 */

import { Router, Request, Response } from 'express';
import { param, query } from 'express-validator';
import { container } from 'tsyringe';
import { CacheService } from '../../services/CacheService';
import { SealsService } from '../../services/SealsService';
import { asyncHandler } from '../../utils/asyncHandler';
import { validate } from '../../middleware/validate';
import { ApiError } from '../../utils/ApiError';

const router = Router();
const sealsService = container.resolve(SealsService);
const cacheService = container.resolve(CacheService);

const SEAL_STATUSES = ['active', 'revoked', 'expired', 'superseded'] as const;
const SEAL_SORT_FIELDS = ['created_at', 'expires_at'] as const;

function isAllowedSort(value: unknown, allowedFields: readonly string[]): boolean {
  if (typeof value !== 'string' || value.length === 0) {
    return false;
  }

  const [field, direction = 'desc'] = value.split(':');
  return allowedFields.includes(field) && ['asc', 'desc'].includes(direction);
}

/**
 * @swagger
 * /v1/seals:
 *   get:
 *     summary: Get digital seals list
 *     tags: [Seals]
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 20
 *           maximum: 100
 *       - in: query
 *         name: offset
 *         schema:
 *           type: integer
 *           default: 0
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [active, revoked, expired, superseded]
 *       - in: query
 *         name: requester
 *         schema:
 *           type: string
 *       - in: query
 *         name: job_id
 *         schema:
 *           type: string
 *       - in: query
 *         name: sort
 *         schema:
 *           type: string
 *           default: created_at:desc
 *     responses:
 *       200:
 *         description: List of digital seals
 */
router.get(
  '/',
  [
    query('limit').optional().isInt({ min: 1, max: 100 }).toInt(),
    query('offset').optional().isInt({ min: 0 }).toInt(),
    query('status').optional().isIn(SEAL_STATUSES),
    query('requester').optional().isString().trim().notEmpty(),
    query('job_id').optional().isString().trim().notEmpty(),
    query('sort')
      .optional()
      .custom((value) => isAllowedSort(value, SEAL_SORT_FIELDS))
      .withMessage(`sort must be one of: ${SEAL_SORT_FIELDS.join(', ')} with :asc or :desc`),
    validate,
  ],
  asyncHandler(async (req: Request, res: Response) => {
    const {
      limit = 20,
      offset = 0,
      status,
      requester,
      job_id,
      sort = 'created_at:desc',
    } = req.query as {
      limit?: number;
      offset?: number;
      status?: string;
      requester?: string;
      job_id?: string;
      sort?: string;
    };

    const cacheKey = [
      'seals:list',
      limit,
      offset,
      status ?? 'all',
      requester ?? 'all',
      job_id ?? 'all',
      sort,
    ].join(':');

    const cached = await cacheService.get(cacheKey);
    if (cached) {
      return res.json(cached);
    }

    const result = await sealsService.getSeals({
      limit,
      offset,
      status,
      requester,
      jobId: job_id,
      sort,
    });

    await cacheService.set(cacheKey, result, 15);
    res.json(result);
  }),
);

/**
 * @swagger
 * /v1/seals/{id}:
 *   get:
 *     summary: Get a digital seal by ID
 *     tags: [Seals]
 */
router.get(
  '/:id',
  [param('id').isString().trim().notEmpty().isLength({ max: 128 }), validate],
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const cacheKey = `seals:${id}`;

    const cached = await cacheService.get(cacheKey);
    if (cached) {
      return res.json(cached);
    }

    const seal = await sealsService.getSealById(id);
    if (!seal) {
      throw new ApiError(404, `Seal ${id} not found`);
    }

    await cacheService.set(cacheKey, seal, 15);
    res.json(seal);
  }),
);

export { router as sealsRouter };
