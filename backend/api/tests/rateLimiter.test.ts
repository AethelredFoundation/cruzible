import express from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { withHttpServer } from './helpers/http';

const originalEnv = { ...process.env };

describe('rate limiter', () => {
  beforeEach(() => {
    vi.resetModules();
    process.env = {
      ...originalEnv,
      RATE_LIMIT_WINDOW_MS: '60000',
      RATE_LIMIT_MAX: '2',
    };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.resetModules();
  });

  it('returns 429 after the configured request budget is exhausted', async () => {
    const { rateLimiter } = await import('../src/middleware/rateLimiter');

    const app = express();
    app.use(rateLimiter);
    app.get('/limited', (_req, res) => {
      res.json({ ok: true });
    });

    await withHttpServer(app, async (baseUrl) => {
      const first = await fetch(`${baseUrl}/limited`);
      const second = await fetch(`${baseUrl}/limited`);
      const third = await fetch(`${baseUrl}/limited`);
      const body = await third.json();

      expect(first.status).toBe(200);
      expect(second.status).toBe(200);
      expect(third.status).toBe(429);
      expect(body.error).toBe('TooManyRequests');
    });
  });

  it('skips /health from rate limiting', async () => {
    const { rateLimiter } = await import('../src/middleware/rateLimiter');

    const app = express();
    app.use(rateLimiter);
    app.get('/health', (_req, res) => {
      res.json({ ok: true });
    });

    await withHttpServer(app, async (baseUrl) => {
      for (let i = 0; i < 4; i += 1) {
        const response = await fetch(`${baseUrl}/health`);
        expect(response.status).toBe(200);
      }
    });
  });
});
