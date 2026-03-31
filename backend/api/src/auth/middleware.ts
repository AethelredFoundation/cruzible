/**
 * Authentication & Authorization Middleware
 * JWT-based authentication with role-based access control
 */

import { Request, Response, NextFunction } from 'express';
import { JsonWebTokenError } from 'jsonwebtoken';
import { verifyAccessToken } from './service';
import { logger } from '../utils/logger';

/**
 * JWT Authentication middleware
 * Validates JWT token from Authorization header
 */
export function authenticate(req: Request, res: Response, next: NextFunction): void {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader) {
      res.status(401).json({
        success: false,
        error: 'Unauthorized',
        message: 'Authorization header missing',
      });
      return;
    }

    const parts = authHeader.split(' ');
    if (parts.length !== 2 || parts[0] !== 'Bearer') {
      res.status(401).json({
        success: false,
        error: 'Unauthorized',
        message: 'Invalid authorization format. Use: Bearer <token>',
      });
      return;
    }

    const token = parts[1];

    // Verify token
    const decoded = verifyAccessToken(token) as NonNullable<Request['user']>;
    
    // Check token expiration
    if (decoded.exp && decoded.exp < Date.now() / 1000) {
      res.status(401).json({
        success: false,
        error: 'Unauthorized',
        message: 'Token expired',
      });
      return;
    }

    req.user = decoded;
    next();
  } catch (error) {
    if (error instanceof JsonWebTokenError) {
      logger.warn('Invalid JWT token', { error: error.message });
      res.status(401).json({
        success: false,
        error: 'Unauthorized',
        message: 'Invalid token',
      });
      return;
    }

    logger.error('Authentication error', { error });
    res.status(500).json({
      success: false,
      error: 'Internal Server Error',
      message: 'Authentication failed',
    });
  }
}

/**
 * Optional authentication middleware
 * Attaches user if token present, but doesn't require it
 */
export function optionalAuth(req: Request, res: Response, next: NextFunction): void {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader) {
      next();
      return;
    }

    const parts = authHeader.split(' ');
    if (parts.length !== 2 || parts[0] !== 'Bearer') {
      next();
      return;
    }

    const token = parts[1];
    const decoded = verifyAccessToken(token) as NonNullable<Request['user']>;
    req.user = decoded;
    next();
  } catch {
    // Invalid token, continue without user
    next();
  }
}

/**
 * Role-based authorization middleware factory
 * Requires user to have at least one of the specified roles
 */
export function requireRoles(...allowedRoles: string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({
        success: false,
        error: 'Unauthorized',
        message: 'Authentication required',
      });
      return;
    }

    const hasRole = req.user.roles.some(role => allowedRoles.includes(role));

    if (!hasRole) {
      logger.warn('Insufficient permissions', {
        address: req.user.address,
        required: allowedRoles,
        actual: req.user.roles,
      });
      res.status(403).json({
        success: false,
        error: 'Forbidden',
        message: 'Insufficient permissions',
      });
      return;
    }

    next();
  };
}

/**
 * Rate limiting per user
 * Different limits for authenticated vs unauthenticated users
 */
export function userRateLimiter(options: {
  windowMs: number;
  maxAuthenticated: number;
  maxUnauthenticated: number;
}) {
  const requests = new Map<string, { count: number; resetTime: number }>();

  return (req: Request, res: Response, next: NextFunction): void => {
    const identifier = req.user?.address || req.ip || 'anonymous';
    const now = Date.now();
    const maxRequests = req.user ? options.maxAuthenticated : options.maxUnauthenticated;

    const record = requests.get(identifier);

    if (!record || now > record.resetTime) {
      // Reset or create new record
      requests.set(identifier, {
        count: 1,
        resetTime: now + options.windowMs,
      });
      next();
      return;
    }

    if (record.count >= maxRequests) {
      const retryAfter = Math.ceil((record.resetTime - now) / 1000);
      res.setHeader('Retry-After', retryAfter);
      res.status(429).json({
        success: false,
        error: 'Too Many Requests',
        message: `Rate limit exceeded. Try again in ${retryAfter} seconds.`,
        retryAfter,
      });
      return;
    }

    record.count++;
    next();
  };
}
