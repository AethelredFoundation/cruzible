/**
 * Request Logger Middleware
 *
 * Structured JSON logging for every HTTP request with:
 * - Method, path, status code, response time
 * - Request ID correlation
 * - Sensitive data redaction (auth tokens, passwords)
 * - Hashed user agent and IP for privacy-preserving security auditing
 */

import type { NextFunction, Request, Response } from "express";
import { logger } from "../utils/logger";
import { hashPrivacyValue } from "../utils/privacyHash";
import { redactFields, redactHeaders, redactUrlPath } from "../utils/redaction";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Extract the real client IP, respecting X-Forwarded-For when behind a
 * trusted proxy (express trust proxy handles this).
 */
function getClientIp(req: Request): string {
  return req.ip || req.socket.remoteAddress || "unknown";
}

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------

/**
 * Structured request logger middleware.
 *
 * Attaches to `res.on('finish')` so it captures the final status code and
 * computes elapsed time accurately.
 */
export function requestLogger(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const startTime = process.hrtime.bigint();

  // Capture response body size (listen on finish, not close)
  res.on("finish", () => {
    const elapsedNs = process.hrtime.bigint() - startTime;
    const elapsedMs = Number(elapsedNs) / 1_000_000;

    const logEntry = {
      type: "http_request",
      timestamp: new Date().toISOString(),
      requestId: req.requestId || "unknown",
      method: req.method,
      path: redactUrlPath(req.originalUrl || req.url),
      statusCode: res.statusCode,
      responseTimeMs: Math.round(elapsedMs * 100) / 100,
      contentLength: res.getHeader("content-length") || 0,
      ipHash: hashPrivacyValue(getClientIp(req)),
      userAgentHash: hashPrivacyValue(req.get("user-agent") || "unknown"),
      referer: req.get("referer")
        ? redactUrlPath(req.get("referer"))
        : undefined,
      user: req.user?.address || undefined,
    };

    // Use appropriate log level based on status code
    if (res.statusCode >= 500) {
      logger.error("HTTP request completed", logEntry);
    } else if (res.statusCode >= 400) {
      logger.warn("HTTP request completed", logEntry);
    } else {
      logger.info("HTTP request completed", logEntry);
    }
  });

  next();
}

/**
 * Verbose request logger that also logs incoming headers and redacted body.
 * Only enable in development / debug mode.
 */
export function verboseRequestLogger(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  logger.info("Incoming request detail", {
    type: "http_request_detail",
    requestId: req.requestId || "unknown",
    method: req.method,
    path: redactUrlPath(req.originalUrl || req.url),
    headers: redactHeaders(
      req.headers as Record<string, string | string[] | undefined>,
    ),
    query: redactFields(req.query),
    body: redactFields(req.body),
    ipHash: hashPrivacyValue(getClientIp(req)),
    userAgentHash: hashPrivacyValue(req.get("user-agent") || "unknown"),
  });

  next();
}
