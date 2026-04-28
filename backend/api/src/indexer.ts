/**
 * Aethelred API Indexer Worker — Entry point
 *
 * Runs the blockchain indexer without starting the HTTP API gateway. This is
 * used by production deployment scaffolding so API replicas do not each run
 * their own indexer loop.
 */

import 'reflect-metadata';
import { container } from 'tsyringe';

import { BlockchainService } from './services/BlockchainService';
import { IndexerService } from './services/IndexerService';
import { logger } from './utils/logger';

let shuttingDown = false;

async function shutdown(
  signal: string,
  indexerService: IndexerService,
  blockchainService: BlockchainService,
): Promise<void> {
  if (shuttingDown) {
    logger.warn(`Duplicate ${signal} received; shutdown already in progress`);
    return;
  }

  shuttingDown = true;
  logger.info(`Received ${signal}. Shutting down indexer worker...`);

  try {
    await indexerService.shutdown();
  } catch (error) {
    logger.error('Error while shutting down indexer service:', error);
  }

  try {
    await blockchainService.disconnect();
  } catch (error) {
    logger.error('Error while disconnecting blockchain service:', error);
  }

  logger.info('Indexer worker shutdown complete');
}

async function main(): Promise<void> {
  const blockchainService = container.resolve(BlockchainService);
  const indexerService = container.resolve(IndexerService);

  await blockchainService.initialize();
  await indexerService.initialize();

  process.on('SIGTERM', () => {
    void shutdown('SIGTERM', indexerService, blockchainService).then(() =>
      process.exit(0),
    );
  });
  process.on('SIGINT', () => {
    void shutdown('SIGINT', indexerService, blockchainService).then(() =>
      process.exit(0),
    );
  });

  process.on('uncaughtException', (error) => {
    logger.error('Uncaught exception in indexer worker:', error);
    void shutdown('uncaughtException', indexerService, blockchainService).then(() =>
      process.exit(1),
    );
  });
  process.on('unhandledRejection', (reason) => {
    logger.error('Unhandled rejection in indexer worker:', reason);
    void shutdown('unhandledRejection', indexerService, blockchainService).then(() =>
      process.exit(1),
    );
  });

  logger.info('Indexer worker started');
}

main().catch((error) => {
  logger.error('Failed to start indexer worker:', error);
  process.exit(1);
});
