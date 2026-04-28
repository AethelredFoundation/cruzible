/**
 * Request Logger Middleware
 *
 * Structured JSON logging for every HTTP request with:
 * - Method, path, status code, response time
 * - Request ID correlation
 * - Sensitive data redaction (auth tokens, passwords)
 * - User agent and IP for security auditing
 */

import type { NextFunction, Request, Response } from 'express';
import { logger } from '../utils/logger';

// ---------------------------------------------------------------------------
// Sensitive header / field key patterns to redact
// ---------------------------------------------------------------------------

const REDACTED = '[REDACTED]';

const SENSITIVE_HEADERS = new Set([
  'authorization',
  'cookie',
  'set-cookie',
  'x-api-key',
  'x-auth-token',
  'proxy-authorization',
]);

const SENSITIVE_FIELD_KEY_PATTERNS = [
  /token/i,
  /secret/i,
  /password/i,
  /^api[-_]?key$/i,
  /^code$/i,
  /^message$/i,
  /^mnemonic$/i,
  /^nonce$/i,
  /private[-_]?key/i,
  /seed[-_]?phrase/i,
  /^signature$/i,
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Redacts sensitive header values, returning a safe copy.
 */
function redactHeaders(headers: Record<string, string | string[] | undefined>): Record<string, string> {
  const safe: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (SENSITIVE_HEADERS.has(key.toLowerCase())) {
      safe[key] = REDACTED;
    } else if (value !== undefined) {
      safe[key] = Array.isArray(value) ? value.join(', ') : String(value);
    }
  }
  return safe;
}

function isSensitiveFieldKey(key: string): boolean {
  return SENSITIVE_FIELD_KEY_PATTERNS.some((pattern) => pattern.test(key));
}

function redactUrl(rawUrl: string | undefined): string {
  if (!rawUrl) {
    return 'unknown';
  }

  try {
    const url = new URL(rawUrl, 'http://cruzible.local');
    const query = Array.from(url.searchParams.entries()).map(([key, value]) => {
      const safeValue = isSensitiveFieldKey(key)
        ? REDACTED
        : encodeURIComponent(value);
      return `${encodeURIComponent(key)}=${safeValue}`;
    });
    return `${url.pathname}${query.length > 0 ? `?${query.join('&')}` : ''}${url.hash}`;
  } catch {
    return rawUrl;
  }
}

/**
 * Deep-redacts sensitive keys from a body object (max 2 levels deep to avoid
 * performance issues on deeply nested payloads).
 */
function redactFields(value: unknown, depth = 0): unknown {
  if (depth > 2 || value === null || value === undefined) return value;
  if (typeof value !== 'object') return value;

  if (Array.isArray(value)) {
    return value.map((item) => redactFields(item, depth + 1));
  }

  const safe: Record<string, unknown> = {};
  for (const [key, nestedValue] of Object.entries(value as Record<string, unknown>)) {
    if (isSensitiveFieldKey(key)) {
      safe[key] = REDACTED;
    } else if (typeof nestedValue === 'object' && nestedValue !== null) {
      safe[key] = redactFields(nestedValue, depth + 1);
    } else {
      safe[key] = nestedValue;
    }
  }
  return safe;
}

/**
 * Extract the real client IP, respecting X-Forwarded-For when behind a
 * trusted proxy (express trust proxy handles this).
 */
function getClientIp(req: Request): string {
  return req.ip || req.socket.remoteAddress || 'unknown';
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
export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const startTime = process.hrtime.bigint();

  // Capture response body size (listen on finish, not close)
  res.on('finish', () => {
    const elapsedNs = process.hrtime.bigint() - startTime;
    const elapsedMs = Number(elapsedNs) / 1_000_000;

    const logEntry = {
      type: 'http_request',
      timestamp: new Date().toISOString(),
      requestId: req.requestId || 'unknown',
      method: req.method,
      path: redactUrl(req.originalUrl || req.url),
      statusCode: res.statusCode,
      responseTimeMs: Math.round(elapsedMs * 100) / 100,
      contentLength: res.getHeader('content-length') || 0,
      ip: getClientIp(req),
      userAgent: req.get('user-agent') || 'unknown',
      referer: req.get('referer') || undefined,
      user: req.user?.address || undefined,
    };

    // Use appropriate log level based on status code
    if (res.statusCode >= 500) {
      logger.error('HTTP request completed', logEntry);
    } else if (res.statusCode >= 400) {
      logger.warn('HTTP request completed', logEntry);
    } else {
      logger.info('HTTP request completed', logEntry);
    }
  });

  next();
}

/**
 * Verbose request logger that also logs incoming headers and redacted body.
 * Only enable in development / debug mode.
 */
export function verboseRequestLogger(req: Request, res: Response, next: NextFunction): void {
  logger.info('Incoming request detail', {
    type: 'http_request_detail',
    requestId: req.requestId || 'unknown',
    method: req.method,
    path: redactUrl(req.originalUrl || req.url),
    headers: redactHeaders(req.headers as Record<string, string | string[] | undefined>),
    query: redactFields(req.query),
    body: redactFields(req.body),
    ip: getClientIp(req),
    userAgent: req.get('user-agent') || 'unknown',
  });

  next();
}
