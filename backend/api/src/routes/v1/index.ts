/**
 * API v1 Routes
 */

import { Router } from 'express';
import { blocksRouter } from './blocks';
import { jobsRouter } from './jobs';
import { reconciliationRouter } from './reconciliation';
import { alertsRouter, reconciliationStatusRouter } from './alerts';
import { stablecoinsRouter } from './stablecoins';

const router = Router();

// Mount only the route surface that exists in this workspace snapshot.
router.use('/blocks', blocksRouter);
router.use('/jobs', jobsRouter);
router.use('/reconciliation', reconciliationRouter);
router.use('/reconciliation', reconciliationStatusRouter);
router.use('/alerts', alertsRouter);
router.use('/stablecoins', stablecoinsRouter);

export { router };
