/**
 * Authentication service for wallet-backed login, JWT issuance, refresh
 * rotation, logout revocation, and Cosmos ADR-036 signature verification.
 */

import { randomBytes, randomUUID, createHash } from 'crypto';
import { Secp256k1, Secp256k1Signature, Sha256 as CryptoSha256, Ripemd160 } from '@cosmjs/crypto';
import { fromBase64, toBech32, fromBech32 } from '@cosmjs/encoding';
import { serializeSignDoc, type StdSignDoc } from '@cosmjs/amino';
import { PrismaClient } from '@prisma/client';
import jwt, { type SignOptions } from 'jsonwebtoken';
import { config } from '../config';
import { logger } from '../utils/logger';

const ACCESS_TOKEN_AUDIENCE = 'aethelred-client';
const TOKEN_ISSUER = 'aethelred-api';
const LOGIN_DOMAIN = 'Aethelred Cruzible API';
const NONCE_BYTES = 24;

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

export interface TokenPayload {
  address: string;
  roles: string[];
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
  status: 'active' | 'expired' | 'revoked' | 'rotated';
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
    expiresIn: config.jwtExpiresIn as SignOptions['expiresIn'],
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
    expiresIn: config.jwtRefreshExpiresIn as SignOptions['expiresIn'],
    issuer: TOKEN_ISSUER,
    jwtid: refreshTokenId,
  };

  const refreshToken = jwt.sign(
    {
      address: payload.address,
      roles: payload.roles,
      sid: refreshSessionId,
      type: 'refresh',
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
    algorithms: ['HS256'],
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
    algorithms: ['HS256'],
    issuer: TOKEN_ISSUER,
  }) as RefreshTokenPayload;

  if (payload.type !== 'refresh') {
    throw new Error('Invalid token type');
  }

  if (!payload.jti || !payload.sid || !payload.exp) {
    throw new Error('Refresh token missing rotation metadata');
  }

  return {
    address: payload.address,
    roles: payload.roles,
    refreshTokenId: payload.jti,
    refreshSessionId: payload.sid,
    expiresAt: new Date(payload.exp * 1000),
  };
}

export async function createLoginChallenge(address: string): Promise<LoginChallenge> {
  cleanupExpiredMemoryState();

  const normalizedAddress = normalizeAddress(address);
  const nonce = randomBytes(NONCE_BYTES).toString('base64url');
  const issuedAt = new Date();
  const expiresAt = new Date(issuedAt.getTime() + config.authNonceTtlMs);
  const message = buildLoginMessage(normalizedAddress, nonce, issuedAt, expiresAt);
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
    throw new Error('Login challenge address mismatch');
  }

  const storedNonce = await findValidNonce(hashSecret(parsedMessage.nonce));
  if (!storedNonce || storedNonce.address !== normalizedAddress || storedNonce.message !== message) {
    throw new Error('Invalid or expired login challenge');
  }

  const signatureValid = await verifySignature(normalizedAddress, message, signature);
  if (!signatureValid) {
    throw new Error('Invalid login signature');
  }

  const consumed = await consumeNonce(storedNonce.nonceHash);
  if (!consumed) {
    throw new Error('Login challenge has already been used');
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
  const { tokens, session } = buildTokenSession(payload, context, parentSessionId);
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

    if (!rotated || rotated.address !== verified.address) {
      throw new Error('Refresh session is invalid or already rotated');
    }

    logRefreshSessionIpDrift(rotated, nextSession);

    return tokens;
  } catch (error) {
    logger.warn('Token refresh rejected', { error });
    const invalidRefreshTokenError = new Error('Invalid refresh token') as Error & {
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
    throw new Error('Refresh session not found');
  }

  logger.info('Refresh token revoked', { address: verified.address });
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
  const revokedCount = await revokeActiveRefreshSessionsForAddress(
    normalizedAddress,
  );

  logger.info('Refresh sessions revoked for address', {
    address: normalizedAddress,
    actorAddress: auditContext?.actorAddress,
    requestId: auditContext?.requestId,
    revokedCount,
  });

  return {
    address: normalizedAddress,
    revokedCount,
  };
}

function resolveRolesForAddress(address: string): string[] {
  const normalizedAddress = normalizeAddress(address);
  const roles = new Set<string>(['user']);

  if (config.authAdminAddresses.includes(normalizedAddress)) {
    roles.add('operator');
    roles.add('admin');
  }

  if (config.authOperatorAddresses.includes(normalizedAddress)) {
    roles.add('operator');
  }

  return [...roles];
}

function buildLoginMessage(
  address: string,
  nonce: string,
  issuedAt: Date,
  expiresAt: Date,
): string {
  return [
    `${LOGIN_DOMAIN} login`,
    `Address: ${address}`,
    `Nonce: ${nonce}`,
    `Issued At: ${issuedAt.toISOString()}`,
    `Expires At: ${expiresAt.toISOString()}`,
  ].join('\n');
}

function parseLoginMessage(message: string): {
  address: string;
  nonce: string;
  issuedAt: Date;
  expiresAt: Date;
} {
  const lines = message.split('\n');
  if (lines.length !== 5 || lines[0] !== `${LOGIN_DOMAIN} login`) {
    throw new Error('Invalid login challenge format');
  }

  const address = parseMessageField(lines[1], 'Address');
  const nonce = parseMessageField(lines[2], 'Nonce');
  const issuedAt = new Date(parseMessageField(lines[3], 'Issued At'));
  const expiresAt = new Date(parseMessageField(lines[4], 'Expires At'));

  if (!nonce || Number.isNaN(issuedAt.getTime()) || Number.isNaN(expiresAt.getTime())) {
    throw new Error('Invalid login challenge fields');
  }

  if (Date.now() > expiresAt.getTime()) {
    throw new Error('Login challenge expired');
  }

  return {
    address: normalizeAddress(address),
    nonce,
    issuedAt,
    expiresAt,
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
  return createHash('sha256').update(value).digest('hex');
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
): RefreshSessionSummary['status'] {
  if (session.revokedAt) {
    return 'revoked';
  }
  if (session.rotatedAt) {
    return 'rotated';
  }
  if (session.expiresAt <= now) {
    return 'expired';
  }
  return 'active';
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
    logger.warn('Refresh session IP context changed during rotation', {
      address: session.address,
      sessionId: session.id,
    });
  }
}

/**
 * Parse expiration string to seconds. Supports hours and days, matching the
 * config schema.
 */
function parseExpiration(expiresIn: string): number {
  const match = expiresIn.match(/^(\d+)([hd])$/);
  if (!match) {
    return 3600;
  }

  const value = parseInt(match[1], 10);
  const unit = match[2];

  if (unit === 'h') {
    return value * 3600;
  }
  if (unit === 'd') {
    return value * 86400;
  }

  return 3600;
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

async function storeRefreshSession(session: StoredRefreshSession): Promise<void> {
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

async function findRefreshSession(tokenHash: string): Promise<StoredRefreshSession | null> {
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
    orderBy: { createdAt: 'desc' },
    take: 100,
  });
}

async function rotateRefreshSession(
  tokenHash: string,
  nextSession: StoredRefreshSession,
): Promise<StoredRefreshSession | null> {
  const now = new Date();

  if (!authPrisma) {
    const session = memoryRefreshSessions.get(tokenHash);
    if (!isRefreshSessionUsable(session, now)) {
      return null;
    }
    if (hasRefreshSessionContextMismatch(session, nextSession)) {
      logger.warn('Refresh session context mismatch during rotation', {
        address: session.address,
        sessionId: session.id,
      });
      return null;
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
      logger.warn('Refresh session context mismatch during rotation', {
        address: session.address,
        sessionId: session.id,
      });
      return null;
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
  logger.info('Verifying signature', { address });

  if (config.allowMockSignatures) {
    logger.warn(
      'Using mock signature verification. This is blocked in production by config guards.',
    );
    return signature.length > 0 && message.includes('Aethelred');
  }

  try {
    if (!address || !message || !signature) {
      logger.warn('Signature verification failed: missing inputs');
      return false;
    }

    let sigData: { pub_key?: { type?: string; value?: string }; signature?: string };
    try {
      sigData = JSON.parse(
        Buffer.from(signature, 'base64').toString('utf-8'),
      );
    } catch {
      logger.warn('Signature verification failed: invalid base64 or JSON');
      return false;
    }

    if (!sigData.pub_key?.value || !sigData.signature) {
      logger.warn('Signature verification failed: malformed signature payload');
      return false;
    }

    const pubKeyBytes = fromBase64(sigData.pub_key.value);
    const signatureBytes = fromBase64(sigData.signature);
    const signDoc: StdSignDoc = {
      chain_id: '',
      account_number: '0',
      sequence: '0',
      fee: { gas: '0', amount: [] },
      msgs: [
        {
          type: 'sign/MsgSignData',
          value: {
            signer: address,
            data: Buffer.from(message, 'utf-8').toString('base64'),
          },
        },
      ],
      memo: '',
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
      logger.warn('Signature verification failed: secp256k1 check rejected');
      return false;
    }

    const pubKeyHash = new Ripemd160(new CryptoSha256(pubKeyBytes).digest()).digest();
    const { prefix } = fromBech32(address);
    const derivedAddress = toBech32(prefix, pubKeyHash);

    if (derivedAddress !== address) {
      logger.warn('Signature verification failed: address mismatch', {
        expected: address,
        derived: derivedAddress,
      });
      return false;
    }

    logger.info('Signature verified successfully', { address });
    return true;
  } catch (error) {
    logger.error('Signature verification threw', { error });
    return false;
  }
}
