import type { NextFunction, Request, Response } from 'express';
import { collectDefaultMetrics, Counter, Gauge, Histogram, Registry } from 'prom-client';

const registry = new Registry();

collectDefaultMetrics({
  prefix: 'cruzible_api_',
  register: registry,
});

const httpRequestsTotal = new Counter({
  name: 'cruzible_api_http_requests_total',
  help: 'Total HTTP requests served by the Cruzible API',
  labelNames: ['method', 'route', 'status_code'] as const,
  registers: [registry],
});

const httpRequestDurationSeconds = new Histogram({
  name: 'cruzible_api_http_request_duration_seconds',
  help: 'HTTP request duration in seconds for the Cruzible API',
  labelNames: ['method', 'route', 'status_code'] as const,
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
  registers: [registry],
});

const httpInFlightRequests = new Gauge({
  name: 'cruzible_api_http_in_flight_requests',
  help: 'Current number of in-flight HTTP requests handled by the Cruzible API',
  registers: [registry],
});

export function metricsMiddleware(req: Request, res: Response, next: NextFunction): void {
  const endTimer = httpRequestDurationSeconds.startTimer();
  httpInFlightRequests.inc();

  res.on('finish', () => {
    const labels = {
      method: req.method,
      route: getRouteLabel(req),
      status_code: String(res.statusCode),
    };

    httpInFlightRequests.dec();
    httpRequestsTotal.inc(labels);
    endTimer(labels);
  });

  next();
}

export async function metricsHandler(_req: Request, res: Response): Promise<void> {
  res.setHeader('Content-Type', registry.contentType);
  res.send(await registry.metrics());
}

export function resetMetricsForTests(): void {
  registry.resetMetrics();
}

function getRouteLabel(req: Request): string {
  const routePath = routePathToString(req.route?.path);
  const baseUrl = req.baseUrl || '';

  if (routePath) {
    return normalizeRouteLabel(`${baseUrl}${routePath === '/' ? '' : routePath}`);
  }

  return normalizeRouteLabel(req.path || req.originalUrl || 'unknown');
}

function routePathToString(routePath: unknown): string | null {
  if (typeof routePath === 'string') {
    return routePath;
  }

  if (routePath instanceof RegExp) {
    return routePath.source;
  }

  return null;
}

function normalizeRouteLabel(path: string): string {
  const normalized = path
    .replace(/\/0x[a-fA-F0-9]{40}/g, '/:address')
    .replace(/\/[a-fA-F0-9]{32,}/g, '/:id')
    .replace(/\/\d+/g, '/:id')
    .replace(/\/+/g, '/');

  return normalized === '' ? '/' : normalized;
}
