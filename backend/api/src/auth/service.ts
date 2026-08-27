/**
 * Authentication service for wallet-backed login, JWT issuance, refresh
 * rotation, logout revocation, and Cosmos ADR-036 signature verification.
 */

import { randomBytes, randomUUID, createHash } from "crypto";
import {
  Secp256k1,
  Secp256k1Signature,
  Sha256 as CryptoSha256,
  Ripemd160,
} from "@cosmjs/crypto";
import { fromBase64, toBech32, fromBech32 } from "@cosmjs/encoding";
import { serializeSignDoc, type StdSignDoc } from "@cosmjs/amino";
import { PrismaClient, type Prisma } from "@prisma/client";
import jwt, { type SignOptions } from "jsonwebtoken";
import { config } from "../config";
import { logger } from "../utils/logger";
import { errorContext } from "../utils/errorContext";

const ACCESS_TOKEN_AUDIENCE = "aethelred-client";
const TOKEN_ISSUER = "aethelred-api";
const LOGIN_DOMAIN = "Aethelred Cruzible API";
const NONCE_BYTES = 24;
const AUTH_DB_CLEANUP_INTERVAL_MS = 60_000;
const REFRESH_CONTEXT_MISMATCH = Symbol("refresh-context-mismatch");

type SessionContext = {
  ip?: string;
  userAgent?: string;
};

type RefreshTokenOptions = {
  refreshSessionId?: string;
  refreshTokenId?: string;
};

type StoredNonce = {
  address: string;
  nonceHash: string;
  message: string;
  expiresAt: Date;
  consumedAt?: Date | null;
};

type StoredRefreshSession = {
  id: string;
  address: string;
  roles: string[];
  tokenHash: string;
  parentSessionId?: string | null;
  userAgentHash?: string | null;
  ipHash?: string | null;
  expiresAt: Date;
  createdAt?: Date | null;
  rotatedAt?: Date | null;
  revokedAt?: Date | null;
};

type StoredAccessRevocation = {
  address: string;
  notBefore: Date;
  reason?: string | null;
  actorAddress?: string | null;
  requestId?: string | null;
  createdAt?: Date | null;
  updatedAt?: Date | null;
};

type RotateRefreshSessionResult =
  | StoredRefreshSession
  | null
  | typeof REFRESH_CONTEXT_MISMATCH;

export interface TokenPayload {
  address: string;
  roles: string[];
  iat?: number;
  exp?: number;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface LoginChallenge {
  address: string;
  nonce: string;
  message: string;
  expiresAt: string;
}

export interface RefreshSessionSummary {
  sessionId: string;
  parentSessionId: string | null;
  address: string;
  roles: string[];
  status: "active" | "expired" | "revoked" | "rotated";
  expiresAt: string;
  createdAt: string | null;
  rotatedAt: string | null;
  revokedAt: string | null;
  hasUserAgentBinding: boolean;
  hasIpBinding: boolean;
}

export interface RefreshSessionRevokeAuditContext {
  actorAddress: string;
  requestId?: string;
}

interface AccessRevocationAuditContext extends RefreshSessionRevokeAuditContext {
  reason: string;
}

interface RefreshTokenPayload {
  address: string;
  roles: string[];
  type?: string;
  jti?: string;
  sid?: string;
  exp?: number;
}

const authPrisma = config.databaseUrl ? new PrismaClient() : null;
const memoryNonces = new Map<string, StoredNonce>();
const memoryRefreshSessions = new Map<string, StoredRefreshSession>();
const memoryAccessRevocations = new Map<string, StoredAccessRevocation>();
let nextAuthDbCleanupAt = 0;
let authDbCleanupPromise: Promise<void> | null = null;
let authPrismaDisconnected = false;

/**
 * Generate JWT access and refresh tokens.
 *
 * This helper only signs tokens. Login and refresh flows must call
 * issueAuthTokens()/refreshAccessToken() so the refresh token is persisted.
 */
export function generateTokens(
  payload: TokenPayload,
  options: RefreshTokenOptions = {},
): AuthTokens {
  const accessOptions: SignOptions = {
    expiresIn: config.jwtExpiresIn as SignOptions["expiresIn"],
    issuer: TOKEN_ISSUER,
    audience: ACCESS_TOKEN_AUDIENCE,
  };

  const accessToken = jwt.sign(
    {
      address: payload.address,
      roles: payload.roles,
    },
    config.jwtSecret,
    accessOptions,
  );

  const refreshSessionId = options.refreshSessionId ?? randomUUID();
  const refreshTokenId = options.refreshTokenId ?? randomUUID();
  const refreshOptions: SignOptions = {
    expiresIn: config.jwtRefreshExpiresIn as SignOptions["expiresIn"],
    issuer: TOKEN_ISSUER,
    jwtid: refreshTokenId,
  };

  const refreshToken = jwt.sign(
    {
      address: payload.address,
      roles: payload.roles,
      sid: refreshSessionId,
      type: "refresh",
    },
    config.jwtRefreshSecret,
    refreshOptions,
  );

  return {
    accessToken,
    refreshToken,
    expiresIn: parseExpiration(config.jwtExpiresIn),
  };
}

/**
 * Verify and decode access token.
 */
export function verifyAccessToken(token: string): TokenPayload {
  return jwt.verify(token, config.jwtSecret, {
    algorithms: ["HS256"],
    issuer: TOKEN_ISSUER,
    audience: ACCESS_TOKEN_AUDIENCE,
  }) as TokenPayload;
}

/**
 * Verify refresh token and return the rotation metadata.
 */
export function verifyRefreshToken(token: string): {
  address: string;
  roles: string[];
  refreshTokenId: string;
  refreshSessionId: string;
  expiresAt: Date;
} {
  const payload = jwt.verify(token, config.jwtRefreshSecret, {
    algorithms: ["HS256"],
    issuer: TOKEN_ISSUER,
  }) as RefreshTokenPayload;

  if (payload.type !== "refresh") {
    throw new Error("Invalid token type");
  }

  if (!payload.jti || !payload.sid || !payload.exp) {
    throw new Error("Refresh token missing rotation metadata");
  }

  return {
    address: payload.address,
    roles: payload.roles,
    refreshTokenId: payload.jti,
    refreshSessionId: payload.sid,
    expiresAt: new Date(payload.exp * 1000),
  };
}

export async function createLoginChallenge(
  address: string,
): Promise<LoginChallenge> {
  void cleanupExpiredAuthArtifacts();

  const normalizedAddress = normalizeAddress(address);
  const nonce = randomBytes(NONCE_BYTES).toString("base64url");
  const issuedAt = new Date();
  const expiresAt = new Date(issuedAt.getTime() + config.authNonceTtlMs);
  const message = buildLoginMessage(
    normalizedAddress,
    nonce,
    issuedAt,
    expiresAt,
  );
  const nonceHash = hashSecret(nonce);

  await storeNonce({
    address: normalizedAddress,
    nonceHash,
    message,
    expiresAt,
  });

  return {
    address: normalizedAddress,
    nonce,
    message,
    expiresAt: expiresAt.toISOString(),
  };
}

export async function verifyLoginAndIssueTokens(
  address: string,
  message: string,
  signature: string,
  context: SessionContext = {},
): Promise<AuthTokens> {
  const normalizedAddress = normalizeAddress(address);
  const parsedMessage = parseLoginMessage(message);

  if (parsedMessage.address !== normalizedAddress) {
    throw new Error("Login challenge address mismatch");
  }

  const storedNonce = await findValidNonce(hashSecret(parsedMessage.nonce));
  if (
    !storedNonce ||
    storedNonce.address !== normalizedAddress ||
    storedNonce.message !== message
  ) {
    throw new Error("Invalid or expired login challenge");
  }

  const signatureValid = await verifySignature(
    normalizedAddress,
    message,
    signature,
  );
  if (!signatureValid) {
    throw new Error("Invalid login signature");
  }

  const consumed = await consumeNonce(storedNonce.nonceHash);
  if (!consumed) {
    throw new Error("Login challenge has already been used");
  }

  return issueAuthTokens(
    {
      address: normalizedAddress,
      roles: resolveRolesForAddress(normalizedAddress),
    },
    context,
  );
}

export async function issueAuthTokens(
  payload: TokenPayload,
  context: SessionContext = {},
  parentSessionId?: string,
): Promise<AuthTokens> {
  const { tokens, session } = buildTokenSession(
    payload,
    context,
    parentSessionId,
  );
  await storeRefreshSession(session);

  return tokens;
}

/**
 * Rotate a refresh token. The presented refresh token is revoked before a new
 * refresh session is persisted, so replaying the old token is rejected.
 */
export async function refreshAccessToken(
  refreshToken: string,
  context: SessionContext = {},
): Promise<AuthTokens> {
  try {
    const verified = verifyRefreshToken(refreshToken);
    const tokenHash = hashSecret(refreshToken);
    const currentRoles = resolveRolesForAddress(verified.address);
    const { tokens, session: nextSession } = buildTokenSession(
      {
        address: verified.address,
        roles: currentRoles,
      },
      context,
      verified.refreshSessionId,
    );
    const rotated = await rotateRefreshSession(tokenHash, nextSession);

    if (rotated === REFRESH_CONTEXT_MISMATCH) {
      throw new Error("Refresh session context mismatch");
    }

    if (!rotated || rotated.address !== verified.address) {
      await revokeSessionFamilyOnRefreshReuse(tokenHash, verified.address);
      throw new Error("Refresh session is invalid or already rotated");
    }

    logRefreshSessionIpDrift(rotated, nextSession);

    return tokens;
  } catch (error) {
    logger.warn("Token refresh rejected", errorContext(error));
    const invalidRefreshTokenError = new Error(
      "Invalid refresh token",
    ) as Error & {
      cause?: unknown;
    };
    invalidRefreshTokenError.cause = error;
    throw invalidRefreshTokenError;
  }
}

/**
 * Revoke a refresh token for logout. Invalid tokens are treated as rejected
 * credentials by callers, not as successful logouts.
 */
export async function revokeRefreshToken(token: string): Promise<void> {
  const verified = verifyRefreshToken(token);
  const revoked = await revokeRefreshSession(hashSecret(token));

  if (!revoked || revoked.address !== verified.address) {
    throw new Error("Refresh session not found");
  }

  await revokeAccessTokensForAddress(verified.address, {
    actorAddress: verified.address,
    reason: "logout",
  });

  logger.info("Refresh token and access tokens revoked on logout", {
    address: verified.address,
  });
}

export async function isTokenRevoked(token: string): Promise<boolean> {
  const session = await findRefreshSession(hashSecret(token));
  return !session || Boolean(session.revokedAt || session.rotatedAt);
}

export async function listRefreshSessionsForAddress(
  address: string,
): Promise<{ address: string; sessions: RefreshSessionSummary[] }> {
  const normalizedAddress = normalizeAddress(address);
  const sessions = await findRefreshSessionsForAddress(normalizedAddress);
  const now = new Date();

  return {
    address: normalizedAddress,
    sessions: sessions.map((session) => summarizeRefreshSession(session, now)),
  };
}

export async function revokeRefreshSessionsForAddress(
  address: string,
  auditContext?: RefreshSessionRevokeAuditContext,
): Promise<{ address: string; revokedCount: number }> {
  const normalizedAddress = normalizeAddress(address);
  const revokedCount =
    await revokeActiveRefreshSessionsForAddress(normalizedAddress);
  const accessRevocation = await revokeAccessTokensForAddress(
    normalizedAddress,
    {
      actorAddress: auditContext?.actorAddress ?? "system",
      requestId: auditContext?.requestId,
      reason: "refresh_sessions_revoked",
    },
  );

  logger.info("Refresh sessions and access tokens revoked for address", {
    address: normalizedAddress,
    actorAddress: auditContext?.actorAddress,
    requestId: auditContext?.requestId,
    revokedCount,
    accessTokenNotBefore: accessRevocation.notBefore.toISOString(),
  });

  return {
    address: normalizedAddress,
    revokedCount,
  };
}

export function resolveRolesForAddress(address: string): string[] {
  const normalizedAddress = normalizeAddress(address);
  const roles = new Set<string>(["user"]);

  if (config.authAdminAddresses.includes(normalizedAddress)) {
    roles.add("operator");
    roles.add("admin");
  }

  if (config.authOperatorAddresses.includes(normalizedAddress)) {
    roles.add("operator");
  }

  return [...roles];
}

export async function isAccessTokenRevoked(
  payload: Pick<TokenPayload, "address" | "iat">,
): Promise<boolean> {
  if (!payload.iat || !Number.isFinite(payload.iat)) {
    return true;
  }

  const revocation = await findAccessRevocationForAddress(
    normalizeAddress(payload.address),
  );

  if (!revocation) {
    return false;
  }

  return payload.iat * 1000 <= revocation.notBefore.getTime();
}

export async function cleanupExpiredAuthArtifacts(): Promise<void> {
  const prisma = authPrisma;
  if (!prisma) {
    cleanupExpiredMemoryState();
    return;
  }

  const now = new Date();
  if (authDbCleanupPromise || now.getTime() < nextAuthDbCleanupAt) {
    return;
  }

  nextAuthDbCleanupAt = now.getTime() + AUTH_DB_CLEANUP_INTERVAL_MS;
  authDbCleanupPromise = cleanupExpiredDbAuthArtifacts(prisma, now)
    .catch((error) => {
      logger.warn("Expired auth artifact cleanup failed", errorContext(error));
    })
    .finally(() => {
      authDbCleanupPromise = null;
    });

  await authDbCleanupPromise;
}

export async function shutdownAuthState(): Promise<void> {
  if (authDbCleanupPromise) {
    await authDbCleanupPromise;
  }

  memoryNonces.clear();
  memoryRefreshSessions.clear();
  memoryAccessRevocations.clear();
  nextAuthDbCleanupAt = 0;
  authDbCleanupPromise = null;

  if (!authPrisma || authPrismaDisconnected) {
    return;
  }

  authPrismaDisconnected = true;
  await authPrisma.$disconnect();
}

async function revokeAccessTokensForAddress(
  address: string,
  auditContext: AccessRevocationAuditContext,
): Promise<StoredAccessRevocation> {
  const normalizedAddress = normalizeAddress(address);
  const notBefore = new Date();
  return upsertAccessRevocationForAddress(
    normalizedAddress,
    notBefore,
    auditContext,
  );
}

async function revokeSessionFamilyOnRefreshReuse(
  tokenHash: string,
  address: string,
): Promise<void> {
  const session = await findRefreshSession(tokenHash);
  const now = new Date();

  if (
    !session ||
    session.address !== address ||
    session.expiresAt <= now ||
    (!session.rotatedAt && !session.revokedAt)
  ) {
    return;
  }

  const revokedCount = await revokeActiveRefreshSessionsForAddress(address);
  const accessRevocation = await revokeAccessTokensForAddress(address, {
    actorAddress: "system",
    reason: "refresh_token_reuse",
  });

  logger.warn("Refresh token reuse detected; session family revoked", {
    address,
    sessionId: session.id,
    revokedCount,
    accessTokenNotBefore: accessRevocation.notBefore.toISOString(),
  });
}

async function revokeSessionFamilyOnContextMismatch(
  session: StoredRefreshSession,
): Promise<void> {
  const revokedCount = await revokeActiveRefreshSessionsForAddress(
    session.address,
  );
  const accessRevocation = await revokeAccessTokensForAddress(session.address, {
    actorAddress: "system",
    reason: "refresh_context_mismatch",
  });

  logger.warn("Refresh session context mismatch; session family revoked", {
    address: session.address,
    sessionId: session.id,
    revokedCount,
    accessTokenNotBefore: accessRevocation.notBefore.toISOString(),
  });
}

async function revokeSessionFamilyOnContextMismatchInTransaction(
  tx: Prisma.TransactionClient,
  session: StoredRefreshSession,
  now: Date,
): Promise<void> {
  const result = await tx.authRefreshSession.updateMany({
    where: {
      address: session.address,
      revokedAt: null,
      rotatedAt: null,
      expiresAt: { gt: now },
    },
    data: { revokedAt: now },
  });

  const existingRevocation = await tx.authAccessRevocation.findUnique({
    where: { address: session.address },
  });
  const nextNotBefore =
    existingRevocation && existingRevocation.notBefore > now
      ? existingRevocation.notBefore
      : now;

  if (!existingRevocation) {
    await tx.authAccessRevocation.create({
      data: {
        address: session.address,
        notBefore: nextNotBefore,
        reason: "refresh_context_mismatch",
        actorAddress: "system",
      },
    });
  } else {
    await tx.authAccessRevocation.update({
      where: { address: session.address },
      data: {
        notBefore: nextNotBefore,
        reason: "refresh_context_mismatch",
        actorAddress: "system",
        requestId: null,
      },
    });
  }

  logger.warn("Refresh session context mismatch; session family revoked", {
    address: session.address,
    sessionId: session.id,
    revokedCount: result.count,
    accessTokenNotBefore: nextNotBefore.toISOString(),
  });
}

function buildLoginMessage(
  address: string,
  nonce: string,
  issuedAt: Date,
  expiresAt: Date,
): string {
  const networkBinding = getLoginNetworkBinding();
  return [
    `${LOGIN_DOMAIN} login`,
    `Address: ${address}`,
    `Network: ${networkBinding.network}`,
    `EVM Chain ID: ${networkBinding.evmChainId}`,
    `Network Anchor: ${networkBinding.networkAnchor}`,
    `Nonce: ${nonce}`,
    `Issued At: ${issuedAt.toISOString()}`,
    `Expires At: ${expiresAt.toISOString()}`,
  ].join("\n");
}

function parseLoginMessage(message: string): {
  address: string;
  network: string;
  evmChainId: string;
  networkAnchor: string;
  nonce: string;
  issuedAt: Date;
  expiresAt: Date;
} {
  const lines = message.split("\n");
  if (lines.length !== 8 || lines[0] !== `${LOGIN_DOMAIN} login`) {
    throw new Error("Invalid login challenge format");
  }

  const address = parseMessageField(lines[1], "Address");
  const network = parseMessageField(lines[2], "Network");
  const evmChainId = parseMessageField(lines[3], "EVM Chain ID");
  const networkAnchor = parseMessageField(lines[4], "Network Anchor");
  const nonce = parseMessageField(lines[5], "Nonce");
  const issuedAt = new Date(parseMessageField(lines[6], "Issued At"));
  const expiresAt = new Date(parseMessageField(lines[7], "Expires At"));
  const expectedBinding = getLoginNetworkBinding();

  if (
    !nonce ||
    Number.isNaN(issuedAt.getTime()) ||
    Number.isNaN(expiresAt.getTime())
  ) {
    throw new Error("Invalid login challenge fields");
  }

  if (
    network !== expectedBinding.network ||
    evmChainId !== expectedBinding.evmChainId ||
    networkAnchor !== expectedBinding.networkAnchor
  ) {
    throw new Error("Login challenge network binding mismatch");
  }

  if (Date.now() > expiresAt.getTime()) {
    throw new Error("Login challenge expired");
  }

  return {
    address: normalizeAddress(address),
    network,
    evmChainId,
    networkAnchor,
    nonce,
    issuedAt,
    expiresAt,
  };
}

function getLoginNetworkBinding(): {
  network: string;
  evmChainId: string;
  networkAnchor: string;
} {
  return {
    // Production configuration requires both values. Explicit non-production
    // sentinels keep local challenges deterministic without pretending they
    // belong to a deployable Aethelred network.
    network: config.network ?? "local-unconfigured",
    evmChainId: config.indexerExpectedChainId ?? "local-unconfigured",
    networkAnchor: config.indexerExpectedGenesisHash ?? "local-unconfigured",
  };
}

function parseMessageField(line: string, field: string): string {
  const prefix = `${field}: `;
  if (!line.startsWith(prefix)) {
    throw new Error(`Missing ${field} in login challenge`);
  }
  return line.slice(prefix.length).trim();
}

function normalizeAddress(address: string): string {
  return address.trim().toLowerCase();
}

function hashSecret(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function buildTokenSession(
  payload: TokenPayload,
  context: SessionContext,
  parentSessionId?: string,
): { tokens: AuthTokens; session: StoredRefreshSession } {
  const refreshSessionId = randomUUID();
  const refreshTokenId = randomUUID();
  const tokens = generateTokens(payload, {
    refreshSessionId,
    refreshTokenId,
  });
  const verifiedRefreshToken = verifyRefreshToken(tokens.refreshToken);

  return {
    tokens,
    session: {
      id: refreshSessionId,
      address: payload.address,
      roles: payload.roles,
      tokenHash: hashSecret(tokens.refreshToken),
      parentSessionId,
      userAgentHash: context.userAgent ? hashSecret(context.userAgent) : null,
      ipHash: context.ip ? hashSecret(context.ip) : null,
      expiresAt: verifiedRefreshToken.expiresAt,
      createdAt: new Date(),
    },
  };
}

function summarizeRefreshSession(
  session: StoredRefreshSession,
  now: Date,
): RefreshSessionSummary {
  return {
    sessionId: session.id,
    parentSessionId: session.parentSessionId ?? null,
    address: session.address,
    roles: session.roles,
    status: getRefreshSessionStatus(session, now),
    expiresAt: session.expiresAt.toISOString(),
    createdAt: session.createdAt?.toISOString() ?? null,
    rotatedAt: session.rotatedAt?.toISOString() ?? null,
    revokedAt: session.revokedAt?.toISOString() ?? null,
    hasUserAgentBinding: Boolean(session.userAgentHash),
    hasIpBinding: Boolean(session.ipHash),
  };
}

function getRefreshSessionStatus(
  session: StoredRefreshSession,
  now: Date,
): RefreshSessionSummary["status"] {
  if (session.revokedAt) {
    return "revoked";
  }
  if (session.rotatedAt) {
    return "rotated";
  }
  if (session.expiresAt <= now) {
    return "expired";
  }
  return "active";
}

function hasRefreshSessionContextMismatch(
  session: StoredRefreshSession,
  nextSession: StoredRefreshSession,
): boolean {
  return Boolean(
    session.userAgentHash &&
    session.userAgentHash !== nextSession.userAgentHash,
  );
}

function logRefreshSessionIpDrift(
  session: StoredRefreshSession,
  nextSession: StoredRefreshSession,
): void {
  if (
    session.ipHash &&
    nextSession.ipHash &&
    session.ipHash !== nextSession.ipHash
  ) {
    logger.warn("Refresh session IP context changed during rotation", {
      address: session.address,
      sessionId: session.id,
    });
  }
}

/**
 * Parse expiration string to seconds. Supports minutes, hours, and days, matching the
 * config schema.
 */
function parseExpiration(expiresIn: string): number {
  const match = expiresIn.match(/^(\d+)([mhd])$/);
  if (!match) {
    return 900;
  }

  const value = parseInt(match[1], 10);
  const unit = match[2];

  if (unit === "m") {
    return value * 60;
  }
  if (unit === "h") {
    return value * 3600;
  }
  if (unit === "d") {
    return value * 86400;
  }

  return 900;
}

async function storeNonce(nonce: StoredNonce): Promise<void> {
  if (!authPrisma) {
    memoryNonces.set(nonce.nonceHash, nonce);
    return;
  }

  await authPrisma.authNonce.create({
    data: {
      address: nonce.address,
      nonceHash: nonce.nonceHash,
      message: nonce.message,
      expiresAt: nonce.expiresAt,
    },
  });
}

async function findValidNonce(nonceHash: string): Promise<StoredNonce | null> {
  const now = new Date();

  if (!authPrisma) {
    const nonce = memoryNonces.get(nonceHash);
    if (!nonce || nonce.consumedAt || nonce.expiresAt <= now) {
      return null;
    }
    return nonce;
  }

  return authPrisma.authNonce.findFirst({
    where: {
      nonceHash,
      consumedAt: null,
      expiresAt: { gt: now },
    },
  });
}

async function consumeNonce(nonceHash: string): Promise<boolean> {
  const now = new Date();

  if (!authPrisma) {
    const nonce = memoryNonces.get(nonceHash);
    if (!nonce || nonce.consumedAt || nonce.expiresAt <= now) {
      return false;
    }
    nonce.consumedAt = now;
    return true;
  }

  const result = await authPrisma.authNonce.updateMany({
    where: {
      nonceHash,
      consumedAt: null,
      expiresAt: { gt: now },
    },
    data: { consumedAt: now },
  });

  return result.count === 1;
}

async function storeRefreshSession(
  session: StoredRefreshSession,
): Promise<void> {
  if (!authPrisma) {
    memoryRefreshSessions.set(session.tokenHash, session);
    return;
  }

  await authPrisma.authRefreshSession.create({
    data: {
      id: session.id,
      address: session.address,
      roles: session.roles,
      tokenHash: session.tokenHash,
      parentSessionId: session.parentSessionId,
      userAgentHash: session.userAgentHash,
      ipHash: session.ipHash,
      expiresAt: session.expiresAt,
    },
  });
}

async function findRefreshSession(
  tokenHash: string,
): Promise<StoredRefreshSession | null> {
  if (!authPrisma) {
    return memoryRefreshSessions.get(tokenHash) ?? null;
  }

  return authPrisma.authRefreshSession.findUnique({
    where: { tokenHash },
  });
}

async function findRefreshSessionsForAddress(
  address: string,
): Promise<StoredRefreshSession[]> {
  if (!authPrisma) {
    return [...memoryRefreshSessions.values()]
      .filter((session) => session.address === address)
      .sort((a, b) => {
        const bCreated = b.createdAt?.getTime() ?? 0;
        const aCreated = a.createdAt?.getTime() ?? 0;
        return bCreated - aCreated;
      });
  }

  return authPrisma.authRefreshSession.findMany({
    where: { address },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
}

async function findAccessRevocationForAddress(
  address: string,
): Promise<StoredAccessRevocation | null> {
  if (!authPrisma) {
    return memoryAccessRevocations.get(address) ?? null;
  }

  return authPrisma.authAccessRevocation.findUnique({
    where: { address },
  });
}

async function upsertAccessRevocationForAddress(
  address: string,
  notBefore: Date,
  auditContext: AccessRevocationAuditContext,
): Promise<StoredAccessRevocation> {
  if (!authPrisma) {
    const existing = memoryAccessRevocations.get(address);
    const nextNotBefore =
      existing && existing.notBefore > notBefore
        ? existing.notBefore
        : notBefore;
    const revocation: StoredAccessRevocation = {
      address,
      notBefore: nextNotBefore,
      reason: auditContext.reason,
      actorAddress: auditContext.actorAddress,
      requestId: auditContext.requestId ?? null,
      createdAt: existing?.createdAt ?? new Date(),
      updatedAt: new Date(),
    };
    memoryAccessRevocations.set(address, revocation);
    return revocation;
  }

  return authPrisma.$transaction(async (tx) => {
    const existing = await tx.authAccessRevocation.findUnique({
      where: { address },
    });
    const nextNotBefore =
      existing && existing.notBefore > notBefore
        ? existing.notBefore
        : notBefore;

    if (!existing) {
      return tx.authAccessRevocation.create({
        data: {
          address,
          notBefore: nextNotBefore,
          reason: auditContext.reason,
          actorAddress: auditContext.actorAddress,
          requestId: auditContext.requestId,
        },
      });
    }

    return tx.authAccessRevocation.update({
      where: { address },
      data: {
        notBefore: nextNotBefore,
        reason: auditContext.reason,
        actorAddress: auditContext.actorAddress,
        requestId: auditContext.requestId,
      },
    });
  });
}

async function rotateRefreshSession(
  tokenHash: string,
  nextSession: StoredRefreshSession,
): Promise<RotateRefreshSessionResult> {
  const now = new Date();

  if (!authPrisma) {
    const session = memoryRefreshSessions.get(tokenHash);
    if (!isRefreshSessionUsable(session, now)) {
      return null;
    }
    if (hasRefreshSessionContextMismatch(session, nextSession)) {
      await revokeSessionFamilyOnContextMismatch(session);
      return REFRESH_CONTEXT_MISMATCH;
    }
    session.revokedAt = now;
    session.rotatedAt = now;
    memoryRefreshSessions.set(nextSession.tokenHash, nextSession);
    return session;
  }

  return authPrisma.$transaction(async (tx) => {
    const session = await tx.authRefreshSession.findUnique({
      where: { tokenHash },
    });

    if (!isRefreshSessionUsable(session, now)) {
      return null;
    }
    if (hasRefreshSessionContextMismatch(session, nextSession)) {
      await revokeSessionFamilyOnContextMismatchInTransaction(tx, session, now);
      return REFRESH_CONTEXT_MISMATCH;
    }

    const result = await tx.authRefreshSession.updateMany({
      where: {
        tokenHash,
        revokedAt: null,
        rotatedAt: null,
        expiresAt: { gt: now },
      },
      data: {
        revokedAt: now,
        rotatedAt: now,
      },
    });

    if (result.count !== 1) {
      return null;
    }

    await tx.authRefreshSession.create({
      data: {
        id: nextSession.id,
        address: nextSession.address,
        roles: nextSession.roles,
        tokenHash: nextSession.tokenHash,
        parentSessionId: nextSession.parentSessionId,
        userAgentHash: nextSession.userAgentHash,
        ipHash: nextSession.ipHash,
        expiresAt: nextSession.expiresAt,
      },
    });

    return {
      ...session,
      revokedAt: now,
      rotatedAt: now,
    };
  });
}

async function revokeRefreshSession(
  tokenHash: string,
): Promise<StoredRefreshSession | null> {
  const now = new Date();

  if (!authPrisma) {
    const session = memoryRefreshSessions.get(tokenHash);
    if (!session) {
      return null;
    }
    session.revokedAt = now;
    return session;
  }

  return authPrisma.$transaction(async (tx) => {
    const session = await tx.authRefreshSession.findUnique({
      where: { tokenHash },
    });

    if (!session) {
      return null;
    }

    await tx.authRefreshSession.update({
      where: { tokenHash },
      data: { revokedAt: now },
    });

    return {
      ...session,
      revokedAt: now,
    };
  });
}

async function revokeActiveRefreshSessionsForAddress(
  address: string,
): Promise<number> {
  const now = new Date();

  if (!authPrisma) {
    let revokedCount = 0;
    for (const session of memoryRefreshSessions.values()) {
      if (session.address === address && isRefreshSessionUsable(session, now)) {
        session.revokedAt = now;
        revokedCount += 1;
      }
    }
    return revokedCount;
  }

  const result = await authPrisma.authRefreshSession.updateMany({
    where: {
      address,
      revokedAt: null,
      rotatedAt: null,
      expiresAt: { gt: now },
    },
    data: { revokedAt: now },
  });

  return result.count;
}

function isRefreshSessionUsable(
  session: StoredRefreshSession | null | undefined,
  now: Date,
): session is StoredRefreshSession {
  return Boolean(
    session &&
    !session.revokedAt &&
    !session.rotatedAt &&
    session.expiresAt > now,
  );
}

async function cleanupExpiredDbAuthArtifacts(
  prisma: PrismaClient,
  now: Date,
): Promise<void> {
  const [nonceResult, refreshSessionResult] = await Promise.all([
    prisma.authNonce.deleteMany({
      where: {
        OR: [{ expiresAt: { lte: now } }, { consumedAt: { not: null } }],
      },
    }),
    prisma.authRefreshSession.deleteMany({
      where: {
        expiresAt: { lte: now },
      },
    }),
  ]);

  if (nonceResult.count > 0 || refreshSessionResult.count > 0) {
    logger.info("Expired auth artifacts cleaned up", {
      authNonceCount: nonceResult.count,
      authRefreshSessionCount: refreshSessionResult.count,
    });
  }
}

function cleanupExpiredMemoryState(): void {
  if (authPrisma) {
    return;
  }

  const now = new Date();
  for (const [nonceHash, nonce] of memoryNonces) {
    if (nonce.expiresAt <= now || nonce.consumedAt) {
      memoryNonces.delete(nonceHash);
    }
  }

  for (const [tokenHash, session] of memoryRefreshSessions) {
    if (session.expiresAt <= now) {
      memoryRefreshSessions.delete(tokenHash);
    }
  }
}

/**
 * Verify a Cosmos-style signed message (ADR-036).
 */
export async function verifySignature(
  address: string,
  message: string,
  signature: string,
): Promise<boolean> {
  logger.info("Verifying signature", { address });

  if (config.allowMockSignatures) {
    logger.warn(
      "Using mock signature verification. This is blocked in production by config guards.",
    );
    return signature.length > 0 && message.includes("Aethelred");
  }

  try {
    if (!address || !message || !signature) {
      logger.warn("Signature verification failed: missing inputs");
      return false;
    }

    let sigData: {
      pub_key?: { type?: string; value?: string };
      signature?: string;
    };
    try {
      sigData = JSON.parse(Buffer.from(signature, "base64").toString("utf-8"));
    } catch {
      logger.warn("Signature verification failed: invalid base64 or JSON");
      return false;
    }

    if (!sigData.pub_key?.value || !sigData.signature) {
      logger.warn("Signature verification failed: malformed signature payload");
      return false;
    }

    const pubKeyBytes = fromBase64(sigData.pub_key.value);
    const signatureBytes = fromBase64(sigData.signature);
    const signDoc: StdSignDoc = {
      chain_id: "",
      account_number: "0",
      sequence: "0",
      fee: { gas: "0", amount: [] },
      msgs: [
        {
          type: "sign/MsgSignData",
          value: {
            signer: address,
            data: Buffer.from(message, "utf-8").toString("base64"),
          },
        },
      ],
      memo: "",
    };

    const signBytes = serializeSignDoc(signDoc);
    const messageHash = new CryptoSha256(signBytes).digest();
    const trimmedSig = Secp256k1.trimRecoveryByte(signatureBytes);
    const sig = Secp256k1Signature.fromFixedLength(trimmedSig);
    const valid = await Secp256k1.verifySignature(
      sig,
      messageHash,
      pubKeyBytes,
    );

    if (!valid) {
      logger.warn("Signature verification failed: secp256k1 check rejected");
      return false;
    }

    const pubKeyHash = new Ripemd160(
      new CryptoSha256(pubKeyBytes).digest(),
    ).digest();
    const { prefix } = fromBech32(address);
    const derivedAddress = toBech32(prefix, pubKeyHash);

    if (derivedAddress !== address) {
      logger.warn("Signature verification failed: address mismatch", {
        expected: address,
        derived: derivedAddress,
      });
      return false;
    }

    logger.info("Signature verified successfully", { address });
    return true;
  } catch (error) {
    logger.error("Signature verification threw", errorContext(error));
    return false;
  }
}
