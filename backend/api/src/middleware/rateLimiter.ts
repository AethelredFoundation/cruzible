import rateLimit from 'express-rate-limit';
import { config } from '../config';

export const rateLimiter = rateLimit({
  windowMs: config.rateLimitWindowMs,
  max: config.rateLimitMax,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) =>
    req.path === '/health' || req.path === '/metrics' || req.path.startsWith('/docs'),
  handler: (req, res) => {
    res.status(429).json({
      error: 'TooManyRequests',
      message: 'Rate limit exceeded',
      requestId: req.requestId,
    });
  },
});

function namedRateLimiter(options: {
  windowMs: number;
  max: number;
  message: string;
}) {
  return rateLimit({
    windowMs: options.windowMs,
    max: options.max,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) => {
      res.status(429).json({
        error: 'TooManyRequests',
        message: options.message,
        requestId: req.requestId,
      });
    },
  });
}

export const authRateLimiter = namedRateLimiter({
  windowMs: config.authRateLimitWindowMs,
  max: config.authRateLimitMax,
  message: 'Authentication rate limit exceeded',
});

export const opsRateLimiter = namedRateLimiter({
  windowMs: config.opsRateLimitWindowMs,
  max: config.opsRateLimitMax,
  message: 'Operations rate limit exceeded',
});
