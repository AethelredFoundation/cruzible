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
    vi.doUnmock('ioredis');
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

  it('skips /metrics from rate limiting', async () => {
    const { rateLimiter } = await import('../src/middleware/rateLimiter');

    const app = express();
    app.use(rateLimiter);
    app.get('/metrics', (_req, res) => {
      res.type('text/plain').send('ok');
    });

    await withHttpServer(app, async (baseUrl) => {
      for (let i = 0; i < 4; i += 1) {
        const response = await fetch(`${baseUrl}/metrics`);
        expect(response.status).toBe(200);
      }
    });
  });

  it('uses Redis-backed counters when configured with a Redis URL', async () => {
    vi.resetModules();
    const counters = new Map<string, { hits: number; resetAt: number }>();
    const redisInstances: Array<{ url: string; options: Record<string, unknown> }> = [];

    vi.doMock('ioredis', () => ({
      default: class MockRedis {
        constructor(url: string, options: Record<string, unknown>) {
          redisInstances.push({ url, options });
        }

        on() {
          return this;
        }

        async eval(
          script: string,
          _keyCount: number,
          key: string,
          windowMs?: string,
        ) {
          if (script.includes('INCR')) {
            const now = Date.now();
            const current = counters.get(key);
            const resetAt =
              current && current.resetAt > now
                ? current.resetAt
                : now + Number(windowMs);
            const hits = (current?.resetAt ?? 0) > now ? current.hits + 1 : 1;
            counters.set(key, { hits, resetAt });

            return [hits, Math.max(1, resetAt - now)];
          }

          if (script.includes('DECR')) {
            const current = counters.get(key);
            const hits = Math.max(0, (current?.hits ?? 0) - 1);
            if (hits === 0) {
              counters.delete(key);
            } else if (current) {
              counters.set(key, { ...current, hits });
            }
            return hits;
          }

          return null;
        }

        async del(key: string) {
          counters.delete(key);
        }
      },
    }));

    const { createRedisRateLimitStore } = await import(
      '../src/middleware/rateLimiter'
    );

    const store = createRedisRateLimitStore({
      prefix: 'global',
      redisUrl: 'redis://localhost:6379',
      windowMs: 60_000,
    });

    expect(store).toBeDefined();

    const first = await store!.increment('client-ip');
    const second = await store!.increment('client-ip');

    await store!.decrement('client-ip');
    await store!.resetKey('client-ip');

    expect(first.totalHits).toBe(1);
    expect(second.totalHits).toBe(2);
    expect(redisInstances).toHaveLength(1);
    expect(redisInstances[0]).toMatchObject({
      url: 'redis://localhost:6379',
    });
    expect([...counters.keys()]).toHaveLength(0);
  });
});
