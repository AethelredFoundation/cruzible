/**
 * API v1 Routes
 */

import { Router } from 'express';
import { blocksRouter } from './blocks';
import { jobsRouter } from './jobs';
import { reconciliationRouter } from './reconciliation';
import { alertsRouter, reconciliationStatusRouter } from './alerts';
import { stablecoinsRouter } from './stablecoins';
import { modelsRouter } from './models';
import { sealsRouter } from './seals';
import { validatorsRouter } from './validators';
import { authRouter } from './auth';

const router = Router();

router.use('/auth', authRouter);
router.use('/blocks', blocksRouter);
router.use('/jobs', jobsRouter);
router.use('/reconciliation', reconciliationRouter);
router.use('/reconciliation', reconciliationStatusRouter);
router.use('/alerts', alertsRouter);
router.use('/stablecoins', stablecoinsRouter);
router.use('/models', modelsRouter);
router.use('/seals', sealsRouter);
router.use('/validators', validatorsRouter);

export { router };
