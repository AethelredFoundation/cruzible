/**
 * Authentication Service
 * Handles JWT token generation, validation, and refresh
 */

import jwt, { type SignOptions } from 'jsonwebtoken';
import { config } from '../config';
import { logger } from '../utils/logger';

export interface TokenPayload {
  address: string;
  roles: string[];
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

interface RefreshTokenPayload {
  address: string;
  roles: string[];
  type?: string;
}

/**
 * Generate JWT access and refresh tokens
 */
export function generateTokens(payload: TokenPayload): AuthTokens {
  const accessOptions: SignOptions = {
    expiresIn: config.jwtExpiresIn as SignOptions['expiresIn'],
    issuer: 'aethelred-api',
    audience: 'aethelred-client',
  };

  const accessToken = jwt.sign(
    {
      address: payload.address,
      roles: payload.roles,
    },
    config.jwtSecret,
    accessOptions
  );

  const refreshOptions: SignOptions = {
    expiresIn: config.jwtRefreshExpiresIn as SignOptions['expiresIn'],
    issuer: 'aethelred-api',
  };

  const refreshToken = jwt.sign(
    {
      address: payload.address,
      roles: payload.roles,
      type: 'refresh',
    },
    config.jwtRefreshSecret,
    refreshOptions
  );

  // Parse expiresIn to get numeric value
  const expiresInSeconds = parseExpiration(config.jwtExpiresIn);

  return {
    accessToken,
    refreshToken,
    expiresIn: expiresInSeconds,
  };
}

/**
 * Verify and decode access token
 */
export function verifyAccessToken(token: string): TokenPayload {
  return jwt.verify(token, config.jwtSecret, {
    algorithms: ['HS256'],
    issuer: 'aethelred-api',
    audience: 'aethelred-client',
  }) as TokenPayload;
}

/**
 * Verify refresh token and return payload
 */
export function verifyRefreshToken(token: string): { address: string; roles: string[] } {
  const payload = jwt.verify(token, config.jwtRefreshSecret, {
    algorithms: ['HS256'],
    issuer: 'aethelred-api',
  }) as RefreshTokenPayload;
  
  if (payload.type !== 'refresh') {
    throw new Error('Invalid token type');
  }

  return {
    address: payload.address,
    roles: payload.roles,
  };
}

/**
 * Refresh access token using refresh token.
 * HIGH-3 FIX: Checks blacklist before issuing new tokens.
 */
export function refreshAccessToken(refreshToken: string): AuthTokens {
  try {
    // HIGH-3: Check if the refresh token has been revoked
    if (isTokenRevoked(refreshToken)) {
      logger.warn('Attempted use of revoked refresh token');
      throw new Error('Refresh token has been revoked');
    }

    const { address, roles } = verifyRefreshToken(refreshToken);

    // Generate new tokens
    return generateTokens({ address, roles });
  } catch (error) {
    logger.error('Token refresh failed', { error });
    throw new Error('Invalid refresh token');
  }
}

/**
 * Parse expiration string to seconds
 * Supports: '1h', '1d', '7d', '30d'
 */
function parseExpiration(expiresIn: string): number {
  const match = expiresIn.match(/^(\d+)([hd])$/);
  if (!match) {
    return 3600; // Default 1 hour
  }

  const value = parseInt(match[1], 10);
  const unit = match[2];

  if (unit === 'h') {
    return value * 3600;
  } else if (unit === 'd') {
    return value * 86400;
  }

  return 3600;
}

// ---------------------------------------------------------------------------
// HIGH-3 FIX: Token revocation via in-memory blacklist with TTL cleanup.
// For production at scale, replace with Redis SET + EXPIRE. This in-process
// implementation is correct for single-instance deployments and tests.
// ---------------------------------------------------------------------------

/** Blacklisted refresh tokens with their expiry timestamps */
const revokedTokens = new Map<string, number>();

/** Periodic cleanup of expired blacklist entries (every 10 minutes) */
const BLACKLIST_CLEANUP_INTERVAL_MS = 10 * 60 * 1000;
let cleanupTimer: ReturnType<typeof setInterval> | null = null;

function ensureCleanupTimer(): void {
  if (cleanupTimer) return;
  cleanupTimer = setInterval(() => {
    const now = Date.now() / 1000;
    for (const [token, expiry] of revokedTokens) {
      if (now > expiry) {
        revokedTokens.delete(token);
      }
    }
  }, BLACKLIST_CLEANUP_INTERVAL_MS);
  // Allow process to exit even if timer is running
  if (cleanupTimer && typeof cleanupTimer === 'object' && 'unref' in cleanupTimer) {
    (cleanupTimer as NodeJS.Timeout).unref();
  }
}

/**
 * Revoke a refresh token by adding it to the blacklist.
 * The token remains blacklisted until its natural expiry.
 */
export async function revokeRefreshToken(token: string): Promise<void> {
  try {
    // Decode (without verification) to extract expiry for blacklist TTL
    const decoded = jwt.decode(token) as { exp?: number } | null;
    const expiry = decoded?.exp ?? Math.floor(Date.now() / 1000) + 7 * 86400; // fallback 7d
    revokedTokens.set(token, expiry);
    ensureCleanupTimer();
    logger.info('Refresh token revoked and blacklisted', {
      tokenPrefix: token.substring(0, 20) + '...',
    });
  } catch (error) {
    logger.error('Failed to revoke token', { error });
  }
}

/**
 * Check whether a refresh token has been revoked.
 */
export function isTokenRevoked(token: string): boolean {
  return revokedTokens.has(token);
}

// ---------------------------------------------------------------------------
// HIGH-2 FIX: Real cryptographic signature verification using Cosmos
// secp256k1 message signing (ADR-036). The mock path is guarded by
// ALLOW_MOCK_SIGNATURES and is blocked in production by config/index.ts.
// ---------------------------------------------------------------------------

import { Secp256k1, Secp256k1Signature, Sha256 as CryptoSha256, Ripemd160 } from '@cosmjs/crypto';
import { fromBase64, toBech32, fromBech32 } from '@cosmjs/encoding';
import { serializeSignDoc, type StdSignDoc } from '@cosmjs/amino';

/**
 * Verify a Cosmos-style signed message (ADR-036).
 *
 * Production path:
 *  1. Reconstruct the Amino sign-doc from the message
 *  2. SHA-256 hash the canonical JSON bytes
 *  3. Verify secp256k1 signature against hash + public key
 *  4. Derive bech32 address from pubkey and compare to `address`
 *
 * Development path (ALLOW_MOCK_SIGNATURES=true):
 *  Falls back to a trivial check. Production startup is guarded against
 *  this flag in config/index.ts.
 */
export async function verifySignature(
  address: string,
  message: string,
  signature: string,
): Promise<boolean> {
  logger.info('Verifying signature', { address });

  // ── Mock path (development/test only) ──
  if (config.allowMockSignatures) {
    logger.warn(
      'Using MOCK signature verification (ALLOW_MOCK_SIGNATURES=true). ' +
        'This is blocked in production by config guards.',
    );
    // Minimal sanity: non-empty signature and message must contain domain tag
    return signature.length > 0 && message.includes('Aethelred');
  }

  // ── Production path: cryptographic verification ──
  try {
    // Validate inputs
    if (!address || !message || !signature) {
      logger.warn('Signature verification failed: missing inputs');
      return false;
    }

    // Decode the base64 envelope — expecting Amino StdSignature format:
    // { pub_key: { type, value }, signature }
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

    // Decode raw bytes
    const pubKeyBytes = fromBase64(sigData.pub_key.value);
    const signatureBytes = fromBase64(sigData.signature);

    // 1. Reconstruct ADR-036 sign-doc
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

    // 2. Canonical JSON → SHA-256
    const signBytes = serializeSignDoc(signDoc);
    const messageHash = new CryptoSha256(signBytes).digest();

    // 3. Verify secp256k1 signature
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

    // 4. Derive bech32 address from public key and compare
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
