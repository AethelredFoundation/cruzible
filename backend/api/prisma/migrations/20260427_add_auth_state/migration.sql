-- Persistent authentication state for nonce-backed login and refresh rotation.

CREATE TABLE "AuthNonce" (
    "id" TEXT NOT NULL,
    "address" VARCHAR(64) NOT NULL,
    "nonceHash" VARCHAR(64) NOT NULL,
    "message" VARCHAR(1000) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuthNonce_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AuthRefreshSession" (
    "id" TEXT NOT NULL,
    "address" VARCHAR(64) NOT NULL,
    "roles" TEXT[] NOT NULL,
    "tokenHash" VARCHAR(64) NOT NULL,
    "parentSessionId" VARCHAR(36),
    "userAgentHash" VARCHAR(64),
    "ipHash" VARCHAR(64),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "rotatedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuthRefreshSession_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AuthNonce_nonceHash_key" ON "AuthNonce"("nonceHash");
CREATE INDEX "AuthNonce_address_idx" ON "AuthNonce"("address");
CREATE INDEX "AuthNonce_expiresAt_idx" ON "AuthNonce"("expiresAt");

CREATE UNIQUE INDEX "AuthRefreshSession_tokenHash_key" ON "AuthRefreshSession"("tokenHash");
CREATE INDEX "AuthRefreshSession_address_idx" ON "AuthRefreshSession"("address");
CREATE INDEX "AuthRefreshSession_expiresAt_idx" ON "AuthRefreshSession"("expiresAt");
CREATE INDEX "AuthRefreshSession_revokedAt_idx" ON "AuthRefreshSession"("revokedAt");
