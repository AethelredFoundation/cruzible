/**
 * Aethelred API Gateway — Entry point
 *
 * Thin entry point that imports the side-effect-free server factory and
 * starts it.  All logic lives in server.ts so the server can be imported
 * and tested without triggering `listen()` or `process.exit()`.
 */

import { createAppServer } from './server';
import { logger } from './utils/logger';

async function main(): Promise<void> {
  try {
    const api = createAppServer();
    await api.start();
  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
}

main();
