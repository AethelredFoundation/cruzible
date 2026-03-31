/**
 * AI Jobs API Routes
 */

import { Router, Request, Response } from 'express';
import { query, param } from 'express-validator';
import { container } from 'tsyringe';
import { JobsService } from '../../services/JobsService';
import { CacheService } from '../../services/CacheService';
import { asyncHandler } from '../../utils/asyncHandler';
import { ApiError } from '../../utils/ApiError';
import { validate } from '../../middleware/validate';

const router = Router();
const jobsService = container.resolve(JobsService);
const cacheService = container.resolve(CacheService);

/**
 * @swagger
 * /v1/jobs:
 *   get:
 *     summary: Get AI jobs list
 *     tags: [AI Jobs]
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
 *           enum: [pending, assigned, computing, completed, verified, failed, expired, cancelled]
 *       - in: query
 *         name: model_hash
 *         schema:
 *           type: string
 *       - in: query
 *         name: creator
 *         schema:
 *           type: string
 *       - in: query
 *         name: sort
 *         schema:
 *           type: string
 *           default: created_at:desc
 *     responses:
 *       200:
 *         description: List of AI jobs
 */
router.get('/',
  [
    query('limit').optional().isInt({ min: 1, max: 100 }).toInt(),
    query('offset').optional().isInt({ min: 0 }).toInt(),
    query('status').optional().isIn([
      'pending', 'assigned', 'computing', 'completed', 
      'verified', 'failed', 'expired', 'cancelled'
    ]),
    query('model_hash').optional().isString().trim(),
    query('creator').optional().isString().trim(),
    query('sort').optional().isString(),
    validate,
  ],
  asyncHandler(async (req: Request, res: Response) => {
    const {
      limit = 20,
      offset = 0,
      status,
      model_hash,
      creator,
      sort = 'created_at:desc',
    } = req.query;

    const cacheKey = `jobs:list:${limit}:${offset}:${status || 'all'}:${model_hash || 'all'}:${creator || 'all'}:${sort}`;
    const cached = await cacheService.get(cacheKey);
    
    if (cached) {
      return res.json(cached);
    }

    const result = await jobsService.getJobs({
      limit: Number(limit),
      offset: Number(offset),
      status: status as string,
      modelHash: model_hash as string,
      creator: creator as string,
      sort: sort as string,
    });
    
    // Cache for 2 seconds (jobs update frequently)
    await cacheService.set(cacheKey, result, 2);
    
    res.json(result);
  })
);

/**
 * @swagger
 * /v1/jobs/stats:
 *   get:
 *     summary: Get AI job statistics
 *     tags: [AI Jobs]
 *     responses:
 *       200:
 *         description: Job statistics
 */
router.get('/stats',
  asyncHandler(async (req: Request, res: Response) => {
    const cacheKey = 'jobs:stats';
    const cached = await cacheService.get(cacheKey);
    
    if (cached) {
      return res.json(cached);
    }

    const stats = await jobsService.getJobStats();
    
    // Cache for 10 seconds
    await cacheService.set(cacheKey, stats, 10);
    
    res.json(stats);
  })
);

/**
 * @swagger
 * /v1/jobs/pricing:
 *   get:
 *     summary: Get current job pricing
 *     tags: [AI Jobs]
 *     parameters:
 *       - in: query
 *         name: model_hash
 *         schema:
 *           type: string
 *       - in: query
 *         name: estimated_cpu_cycles
 *         schema:
 *           type: integer
 *       - in: query
 *         name: estimated_memory_mb
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Pricing information
 */
router.get('/pricing',
  asyncHandler(async (req: Request, res: Response) => {
    const { model_hash, estimated_cpu_cycles, estimated_memory_mb } = req.query;
    
    const pricing = await jobsService.getPricing({
      modelHash: model_hash as string,
      estimatedCpuCycles: estimated_cpu_cycles ? Number(estimated_cpu_cycles) : undefined,
      estimatedMemoryMb: estimated_memory_mb ? Number(estimated_memory_mb) : undefined,
    });
    
    res.json(pricing);
  })
);

/**
 * @swagger
 * /v1/jobs/{id}:
 *   get:
 *     summary: Get job by ID
 *     tags: [AI Jobs]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Job details
 *       404:
 *         description: Job not found
 */
router.get('/:id',
  [param('id').isString().trim().notEmpty(), validate],
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;

    const cacheKey = `jobs:${id}`;
    const cached = await cacheService.get(cacheKey);
    
    if (cached) {
      return res.json(cached);
    }

    const job = await jobsService.getJobById(id);
    
    if (!job) {
      throw new ApiError(404, `Job ${id} not found`);
    }
    
    // Cache for 5 seconds
    await cacheService.set(cacheKey, job, 5);
    
    res.json(job);
  })
);

/**
 * @swagger
 * /v1/jobs/{id}/verifications:
 *   get:
 *     summary: Get verification attempts for a job
 *     tags: [AI Jobs]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Verification attempts
 */
router.get('/:id/verifications',
  [param('id').isString().trim().notEmpty(), validate],
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    
    const verifications = await jobsService.getJobVerifications(id);
    res.json(verifications);
  })
);

/**
 * @swagger
 * /v1/jobs/queue:
 *   get:
 *     summary: Get current job queue
 *     tags: [AI Jobs]
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 50
 *     responses:
 *       200:
 *         description: Job queue
 */
router.get('/queue',
  asyncHandler(async (req: Request, res: Response) => {
    const { limit = 50 } = req.query;
    
    const queue = await jobsService.getJobQueue(Number(limit));
    res.json(queue);
  })
);

export { router as jobsRouter };
