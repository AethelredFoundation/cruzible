import type { NextFunction, Request, Response } from 'express';
import { ApiError } from '../utils/ApiError';
import { logger } from '../utils/logger';
import { config } from '../config';

export function errorHandler(
  error: unknown,
  req: Request,
  res: Response,
  next: NextFunction
): void {
  void next;

  if (error instanceof ApiError) {
    // L-03 FIX: Only expose error details in non-production environments.
    // In production, internal details (stack traces, contract addresses, etc.)
    // are logged server-side but omitted from the client response.
    const isProduction = config.isProduction;

    res.status(error.statusCode).json({
      error: error.name,
      message: error.message,
      ...(isProduction ? {} : { details: error.details }),
      requestId: req.requestId,
    });
    return;
  }

  // Server-side only — never sent to client
  logger.error('Unhandled API error', { requestId: req.requestId, error });

  res.status(500).json({
    error: 'InternalServerError',
    message: 'Unexpected server error',
    requestId: req.requestId,
  });
}
