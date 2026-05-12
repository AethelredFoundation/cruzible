import type { NextFunction, Request, Response } from "express";
import { ApiError } from "../utils/ApiError";
import { logger } from "../utils/logger";
import { config } from "../config";

type BodyParserError = Error & {
  status?: number;
  statusCode?: number;
  type?: string;
};

function bodyParserErrorResponse(error: unknown):
  | {
      statusCode: number;
      error: string;
      message: string;
    }
  | undefined {
  if (!(error instanceof Error)) {
    return undefined;
  }

  const parserError = error as BodyParserError;
  const statusCode = parserError.statusCode ?? parserError.status;
  const type = parserError.type ?? "";

  if (type === "entity.too.large" || statusCode === 413) {
    return {
      statusCode: 413,
      error: "PayloadTooLarge",
      message: "Request body exceeds the maximum allowed size",
    };
  }

  if (type === "encoding.unsupported" || statusCode === 415) {
    return {
      statusCode: 415,
      error: "UnsupportedMediaType",
      message: "Request body encoding is not supported",
    };
  }

  if (
    type === "entity.parse.failed" ||
    (statusCode === 400 && type.startsWith("entity."))
  ) {
    return {
      statusCode: 400,
      error: "BadRequest",
      message: "Malformed request body",
    };
  }

  return undefined;
}

export function errorHandler(
  error: unknown,
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (res.headersSent) {
    next(error);
    return;
  }

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

  const parserError = bodyParserErrorResponse(error);
  if (parserError) {
    logger.warn("Rejected malformed request body", {
      requestId: req.requestId,
      statusCode: parserError.statusCode,
      error: parserError.error,
    });

    res.status(parserError.statusCode).json({
      error: parserError.error,
      message: parserError.message,
      requestId: req.requestId,
    });
    return;
  }

  // Server-side only — never sent to client
  logger.error("Unhandled API error", { requestId: req.requestId, error });

  res.status(500).json({
    error: "InternalServerError",
    message: "Unexpected server error",
    requestId: req.requestId,
  });
}
