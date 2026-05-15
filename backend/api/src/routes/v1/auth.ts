/**
 * Wallet-backed authentication routes.
 */

import {
  Router,
  Request,
  Response,
  NextFunction,
  type CookieOptions,
} from "express";
import { z } from "zod";
import {
  type AuthTokens,
  createLoginChallenge,
  listRefreshSessionsForAddress,
  refreshAccessToken,
  revokeRefreshToken,
  revokeRefreshSessionsForAddress,
  verifyLoginAndIssueTokens,
} from "../../auth/service";
import { authenticate, requireRoles } from "../../auth/middleware";
import {
  AddressSchema,
  AuthNonceBodySchema,
  LoginBodySchema,
  RefreshTokenBodySchema,
} from "../../validation/schemas";
import { authRateLimiter, opsRateLimiter } from "../../middleware/rateLimiter";
import { asyncHandler } from "../../utils/asyncHandler";
import { ApiError } from "../../utils/ApiError";
import { config } from "../../config";

const router = Router();
const RefreshTokenRequestBodySchema = RefreshTokenBodySchema.partial();
type RefreshTokenSource = "body" | "cookie";

router.use((_req: Request, res: Response, next: NextFunction) => {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Pragma", "no-cache");
  next();
});
router.use(authRateLimiter);

function parseRequest<T extends z.ZodTypeAny>(
  schema: T,
  value: unknown,
): z.infer<T> {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new ApiError(400, "Validation failed", result.error.issues);
  }
  return result.data;
}

function sessionContext(req: Request) {
  return {
    ip: req.ip,
    userAgent: req.get("user-agent") ?? undefined,
  };
}

function refreshCookieOptions(maxAge: number): CookieOptions {
  return {
    httpOnly: true,
    sameSite: "strict",
    secure: config.isProduction,
    path: "/",
    maxAge,
  };
}

function refreshTokenCookieName(): string {
  return config.isProduction ? "__Host-cruzible_refresh" : "cruzible_refresh";
}

function setRefreshTokenCookie(res: Response, refreshToken: string): void {
  res.cookie(
    refreshTokenCookieName(),
    refreshToken,
    refreshCookieOptions(config.jwtRefreshCookieMaxAgeMs),
  );
}

function clearRefreshTokenCookie(res: Response): void {
  res.cookie(refreshTokenCookieName(), "", refreshCookieOptions(0));
}

function readCookie(req: Request, name: string): string | undefined {
  const cookieHeader = req.get("cookie");
  if (!cookieHeader) {
    return undefined;
  }

  for (const cookie of cookieHeader.split(";")) {
    const [rawName, ...rawValueParts] = cookie.trim().split("=");
    if (rawName !== name) {
      continue;
    }

    const rawValue = rawValueParts.join("=");
    if (!rawValue) {
      return undefined;
    }

    try {
      return decodeURIComponent(rawValue);
    } catch {
      return undefined;
    }
  }

  return undefined;
}

function isAllowedRequestOrigin(origin: string): boolean {
  return config.corsOrigins.includes(origin);
}

function readRefererOrigin(req: Request): string | undefined {
  const referer = req.get("referer");
  if (!referer) {
    return undefined;
  }

  try {
    return new URL(referer).origin;
  } catch {
    return undefined;
  }
}

function assertTrustedCookieAuthOrigin(req: Request): void {
  const origin = req.get("origin");
  if (origin && !isAllowedRequestOrigin(origin)) {
    throw new ApiError(403, "Untrusted auth request origin");
  }

  const refererOrigin = readRefererOrigin(req);
  if (!origin && refererOrigin && !isAllowedRequestOrigin(refererOrigin)) {
    throw new ApiError(403, "Untrusted auth request origin");
  }

  if (config.isProduction && !origin && !refererOrigin) {
    throw new ApiError(403, "Missing auth request origin");
  }
}

function readRefreshTokenFromRequest(req: Request): {
  token: string;
  source: RefreshTokenSource;
} {
  const { refresh_token: bodyRefreshToken } = parseRequest(
    RefreshTokenRequestBodySchema,
    req.body ?? {},
  );
  if (bodyRefreshToken) {
    if (config.isProduction) {
      throw new ApiError(
        400,
        "Refresh tokens must be sent via HttpOnly cookies in production",
      );
    }

    return { token: bodyRefreshToken, source: "body" };
  }

  const refreshToken = readCookie(req, refreshTokenCookieName());
  if (!refreshToken) {
    throw new ApiError(401, "Invalid refresh token");
  }

  assertTrustedCookieAuthOrigin(req);
  return { token: refreshToken, source: "cookie" };
}

function authTokenResponse(tokens: AuthTokens) {
  if (config.authExposeRefreshTokenInBody) {
    return tokens;
  }

  return {
    accessToken: tokens.accessToken,
    expiresIn: tokens.expiresIn,
  };
}

router.get("/nonce", (_req: Request, res: Response) => {
  res.setHeader("Allow", "POST");
  res.status(405).json({
    error: "Method Not Allowed",
    message:
      "Use POST /v1/auth/nonce with a JSON body to create a login challenge",
  });
});

router.post(
  "/nonce",
  asyncHandler(async (req: Request, res: Response) => {
    const { address } = parseRequest(AuthNonceBodySchema, req.body);
    const challenge = await createLoginChallenge(address);
    res.json(challenge);
  }),
);

router.post(
  "/login",
  asyncHandler(async (req: Request, res: Response) => {
    assertTrustedCookieAuthOrigin(req);

    const { address, message, signature } = parseRequest(
      LoginBodySchema,
      req.body,
    );
    let tokens;
    try {
      tokens = await verifyLoginAndIssueTokens(
        address,
        message,
        signature,
        sessionContext(req),
      );
    } catch {
      throw new ApiError(401, "Invalid login challenge or signature");
    }

    setRefreshTokenCookie(res, tokens.refreshToken);
    res.json(authTokenResponse(tokens));
  }),
);

router.post(
  "/refresh",
  asyncHandler(async (req: Request, res: Response) => {
    const { token: refreshToken } = readRefreshTokenFromRequest(req);
    let tokens;
    try {
      tokens = await refreshAccessToken(refreshToken, sessionContext(req));
    } catch {
      throw new ApiError(401, "Invalid refresh token");
    }
    setRefreshTokenCookie(res, tokens.refreshToken);
    res.json(authTokenResponse(tokens));
  }),
);

router.post(
  "/logout",
  asyncHandler(async (req: Request, res: Response) => {
    const { token: refreshToken } = readRefreshTokenFromRequest(req);
    try {
      await revokeRefreshToken(refreshToken);
    } catch {
      throw new ApiError(401, "Invalid refresh token");
    }
    clearRefreshTokenCookie(res);
    res.status(204).send();
  }),
);

const SessionAddressParamsSchema = z.object({
  address: AddressSchema,
});

const requireOperatorAccess = [
  authenticate,
  opsRateLimiter,
  requireRoles("operator", "admin"),
] as const;

router.get(
  "/sessions/:address",
  ...requireOperatorAccess,
  asyncHandler(async (req: Request, res: Response) => {
    const { address } = parseRequest(SessionAddressParamsSchema, req.params);
    const sessions = await listRefreshSessionsForAddress(address);
    res.json(sessions);
  }),
);

router.post(
  "/sessions/:address/revoke",
  ...requireOperatorAccess,
  asyncHandler(async (req: Request, res: Response) => {
    const { address } = parseRequest(SessionAddressParamsSchema, req.params);
    if (!req.user) {
      throw new ApiError(401, "Authentication required");
    }

    const result = await revokeRefreshSessionsForAddress(address, {
      actorAddress: req.user.address,
      requestId: req.requestId,
    });
    res.json(result);
  }),
);

export { router as authRouter };
