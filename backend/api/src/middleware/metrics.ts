import type { NextFunction, Request, Response } from 'express';

export function metricsMiddleware(req: Request, res: Response, next: NextFunction): void {
  void req;
  void res;
  next();
}
