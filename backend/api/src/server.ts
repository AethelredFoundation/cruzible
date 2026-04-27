/**
 * Aethelred API Gateway — Server factory
 *
 * This module exports the ApiGateway class and a `createAppServer()` factory
 * function with ZERO module-level side effects.  The actual server startup
 * lives in index.ts (the thin entry point) which calls `main()`.
 *
 * Keeping the factory side-effect-free makes it straightforward to:
 *   - Test startup / shutdown / graceful-drain without spawning a real server
 *   - Import the class in integration tests without triggering `listen()`
 *   - Compose the server inside Docker health-check harnesses
 */

import 'reflect-metadata';
import express, { Application, Request, Response, NextFunction } from 'express';
import { createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import hpp from 'hpp';
import swaggerUi from 'swagger-ui-express';
import { container } from 'tsyringe';
import { logger } from './utils/logger';
import { config } from './config';
import { swaggerSpec } from './config/swagger';
import { errorHandler } from './middleware/errorHandler';
import { rateLimiter } from './middleware/rateLimiter';
import { metricsHandler, metricsMiddleware } from './middleware/metrics';
import { requestId } from './middleware/requestId';
import { requestLogger } from './middleware/requestLogger';

// Routes
import { router as v1Router } from './routes/v1';
import { router as healthRouter } from './routes/health';

// WebSocket handlers
import { WebSocketManager } from './websocket/WebSocketManager';

// Services
import { BlockchainService } from './services/BlockchainService';
import { CacheService } from './services/CacheService';
import { IndexerService } from './services/IndexerService';
import { ReconciliationScheduler } from './services/ReconciliationScheduler';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Timeout (ms) for forced shutdown after graceful attempt. */
const FORCED_SHUTDOWN_TIMEOUT_MS = 30_000;

// ---------------------------------------------------------------------------
// ApiGateway
// ---------------------------------------------------------------------------

export class ApiGateway {
  public app: Application;
  public httpServer: ReturnType<typeof createServer>;
  public io: SocketIOServer;
  private wsManager: WebSocketManager;

  /**
   * Track in-flight requests so we can drain them during shutdown.
   */
  private inFlightRequests = 0;
  private isShuttingDown = false;

  constructor() {
    this.app = express();
    this.httpServer = createServer(this.app);
    this.io = new SocketIOServer(this.httpServer, {
      cors: {
        origin: config.corsOrigins,
        credentials: true,
      },
      pingTimeout: 60000,
      pingInterval: 25000,
    });
    this.wsManager = new WebSocketManager(this.io);
    this.initialize();
  }

  private initialize(): void {
    this.initializeMiddleware();
    this.initializeRoutes();
    this.initializeWebSocket();
    this.initializeErrorHandling();
  }

  private initializeMiddleware(): void {
    this.app.disable('x-powered-by');
    this.app.set('trust proxy', config.trustProxy);

    // -----------------------------------------------------------------------
    // Security headers (helmet) — hardened CSP for production
    // -----------------------------------------------------------------------
    this.app.use(
      helmet({
        contentSecurityPolicy: {
          directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'"], // swagger-ui needs inline styles
            imgSrc: ["'self'", 'data:'],
            connectSrc: ["'self'"],
            fontSrc: ["'self'"],
            objectSrc: ["'none'"],
            mediaSrc: ["'none'"],
            frameSrc: ["'none'"],
            baseUri: ["'self'"],
            formAction: ["'self'"],
            frameAncestors: ["'none'"], // equivalent to X-Frame-Options: DENY
            ...(config.isProduction ? { upgradeInsecureRequests: [] } : {}),
          },
        },
        crossOriginEmbedderPolicy: config.isProduction,
        crossOriginOpenerPolicy: { policy: 'same-origin' },
        crossOriginResourcePolicy: { policy: 'same-origin' },
        dnsPrefetchControl: { allow: false },
        frameguard: { action: 'deny' },
        hidePoweredBy: true,
        hsts: config.isProduction
          ? { maxAge: 63072000, includeSubDomains: true, preload: true }
          : false,
        ieNoOpen: true,
        noSniff: true,
        referrerPolicy: { policy: 'no-referrer' },
        xssFilter: true,
      }),
    );

    // Permissions-Policy: disable camera, microphone, geolocation, and other
    // dangerous browser APIs.
    this.app.use((_req: Request, res: Response, next: NextFunction) => {
      res.setHeader(
        'Permissions-Policy',
        'camera=(), microphone=(), geolocation=(), interest-cohort=(), ' +
          'payment=(), usb=(), magnetometer=(), gyroscope=(), accelerometer=()',
      );
      next();
    });

    // Prevent HTTP Parameter Pollution
    this.app.use(hpp());

    // CORS
    this.app.use(
      cors({
        origin: config.corsOrigins,
        credentials: true,
        methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
        allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-ID'],
      }),
    );

    // Compression
    this.app.use(compression());

    // Request ID (must come before the logger so the ID is available)
    this.app.use(requestId);

    // -----------------------------------------------------------------------
    // API versioning & informational response headers
    // -----------------------------------------------------------------------
    this.app.use((req: Request, res: Response, next: NextFunction) => {
      res.setHeader('X-API-Version', config.version);
      // X-Request-ID is already set by the requestId middleware;
      // we just verify it exists.
      if (!res.getHeader('x-request-id') && req.requestId) {
        res.setHeader('X-Request-ID', req.requestId);
      }
      next();
    });

    // -----------------------------------------------------------------------
    // Connection draining — reject new requests during shutdown
    // -----------------------------------------------------------------------
    this.app.use((req: Request, res: Response, next: NextFunction) => {
      if (this.isShuttingDown) {
        res.setHeader('Connection', 'close');
        res.status(503).json({
          error: 'ServiceUnavailable',
          message: 'Server is shutting down',
          requestId: req.requestId,
        });
        return;
      }

      // Track in-flight requests
      this.inFlightRequests++;
      res.on('finish', () => {
        this.inFlightRequests--;
      });

      next();
    });

    // Structured request logging (replaces morgan for JSON logs)
    this.app.use(requestLogger);

    // Metrics
    this.app.use(metricsMiddleware);

    // Body parsing
    this.app.use(express.json({ limit: '1mb' }));
    this.app.use(express.urlencoded({ extended: false, limit: '1mb', parameterLimit: 100 }));

    // Rate limiting
    this.app.use(rateLimiter);
  }

  private initializeRoutes(): void {
    // Prometheus scrape endpoint (no rate limit)
    this.app.get('/metrics', metricsHandler);

    // Health check (no rate limit)
    this.app.use('/health', healthRouter);

    // API documentation
    this.app.use(
      '/docs',
      swaggerUi.serve,
      swaggerUi.setup(swaggerSpec, {
        explorer: true,
        customCss: '.swagger-ui .topbar { display: none }',
        customSiteTitle: 'Aethelred API Documentation',
      }),
    );

    // API routes
    this.app.use('/v1', v1Router);

    // Default route
    this.app.get('/', (req: Request, res: Response) => {
      res.json({
        name: 'Aethelred API Gateway',
        version: config.version,
        environment: config.env,
        documentation: '/docs',
        health: '/health',
        api: '/v1',
      });
    });

    // 404 handler
    this.app.use((req: Request, res: Response) => {
      res.status(404).json({
        error: 'Not Found',
        message: `Cannot ${req.method} ${req.path}`,
        requestId: req.requestId,
      });
    });
  }

  private initializeWebSocket(): void {
    this.wsManager.initialize();
    logger.info('WebSocket server initialized');
  }

  private initializeErrorHandling(): void {
    this.app.use(errorHandler);
  }

  /**
   * Start the server: initialize services, bind to `config.port`, and wire
   * up graceful shutdown handlers.
   *
   * Throws on fatal startup errors instead of calling `process.exit()` so
   * callers (including tests) can handle the failure programmatically.
   */
  public async start(): Promise<void> {
    // Initialize services
    const cacheService = container.resolve(CacheService);
    await cacheService.connect();

    const blockchainService = container.resolve(BlockchainService);
    await blockchainService.initialize();

    // Initialize indexer conditionally
    if (config.indexerEnabled) {
      const indexerService = container.resolve(IndexerService);
      await indexerService.initialize();
      logger.info('Blockchain indexer started');
    } else {
      logger.info('Blockchain indexer disabled (INDEXER_ENABLED=false)');
    }

    // Start reconciliation scheduler
    const reconciliationScheduler = container.resolve(ReconciliationScheduler);
    reconciliationScheduler.start();
    logger.info('Reconciliation scheduler started');

    // Start server
    await new Promise<void>((resolve) => {
      this.httpServer.listen(config.port, () => {
        logger.info(`API Gateway running on port ${config.port}`);
        logger.info(`API Documentation: http://localhost:${config.port}/docs`);
        logger.info(`WebSocket: ws://localhost:${config.port}`);
        logger.info(`Connected to: ${config.rpcUrl}`);
        resolve();
      });
    });

    // Graceful shutdown
    this.setupGracefulShutdown();
  }

  /**
   * Shut down the server programmatically (for tests and orchestration).
   * Mirrors the signal-handler logic but does not call `process.exit()`.
   */
  public async shutdown(): Promise<void> {
    if (this.isShuttingDown) return;
    this.isShuttingDown = true;

    logger.info('ApiGateway.shutdown() called — draining connections');

    // 1. Stop accepting new connections
    await new Promise<void>((resolve) => {
      this.httpServer.close(() => resolve());
    });

    // 2. Close WebSocket
    try {
      this.io.emit('server:shutdown', { reason: 'programmatic' });
      await new Promise<void>((resolve) => {
        this.io.close(() => resolve());
      });
    } catch {
      // best-effort
    }

    // 3. Drain in-flight requests (with timeout)
    const drainStart = Date.now();
    const drainTimeout = FORCED_SHUTDOWN_TIMEOUT_MS - 5000;
    await new Promise<void>((resolve) => {
      const checkDrained = () => {
        if (this.inFlightRequests <= 0 || Date.now() - drainStart > drainTimeout) {
          resolve();
          return;
        }
        setTimeout(checkDrained, 100);
      };
      checkDrained();
    });

    // 4. Disconnect services
    try {
      try {
        const reconciliationScheduler = container.resolve(ReconciliationScheduler);
        reconciliationScheduler.stop();
      } catch {
        // may not be registered
      }

      if (config.indexerEnabled) {
        try {
          const indexerService = container.resolve(IndexerService);
          await indexerService.shutdown();
        } catch {
          // may not be registered
        }
      }

      try {
        const cacheService = container.resolve(CacheService);
        await cacheService.disconnect();
      } catch {
        // may not be registered
      }

      try {
        const blockchainService = container.resolve(BlockchainService);
        await blockchainService.disconnect();
      } catch {
        // may not be registered
      }
    } catch (error) {
      logger.error('Error during service disconnection:', error);
    }

    logger.info('Shutdown complete');
  }

  // =========================================================================
  // Graceful Shutdown — production-grade connection draining
  // =========================================================================

  private setupGracefulShutdown(): void {
    let shutdownInProgress = false;

    const shutdown = async (signal: string) => {
      // Guard against double-shutdown
      if (shutdownInProgress) {
        logger.warn(`Duplicate ${signal} received — shutdown already in progress`);
        return;
      }
      shutdownInProgress = true;
      this.isShuttingDown = true;

      logger.info(`Received ${signal}. Starting graceful shutdown...`);
      logger.info(`In-flight requests: ${this.inFlightRequests}`);

      // -------------------------------------------------------------------
      // 1. Stop accepting new connections
      // -------------------------------------------------------------------
      this.httpServer.close(() => {
        logger.info('HTTP server closed — no longer accepting connections');
      });

      // -------------------------------------------------------------------
      // 2. Close WebSocket connections (notify clients)
      // -------------------------------------------------------------------
      try {
        // Emit a shutdown event so well-behaved clients can reconnect elsewhere
        this.io.emit('server:shutdown', { reason: signal });
        this.io.close(() => {
          logger.info('WebSocket server closed');
        });
      } catch (err) {
        logger.error('Error closing WebSocket server:', err);
      }

      // -------------------------------------------------------------------
      // 3. Wait for in-flight HTTP requests to drain (with timeout)
      // -------------------------------------------------------------------
      const drainStart = Date.now();
      const drainTimeout = FORCED_SHUTDOWN_TIMEOUT_MS - 5000; // leave 5s for cleanup

      await new Promise<void>((resolve) => {
        const checkDrained = () => {
          if (this.inFlightRequests <= 0) {
            logger.info('All in-flight requests drained');
            resolve();
            return;
          }
          if (Date.now() - drainStart > drainTimeout) {
            logger.warn(
              `Drain timeout reached with ${this.inFlightRequests} requests still in flight — forcing shutdown`,
            );
            resolve();
            return;
          }
          setTimeout(checkDrained, 250);
        };
        checkDrained();
      });

      // -------------------------------------------------------------------
      // 4. Disconnect backend services
      // -------------------------------------------------------------------
      try {
        // Stop reconciliation scheduler first (it depends on cache + blockchain)
        try {
          const reconciliationScheduler = container.resolve(ReconciliationScheduler);
          reconciliationScheduler.stop();
          logger.info('Reconciliation scheduler stopped');
        } catch {
          // Scheduler may not have been registered if start() failed early
        }

        if (config.indexerEnabled) {
          const indexerService = container.resolve(IndexerService);
          await indexerService.shutdown();
          logger.info('Indexer service shut down');
        }

        const cacheService = container.resolve(CacheService);
        await cacheService.disconnect();
        logger.info('Cache service disconnected');

        const blockchainService = container.resolve(BlockchainService);
        await blockchainService.disconnect();
        logger.info('Blockchain service disconnected');

        logger.info('All services disconnected');
      } catch (error) {
        logger.error('Error during service disconnection:', error);
      }

      // -------------------------------------------------------------------
      // 5. Exit
      // -------------------------------------------------------------------
      logger.info('Shutdown complete');
      process.exit(0);
    };

    // -------------------------------------------------------------------
    // Forced shutdown timeout — if graceful shutdown takes too long,
    // force-kill the process.
    // -------------------------------------------------------------------
    const forceShutdown = (signal: string) => {
      shutdown(signal);

      setTimeout(() => {
        logger.error(
          `Forced shutdown after ${FORCED_SHUTDOWN_TIMEOUT_MS / 1000}s timeout — exiting with code 1`,
        );
        process.exit(1);
      }, FORCED_SHUTDOWN_TIMEOUT_MS).unref();
    };

    process.on('SIGTERM', () => forceShutdown('SIGTERM'));
    process.on('SIGINT', () => forceShutdown('SIGINT'));

    // Handle uncaught errors
    process.on('uncaughtException', (error) => {
      logger.error('Uncaught Exception:', error);
      forceShutdown('uncaughtException');
    });

    process.on('unhandledRejection', (reason, promise) => {
      logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
      forceShutdown('unhandledRejection');
    });
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create an ApiGateway instance without starting it.
 *
 * Usage:
 *   const api = createAppServer();
 *   await api.start();          // production entry point
 *   await api.shutdown();       // programmatic teardown (tests)
 */
export function createAppServer(): ApiGateway {
  return new ApiGateway();
}
