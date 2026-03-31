import rateLimit from 'express-rate-limit';
import { config } from '../config';

export const rateLimiter = rateLimit({
  windowMs: config.rateLimitWindowMs,
  max: config.rateLimitMax,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.path === '/health' || req.path.startsWith('/docs'),
  handler: (req, res) => {
    res.status(429).json({
      error: 'TooManyRequests',
      message: 'Rate limit exceeded',
      requestId: req.requestId,
    });
  },
});
