import express from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { authenticate, requireRoles } from '../src/auth/middleware';
import { rateLimiter } from '../src/middleware/rateLimiter';
import { generateTokens } from '../src/auth/service';
import { withHttpServer } from './helpers/http';

const originalEnv = { ...process.env };

describe('auth middleware', () => {
  afterEach(() => {
    process.env = { ...originalEnv };
    vi.resetModules();
  });

  it('rejects requests without a bearer token', async () => {
    const app = express();
    app.use(rateLimiter);
    app.get('/protected', authenticate, (req, res) => {
      res.json({ address: req.user?.address });
    });

    await withHttpServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/protected`);
      const body = await response.json();

      expect(response.status).toBe(401);
      expect(body.message).toContain('Authorization header missing');
    });
  });

  it('accepts requests with a valid access token', async () => {
    const app = express();
    app.use(rateLimiter);
    app.get('/protected', authenticate, (req, res) => {
      res.json({ address: req.user?.address, roles: req.user?.roles });
    });

    const { accessToken } = generateTokens({
      address: 'aeth1validuser',
      roles: ['user', 'operator'],
    });

    await withHttpServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/protected`, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toEqual({
        address: 'aeth1validuser',
        roles: ['user', 'operator'],
      });
    });
  });

  it('rejects authenticated users without the required role', async () => {
    const app = express();
    app.use(rateLimiter);
    app.get('/ops', authenticate, requireRoles('operator'), (_req, res) => {
      res.json({ ok: true });
    });

    const { accessToken } = generateTokens({
      address: 'aeth1validuser',
      roles: ['user'],
    });

    await withHttpServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/ops`, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });
      const body = await response.json();

      expect(response.status).toBe(403);
      expect(body.message).toContain('Insufficient permissions');
    });
  });
});

describe('auth routes', () => {
  afterEach(() => {
    process.env = { ...originalEnv };
    vi.resetModules();
  });

  async function withAuthRoutes(
    fn: (baseUrl: string) => Promise<void>,
  ): Promise<void> {
    vi.resetModules();
    process.env = {
      ...originalEnv,
      NODE_ENV: 'test',
      ALLOW_MOCK_SIGNATURES: 'true',
      AUTH_OPERATOR_ADDRESSES: 'aeth1operator',
      AUTH_RATE_LIMIT_MAX: '100',
    };
    delete process.env.DATABASE_URL;

    const { authRouter } = await import('../src/routes/v1/auth');
    const { errorHandler } = await import('../src/middleware/errorHandler');

    const app = express();
    app.use(express.json());
    app.use('/v1/auth', authRouter);
    app.use(errorHandler);

    await withHttpServer(app, fn);
  }

  it('issues operator tokens from a one-time login challenge', async () => {
    await withAuthRoutes(async (baseUrl) => {
      const challengeResponse = await fetch(`${baseUrl}/v1/auth/nonce`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address: 'aeth1operator' }),
      });
      const challenge = await challengeResponse.json();

      const loginResponse = await fetch(`${baseUrl}/v1/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          address: 'aeth1operator',
          message: challenge.message,
          signature: 'test-signature',
        }),
      });
      const tokens = await loginResponse.json();

      expect(challengeResponse.status).toBe(200);
      expect(challengeResponse.headers.get('cache-control')).toBe('no-store');
      expect(loginResponse.headers.get('cache-control')).toBe('no-store');
      expect(loginResponse.status).toBe(200);
      expect(tokens.accessToken).toEqual(expect.any(String));
      expect(tokens.refreshToken).toEqual(expect.any(String));
      expect(tokens.expiresIn).toBe(3600);

      const replayResponse = await fetch(`${baseUrl}/v1/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          address: 'aeth1operator',
          message: challenge.message,
          signature: 'test-signature',
        }),
      });

      expect(replayResponse.status).toBe(401);
    });
  });

  it('rejects GET nonce issuance because challenges mutate auth state', async () => {
    await withAuthRoutes(async (baseUrl) => {
      const response = await fetch(
        `${baseUrl}/v1/auth/nonce?address=aeth1operator`,
      );
      const body = await response.json();

      expect(response.status).toBe(405);
      expect(response.headers.get('allow')).toBe('POST');
      expect(response.headers.get('cache-control')).toBe('no-store');
      expect(body.message).toContain('Use POST /v1/auth/nonce');
    });
  });

  it('rotates refresh tokens and rejects replay of the old token', async () => {
    await withAuthRoutes(async (baseUrl) => {
      const challenge = await (
        await fetch(`${baseUrl}/v1/auth/nonce`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ address: 'aeth1operator' }),
        })
      ).json();
      const loginTokens = await (
        await fetch(`${baseUrl}/v1/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            address: 'aeth1operator',
            message: challenge.message,
            signature: 'test-signature',
          }),
        })
      ).json();

      const refreshResponse = await fetch(`${baseUrl}/v1/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: loginTokens.refreshToken }),
      });
      const refreshedTokens = await refreshResponse.json();

      const replayResponse = await fetch(`${baseUrl}/v1/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: loginTokens.refreshToken }),
      });

      expect(refreshResponse.status).toBe(200);
      expect(refreshedTokens.refreshToken).not.toBe(loginTokens.refreshToken);
      expect(replayResponse.status).toBe(401);
    });
  });

  it('recomputes roles when refresh tokens rotate', async () => {
    await withAuthRoutes(async (baseUrl) => {
      const challenge = await (
        await fetch(`${baseUrl}/v1/auth/nonce`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ address: 'aeth1operator' }),
        })
      ).json();
      const loginTokens = await (
        await fetch(`${baseUrl}/v1/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            address: 'aeth1operator',
            message: challenge.message,
            signature: 'test-signature',
          }),
        })
      ).json();
      const { config } = await import('../src/config');
      const { verifyAccessToken } = await import('../src/auth/service');

      expect(verifyAccessToken(loginTokens.accessToken).roles).toContain(
        'operator',
      );

      (config as any).authOperatorAddresses = [];
      (config as any).authAdminAddresses = [];

      const refreshResponse = await fetch(`${baseUrl}/v1/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: loginTokens.refreshToken }),
      });
      const refreshedTokens = await refreshResponse.json();
      const refreshedPayload = verifyAccessToken(refreshedTokens.accessToken);

      expect(refreshResponse.status).toBe(200);
      expect(refreshedPayload.address).toBe('aeth1operator');
      expect(refreshedPayload.roles).toEqual(['user']);
    });
  });

  it('rejects refresh rotation from a different user-agent context', async () => {
    await withAuthRoutes(async (baseUrl) => {
      const challenge = await (
        await fetch(`${baseUrl}/v1/auth/nonce`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ address: 'aeth1operator' }),
        })
      ).json();
      const loginTokens = await (
        await fetch(`${baseUrl}/v1/auth/login`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'User-Agent': 'CruzibleWallet/1.0',
          },
          body: JSON.stringify({
            address: 'aeth1operator',
            message: challenge.message,
            signature: 'test-signature',
          }),
        })
      ).json();

      const mismatchedRefresh = await fetch(`${baseUrl}/v1/auth/refresh`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'UnexpectedClient/9.9',
        },
        body: JSON.stringify({ refresh_token: loginTokens.refreshToken }),
      });
      const matchedRefresh = await fetch(`${baseUrl}/v1/auth/refresh`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'CruzibleWallet/1.0',
        },
        body: JSON.stringify({ refresh_token: loginTokens.refreshToken }),
      });
      const matchedTokens = await matchedRefresh.json();

      expect(mismatchedRefresh.status).toBe(401);
      expect(matchedRefresh.status).toBe(200);
      expect(matchedTokens.refreshToken).not.toBe(loginTokens.refreshToken);
    });
  });

  it('lets operators list and revoke active wallet refresh sessions', async () => {
    await withAuthRoutes(async (baseUrl) => {
      const challenge = await (
        await fetch(`${baseUrl}/v1/auth/nonce`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ address: 'aeth1operator' }),
        })
      ).json();
      const loginTokens = await (
        await fetch(`${baseUrl}/v1/auth/login`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'User-Agent': 'CruzibleWallet/1.0',
          },
          body: JSON.stringify({
            address: 'aeth1operator',
            message: challenge.message,
            signature: 'test-signature',
          }),
        })
      ).json();

      const listResponse = await fetch(
        `${baseUrl}/v1/auth/sessions/aeth1operator`,
        {
          headers: { Authorization: `Bearer ${loginTokens.accessToken}` },
        },
      );
      const listBody = await listResponse.json();
      const serializedListBody = JSON.stringify(listBody);

      const revokeResponse = await fetch(
        `${baseUrl}/v1/auth/sessions/aeth1operator/revoke`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${loginTokens.accessToken}` },
        },
      );
      const revokeBody = await revokeResponse.json();

      const refreshAfterRevoke = await fetch(`${baseUrl}/v1/auth/refresh`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'CruzibleWallet/1.0',
        },
        body: JSON.stringify({ refresh_token: loginTokens.refreshToken }),
      });

      const listAfterRevokeResponse = await fetch(
        `${baseUrl}/v1/auth/sessions/aeth1operator`,
        {
          headers: { Authorization: `Bearer ${loginTokens.accessToken}` },
        },
      );
      const listAfterRevokeBody = await listAfterRevokeResponse.json();

      expect(listResponse.status).toBe(200);
      expect(listBody.address).toBe('aeth1operator');
      expect(listBody.sessions).toHaveLength(1);
      expect(listBody.sessions[0]).toMatchObject({
        address: 'aeth1operator',
        roles: ['user', 'operator'],
        status: 'active',
        hasUserAgentBinding: true,
      });
      expect(serializedListBody).not.toContain('tokenHash');
      expect(serializedListBody).not.toContain('refreshToken');

      expect(revokeResponse.status).toBe(200);
      expect(revokeBody).toEqual({
        address: 'aeth1operator',
        revokedCount: 1,
      });
      expect(refreshAfterRevoke.status).toBe(401);
      expect(listAfterRevokeBody.sessions[0].status).toBe('revoked');
    });
  });

  it('rejects refresh-session incident endpoints for non-operators', async () => {
    await withAuthRoutes(async (baseUrl) => {
      const challenge = await (
        await fetch(`${baseUrl}/v1/auth/nonce`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ address: 'aeth1user' }),
        })
      ).json();
      const loginTokens = await (
        await fetch(`${baseUrl}/v1/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            address: 'aeth1user',
            message: challenge.message,
            signature: 'test-signature',
          }),
        })
      ).json();

      const listResponse = await fetch(
        `${baseUrl}/v1/auth/sessions/aeth1user`,
        {
          headers: { Authorization: `Bearer ${loginTokens.accessToken}` },
        },
      );
      const revokeResponse = await fetch(
        `${baseUrl}/v1/auth/sessions/aeth1user/revoke`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${loginTokens.accessToken}` },
        },
      );

      expect(listResponse.status).toBe(403);
      expect(revokeResponse.status).toBe(403);
    });
  });

  it('revokes refresh tokens on logout', async () => {
    await withAuthRoutes(async (baseUrl) => {
      const challenge = await (
        await fetch(`${baseUrl}/v1/auth/nonce`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ address: 'aeth1operator' }),
        })
      ).json();
      const loginTokens = await (
        await fetch(`${baseUrl}/v1/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            address: 'aeth1operator',
            message: challenge.message,
            signature: 'test-signature',
          }),
        })
      ).json();

      const logoutResponse = await fetch(`${baseUrl}/v1/auth/logout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: loginTokens.refreshToken }),
      });
      const refreshResponse = await fetch(`${baseUrl}/v1/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: loginTokens.refreshToken }),
      });

      expect(logoutResponse.status).toBe(204);
      expect(refreshResponse.status).toBe(401);
    });
  });
});
