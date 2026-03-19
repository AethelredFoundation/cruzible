/**
 * Validation Middleware
 * Applies Zod schemas to validate request params, query, and body
 */

import { Request, Response, NextFunction } from "express";
import { ZodSchema, ZodError } from "zod";
import { logger } from "../utils/logger";

interface ValidationSchemas {
  params?: ZodSchema<any>;
  query?: ZodSchema<any>;
  body?: ZodSchema<any>;
}

/**
 * Format Zod error into readable message
 */
function formatZodError(error: ZodError): string {
  return error.errors
    .map((err) => `${err.path.join(".")}: ${err.message}`)
    .join(", ");
}

/**
 * Validation middleware factory
 * Validates request against provided Zod schemas
 */
export function validate(schemas: ValidationSchemas) {
  return async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      // Validate params
      if (schemas.params) {
        const result = await schemas.params.safeParseAsync(req.params);
        if (!result.success) {
          logger.warn("Validation failed for params", {
            path: req.path,
            errors: result.error.errors,
          });
          res.status(400).json({
            success: false,
            error: "Validation Error",
            message: formatZodError(result.error),
            details: result.error.errors,
          });
          return;
        }
        req.params = result.data;
      }

      // Validate query
      if (schemas.query) {
        const result = await schemas.query.safeParseAsync(req.query);
        if (!result.success) {
          logger.warn("Validation failed for query", {
            path: req.path,
            errors: result.error.errors,
          });
          res.status(400).json({
            success: false,
            error: "Validation Error",
            message: formatZodError(result.error),
            details: result.error.errors,
          });
          return;
        }
        req.query = result.data;
      }

      // Validate body
      if (schemas.body) {
        const result = await schemas.body.safeParseAsync(req.body);
        if (!result.success) {
          logger.warn("Validation failed for body", {
            path: req.path,
            errors: result.error.errors,
          });
          res.status(400).json({
            success: false,
            error: "Validation Error",
            message: formatZodError(result.error),
            details: result.error.errors,
          });
          return;
        }
        req.body = result.data;
      }

      next();
    } catch (error) {
      logger.error("Validation middleware error", { error });
      res.status(500).json({
        success: false,
        error: "Internal Server Error",
        message: "Validation failed",
      });
    }
  };
}

/**
 * Sanitize middleware
 * Removes dangerous characters and trims strings
 */
export function sanitize(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const sanitizeValue = (value: any): any => {
    if (typeof value === "string") {
      // Trim and remove dangerous characters
      return value
        .trim()
        .replace(/[<>]/g, "") // Remove < and > to prevent XSS
        .replace(/[&][#]?[xX]?[0-9a-fA-F]+;/g, ""); // Remove HTML entities
    }
    if (typeof value === "object" && value !== null) {
      if (Array.isArray(value)) {
        return value.map(sanitizeValue);
      }
      return Object.fromEntries(
        Object.entries(value).map(([key, val]) => [key, sanitizeValue(val)]),
      );
    }
    return value;
  };

  req.body = sanitizeValue(req.body);
  req.query = sanitizeValue(req.query);
  req.params = sanitizeValue(req.params);

  next();
}
