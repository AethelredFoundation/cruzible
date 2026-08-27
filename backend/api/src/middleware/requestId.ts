import type { NextFunction, Request, Response } from "express";
import { randomUUID } from "crypto";

const SAFE_REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{1,64}$/;

function resolveRequestId(req: Request): string {
  const candidate = req.header("x-request-id")?.trim();
  if (candidate && SAFE_REQUEST_ID_PATTERN.test(candidate)) {
    return candidate;
  }

  return randomUUID();
}

export function requestId(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  req.requestId = resolveRequestId(req);
  res.setHeader("x-request-id", req.requestId);
  next();
}
