import { NextFunction, Request, Response } from "express";

export function noStore(
  _req: Request,
  res: Response,
  next: NextFunction,
): void {
  res.setHeader("Cache-Control", "no-store");
  next();
}
