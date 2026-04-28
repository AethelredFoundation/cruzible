import express from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { withHttpServer } from './helpers/http';

const OPERATIONAL_TOKEN = '12345678901234567890123456789012';

describe('operational access middleware', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.resetModules();
  });

  async function mountProtectedRoute(options: {
    isProduction: boolean;
    operationalEndpointsToken?: string;
  }) {
    const { config } = await import('../src/config');
    (config as any).isProduction = options.isProduction;
    (config as any).operationalEndpointsToken =
      options.operationalEndpointsToken;

    const { requireOperationalAccess } = await import(
      '../src/middleware/operationalAccess'
    );
    const app = express();
    app.get('/metrics', requireOperationalAccess, (_req, res) => {
      res.type('text/plain').send('ok');
    });

    return app;
  }

  it('allows local operational requests without a token', async () => {
    const app = await mountProtectedRoute({ isProduction: false });

    await withHttpServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/metrics`);

      expect(response.status).toBe(200);
      expect(await response.text()).toBe('ok');
    });
  });

  it('rejects production operational requests without a token', async () => {
    const app = await mountProtectedRoute({
      isProduction: true,
      operationalEndpointsToken: OPERATIONAL_TOKEN,
    });

    await withHttpServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/metrics`);
      const body = await response.json();

      expect(response.status).toBe(401);
      expect(response.headers.get('cache-control')).toBe('no-store');
      expect(body.error).toBe('Unauthorized');
    });
  });

  it('accepts production bearer and explicit operational tokens', async () => {
    const app = await mountProtectedRoute({
      isProduction: true,
      operationalEndpointsToken: OPERATIONAL_TOKEN,
    });

    await withHttpServer(app, async (baseUrl) => {
      const bearerResponse = await fetch(`${baseUrl}/metrics`, {
        headers: { authorization: `Bearer ${OPERATIONAL_TOKEN}` },
      });
      const explicitHeaderResponse = await fetch(`${baseUrl}/metrics`, {
        headers: { 'x-operational-token': OPERATIONAL_TOKEN },
      });

      expect(bearerResponse.status).toBe(200);
      expect(await bearerResponse.text()).toBe('ok');
      expect(explicitHeaderResponse.status).toBe(200);
      expect(await explicitHeaderResponse.text()).toBe('ok');
    });
  });
});
