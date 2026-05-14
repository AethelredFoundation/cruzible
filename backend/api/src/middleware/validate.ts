import type { NextFunction, Request, Response } from 'express';
import { type ValidationError, validationResult } from 'express-validator';
import { ApiError } from '../utils/ApiError';

type SafeValidationDetail = {
  location?: string;
  msg: string;
  path?: string;
  type?: string;
};

export function sanitizeValidationErrors(
  errors: ValidationError[],
): SafeValidationDetail[] {
  return errors.map((error) => {
    const detail: SafeValidationDetail = {
      msg: String(error.msg),
    };

    if ('location' in error && typeof error.location === 'string') {
      detail.location = error.location;
    }

    if ('path' in error && typeof error.path === 'string') {
      detail.path = error.path;
    }

    if ('type' in error && typeof error.type === 'string') {
      detail.type = error.type;
    }

    return detail;
  });
}

export function validate(req: Request, res: Response, next: NextFunction): void {
  void res;
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    next(
      new ApiError(
        400,
        'Validation failed',
        sanitizeValidationErrors(errors.array({ onlyFirstError: true })),
      ),
    );
    return;
  }
  next();
}
