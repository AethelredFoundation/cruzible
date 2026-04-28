import express from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { withHttpServer } from './helpers/http';

vi.mock('../src/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { requestLogger, verboseRequestLogger } from '../src/middleware/requestLogger';
import { logger } from '../src/utils/logger';

describe('request logger redaction', () => {
  beforeEach(() => {
    vi.mocked(logger.info).mockClear();
    vi.mocked(logger.warn).mockClear();
    vi.mocked(logger.error).mockClear();
  });

  it('redacts sensitive query values from standard request logs', async () => {
    const app = express();
    app.use(requestLogger);
    app.get('/callback', (_req, res) => {
      res.json({ ok: true });
    });

    await withHttpServer(app, async (baseUrl) => {
      const response = await fetch(
        `${baseUrl}/callback?access_token=token-123&address=aeth1user&signature=sig-123`,
      );

      expect(response.status).toBe(200);
      expect(logger.info).toHaveBeenCalledWith(
        'HTTP request completed',
        expect.objectContaining({
          path: '/callback?access_token=[REDACTED]&address=aeth1user&signature=[REDACTED]',
        }),
      );
    });
  });

  it('redacts sensitive query and body values from verbose request logs', async () => {
    const app = express();
    app.use(express.json());
    app.use(verboseRequestLogger);
    app.post('/login', (_req, res) => {
      res.json({ ok: true });
    });

    await withHttpServer(app, async (baseUrl) => {
      const response = await fetch(
        `${baseUrl}/login?refresh_token=refresh-123&address=aeth1user`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message: 'Aethelred Cruzible API login\nNonce: nonce-123',
            nested: {
              privateKey: 'private-key-123',
              safe: 'visible',
            },
            signature: 'sig-123',
          }),
        },
      );

      expect(response.status).toBe(200);
      expect(logger.info).toHaveBeenCalledWith(
        'Incoming request detail',
        expect.objectContaining({
          path: '/login?refresh_token=[REDACTED]&address=aeth1user',
          query: expect.objectContaining({
            address: 'aeth1user',
            refresh_token: '[REDACTED]',
          }),
          body: expect.objectContaining({
            message: '[REDACTED]',
            nested: {
              privateKey: '[REDACTED]',
              safe: 'visible',
            },
            signature: '[REDACTED]',
          }),
        }),
      );
    });
  });
});
