import { timingSafeEqual } from 'crypto';
import type { NextFunction, Request, Response } from 'express';
import { config } from '../config';

function readOperationalToken(req: Request): string | undefined {
  const explicitToken = req.get('x-operational-token')?.trim();
  if (explicitToken) {
    return explicitToken;
  }

  const authorization = req.get('authorization')?.trim();
  if (!authorization) {
    return undefined;
  }

  const [scheme, token, extra] = authorization.split(/\s+/);
  if (scheme?.toLowerCase() !== 'bearer' || !token || extra) {
    return undefined;
  }

  return token;
}

function isEqualToken(provided: string, expected: string): boolean {
  const providedBuffer = Buffer.from(provided);
  const expectedBuffer = Buffer.from(expected);

  return (
    providedBuffer.length === expectedBuffer.length &&
    timingSafeEqual(providedBuffer, expectedBuffer)
  );
}

export function requireOperationalAccess(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (!config.isProduction) {
    next();
    return;
  }

  const expectedToken = config.operationalEndpointsToken;
  const providedToken = readOperationalToken(req);

  if (
    expectedToken &&
    providedToken &&
    isEqualToken(providedToken, expectedToken)
  ) {
    next();
    return;
  }

  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('WWW-Authenticate', 'Bearer realm="cruzible-operations"');
  res.status(401).json({
    error: 'Unauthorized',
    message: 'Operational endpoint access token required',
    requestId: req.requestId,
  });
}
