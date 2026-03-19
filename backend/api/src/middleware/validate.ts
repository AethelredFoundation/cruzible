import type { NextFunction, Request, Response } from "express";
import { validationResult } from "express-validator";
import { ApiError } from "../utils/ApiError";

export function validate(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  void res;
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    next(new ApiError(400, "Validation failed", errors.array()));
    return;
  }
  next();
}
