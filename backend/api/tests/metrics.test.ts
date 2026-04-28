import express from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { withHttpServer } from './helpers/http';

afterEach(() => {
  vi.resetModules();
});

describe('metrics middleware', () => {
  it('records HTTP request counters and latency buckets', async () => {
    const { metricsHandler, metricsMiddleware, resetMetricsForTests } = await import(
      '../src/middleware/metrics'
    );

    resetMetricsForTests();

    const app = express();
    app.use(metricsMiddleware);
    app.get('/validators/:address', (_req, res) => {
      res.status(201).json({ ok: true });
    });
    app.get('/metrics', metricsHandler);

    await withHttpServer(app, async (baseUrl) => {
      const response = await fetch(
        `${baseUrl}/validators/0x1111111111111111111111111111111111111111`,
      );
      const metrics = await fetch(`${baseUrl}/metrics`);
      const body = await metrics.text();

      expect(response.status).toBe(201);
      expect(metrics.status).toBe(200);
      expect(metrics.headers.get('content-type')).toContain('text/plain');
      expect(metrics.headers.get('content-type')).toContain('version=0.0.4');
      expect(body).toContain('cruzible_api_http_requests_total');
      expect(body).toContain(
        'method="GET",route="/validators/:address",status_code="201"',
      );
      expect(body).toContain('cruzible_api_http_request_duration_seconds_bucket');
      expect(body).toContain('cruzible_api_http_in_flight_requests');
    });
  });
});
