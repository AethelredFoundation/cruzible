/**
 * Wallet-backed authentication routes.
 */

import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import {
  createLoginChallenge,
  refreshAccessToken,
  revokeRefreshToken,
  verifyLoginAndIssueTokens,
} from '../../auth/service';
import {
  AuthNonceBodySchema,
  LoginBodySchema,
  RefreshTokenBodySchema,
} from '../../validation/schemas';
import { authRateLimiter } from '../../middleware/rateLimiter';
import { asyncHandler } from '../../utils/asyncHandler';
import { ApiError } from '../../utils/ApiError';

const router = Router();

router.use((_req: Request, res: Response, next: NextFunction) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Pragma', 'no-cache');
  next();
});
router.use(authRateLimiter);

function parseRequest<T extends z.ZodTypeAny>(schema: T, value: unknown): z.infer<T> {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new ApiError(400, 'Validation failed', result.error.issues);
  }
  return result.data;
}

function sessionContext(req: Request) {
  return {
    ip: req.ip,
    userAgent: req.get('user-agent') ?? undefined,
  };
}

router.get('/nonce', (_req: Request, res: Response) => {
  res.setHeader('Allow', 'POST');
  res.status(405).json({
    error: 'Method Not Allowed',
    message: 'Use POST /v1/auth/nonce with a JSON body to create a login challenge',
  });
});

router.post(
  '/nonce',
  asyncHandler(async (req: Request, res: Response) => {
    const { address } = parseRequest(AuthNonceBodySchema, req.body);
    const challenge = await createLoginChallenge(address);
    res.json(challenge);
  }),
);

router.post(
  '/login',
  asyncHandler(async (req: Request, res: Response) => {
    const { address, message, signature } = parseRequest(LoginBodySchema, req.body);
    let tokens;
    try {
      tokens = await verifyLoginAndIssueTokens(
        address,
        message,
        signature,
        sessionContext(req),
      );
    } catch {
      throw new ApiError(401, 'Invalid login challenge or signature');
    }

    res.json(tokens);
  }),
);

router.post(
  '/refresh',
  asyncHandler(async (req: Request, res: Response) => {
    const { refresh_token: refreshToken } = parseRequest(
      RefreshTokenBodySchema,
      req.body,
    );
    let tokens;
    try {
      tokens = await refreshAccessToken(refreshToken, sessionContext(req));
    } catch {
      throw new ApiError(401, 'Invalid refresh token');
    }
    res.json(tokens);
  }),
);

router.post(
  '/logout',
  asyncHandler(async (req: Request, res: Response) => {
    const { refresh_token: refreshToken } = parseRequest(
      RefreshTokenBodySchema,
      req.body,
    );
    try {
      await revokeRefreshToken(refreshToken);
    } catch {
      throw new ApiError(401, 'Invalid refresh token');
    }
    res.status(204).send();
  }),
);

export { router as authRouter };
