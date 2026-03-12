import type { NextFunction, Request, Response } from 'express';
import { randomUUID } from 'crypto';

export function requestId(req: Request, res: Response, next: NextFunction): void {
  req.requestId = req.header('x-request-id') || randomUUID();
  res.setHeader('x-request-id', req.requestId);
  next();
}
