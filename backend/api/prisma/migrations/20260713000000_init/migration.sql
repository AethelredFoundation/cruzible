-- CreateEnum
CREATE TYPE "TxStatus" AS ENUM ('PENDING', 'SUCCESS', 'FAILED');

-- CreateEnum
CREATE TYPE "ValidatorStatus" AS ENUM ('UNSPECIFIED', 'UNBONDED', 'UNBONDING', 'BONDED');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('PENDING', 'ASSIGNED', 'COMPUTING', 'COMPLETED', 'VERIFIED', 'FAILED', 'EXPIRED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ProofType" AS ENUM ('TEE_ATTESTATION', 'ZK_PROOF', 'MPC_PROOF', 'OPTIMISTIC');

-- CreateEnum
CREATE TYPE "TEEType" AS ENUM ('INTEL_SGX', 'INTEL_TDX', 'AMD_SEV_SNP', 'AWS_NITRO', 'AZURE_SEV_SNP');

-- CreateEnum
CREATE TYPE "ModelCategory" AS ENUM ('GENERAL', 'MEDICAL', 'SCIENTIFIC', 'FINANCIAL', 'LEGAL', 'EDUCATIONAL', 'ENVIRONMENTAL');

-- CreateEnum
CREATE TYPE "SealStatus" AS ENUM ('ACTIVE', 'REVOKED', 'EXPIRED', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "ProposalStatus" AS ENUM ('UNSPECIFIED', 'DEPOSIT_PERIOD', 'VOTING_PERIOD', 'PASSED', 'REJECTED', 'FAILED');

-- CreateEnum
CREATE TYPE "ProposalCategory" AS ENUM ('PARAMETER_CHANGE', 'COMMUNITY_SPEND', 'TEXT_PROPOSAL', 'SOFTWARE_UPGRADE');

-- CreateEnum
CREATE TYPE "VoteOption" AS ENUM ('UNSPECIFIED', 'YES', 'ABSTAIN', 'NO', 'NO_WITH_VETO');

-- CreateEnum
CREATE TYPE "UnstakeStatus" AS ENUM ('PENDING', 'READY', 'CLAIMED');

-- CreateEnum
CREATE TYPE "ReconciliationDiscrepancySeverity" AS ENUM ('INFO', 'WARNING', 'CRITICAL');

-- CreateTable
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

-- CreateTable
CREATE TABLE "AuthRefreshSession" (
    "id" TEXT NOT NULL,
    "address" VARCHAR(64) NOT NULL,
    "roles" TEXT[],
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

-- CreateTable
CREATE TABLE "AuthAccessRevocation" (
    "address" VARCHAR(64) NOT NULL,
    "notBefore" TIMESTAMP(3) NOT NULL,
    "reason" VARCHAR(120),
    "actorAddress" VARCHAR(64),
    "requestId" VARCHAR(128),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AuthAccessRevocation_pkey" PRIMARY KEY ("address")
);

-- CreateTable
CREATE TABLE "PrivilegedAuditEvent" (
    "id" TEXT NOT NULL,
    "requestId" VARCHAR(128) NOT NULL,
    "method" VARCHAR(16) NOT NULL,
    "path" VARCHAR(512) NOT NULL,
    "principalType" VARCHAR(32) NOT NULL,
    "actorAddress" VARCHAR(64),
    "requiredRoles" TEXT[],
    "tokenRoles" TEXT[],
    "currentRoles" TEXT[],
    "decision" VARCHAR(16) NOT NULL,
    "reason" VARCHAR(120),
    "outcome" VARCHAR(16) NOT NULL,
    "statusCode" INTEGER NOT NULL,
    "responseTimeMs" DOUBLE PRECISION NOT NULL,
    "ipHash" VARCHAR(64) NOT NULL,
    "userAgentHash" VARCHAR(64) NOT NULL,
    "eventHash" VARCHAR(64) NOT NULL,
    "previousEventHash" VARCHAR(64),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PrivilegedAuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Block" (
    "id" TEXT NOT NULL,
    "height" BIGINT NOT NULL,
    "hash" VARCHAR(66) NOT NULL,
    "parentHash" VARCHAR(66) NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "proposer" VARCHAR(50) NOT NULL,
    "txCount" INTEGER NOT NULL DEFAULT 0,
    "gasUsed" BIGINT NOT NULL DEFAULT 0,
    "gasLimit" BIGINT NOT NULL DEFAULT 0,
    "size" INTEGER NOT NULL,
    "appHash" VARCHAR(66) NOT NULL,
    "stateRoot" VARCHAR(66),
    "txRoot" VARCHAR(66),
    "evidenceRoot" VARCHAR(66),
    "validatorsHash" VARCHAR(66),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Block_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Transaction" (
    "id" TEXT NOT NULL,
    "hash" VARCHAR(66) NOT NULL,
    "height" BIGINT NOT NULL,
    "blockIndex" INTEGER NOT NULL,
    "status" "TxStatus" NOT NULL DEFAULT 'PENDING',
    "gasUsed" BIGINT NOT NULL DEFAULT 0,
    "gasWanted" BIGINT NOT NULL DEFAULT 0,
    "gasPrice" TEXT,
    "fee" TEXT,
    "memo" TEXT,
    "code" INTEGER NOT NULL DEFAULT 0,
    "log" TEXT,
    "fromAddress" VARCHAR(50),
    "toAddress" VARCHAR(50),
    "blockHeight" BIGINT NOT NULL,
    "signers" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Transaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Message" (
    "id" TEXT NOT NULL,
    "typeUrl" VARCHAR(200) NOT NULL,
    "transactionId" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "sender" VARCHAR(50),
    "recipient" VARCHAR(50),
    "amount" TEXT,
    "validator" VARCHAR(50),

    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL,
    "address" VARCHAR(50) NOT NULL,
    "sequence" BIGINT NOT NULL DEFAULT 0,
    "txCount" BIGINT NOT NULL DEFAULT 0,
    "firstSeenAt" TIMESTAMP(3) NOT NULL,
    "lastSeenAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Balance" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "denom" VARCHAR(50) NOT NULL,
    "amount" TEXT NOT NULL,

    CONSTRAINT "Balance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Validator" (
    "id" TEXT NOT NULL,
    "operatorAddress" VARCHAR(50) NOT NULL,
    "consensusAddress" VARCHAR(50),
    "moniker" VARCHAR(100) NOT NULL,
    "identity" VARCHAR(50),
    "website" VARCHAR(100),
    "securityContact" VARCHAR(100),
    "details" TEXT,
    "tokens" TEXT NOT NULL,
    "delegatorShares" TEXT NOT NULL,
    "selfDelegation" TEXT,
    "commissionRate" TEXT NOT NULL,
    "commissionMaxRate" TEXT NOT NULL,
    "commissionMaxChangeRate" TEXT NOT NULL,
    "status" "ValidatorStatus" NOT NULL DEFAULT 'UNBONDED',
    "jailed" BOOLEAN NOT NULL DEFAULT false,
    "teeAttested" BOOLEAN NOT NULL DEFAULT false,
    "teeType" "TEEType",
    "teeMeasurement" VARCHAR(64),
    "missedBlocks" BIGINT NOT NULL DEFAULT 0,
    "blocksProduced" BIGINT NOT NULL DEFAULT 0,
    "aiJobsCompleted" BIGINT NOT NULL DEFAULT 0,
    "aiJobsFailed" BIGINT NOT NULL DEFAULT 0,
    "uptime" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "unbondingHeight" BIGINT,
    "unbondingTime" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Validator_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Delegation" (
    "id" TEXT NOT NULL,
    "delegatorId" TEXT NOT NULL,
    "validatorId" TEXT NOT NULL,
    "shares" TEXT NOT NULL,

    CONSTRAINT "Delegation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UnbondingDelegation" (
    "id" TEXT NOT NULL,
    "delegatorId" TEXT NOT NULL,
    "validator" VARCHAR(50) NOT NULL,
    "amount" TEXT NOT NULL,
    "completionTime" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UnbondingDelegation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Commission" (
    "id" TEXT NOT NULL,
    "validatorId" TEXT NOT NULL,
    "amount" TEXT NOT NULL,
    "denom" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Commission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AIJob" (
    "id" TEXT NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'PENDING',
    "modelHash" VARCHAR(64) NOT NULL,
    "inputHash" VARCHAR(64) NOT NULL,
    "outputHash" VARCHAR(64),
    "creatorId" TEXT NOT NULL,
    "validatorId" TEXT,
    "proofType" "ProofType" NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "maxCost" TEXT NOT NULL,
    "actualCost" TEXT,
    "timeout" BIGINT NOT NULL,
    "createdAtBlock" BIGINT NOT NULL,
    "completedAtBlock" BIGINT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "verificationScore" INTEGER,

    CONSTRAINT "AIJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TEEAttestation" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "teeType" "TEEType" NOT NULL,
    "quoteVersion" INTEGER NOT NULL,
    "quote" BYTEA NOT NULL,
    "reportData" BYTEA NOT NULL,
    "measurement" VARCHAR(64) NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "enclaveKey" BYTEA NOT NULL,

    CONSTRAINT "TEEAttestation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VerificationProof" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "proofType" "ProofType" NOT NULL,
    "zkProof" BYTEA,
    "mpcCommitment" VARCHAR(64),
    "challengeStart" BIGINT,
    "merkleRoot" VARCHAR(64),
    "merklePath" TEXT[],
    "merkleIndex" BIGINT,

    CONSTRAINT "VerificationProof_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ValidatorSignature" (
    "id" TEXT NOT NULL,
    "proofId" TEXT NOT NULL,
    "validatorAddress" VARCHAR(50) NOT NULL,
    "signature" BYTEA NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ValidatorSignature_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ComputeMetrics" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "cpuCycles" BIGINT NOT NULL,
    "memoryUsed" BIGINT NOT NULL,
    "computeTimeMs" BIGINT NOT NULL,
    "energyMj" BIGINT NOT NULL,

    CONSTRAINT "ComputeMetrics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Model" (
    "id" TEXT NOT NULL,
    "modelHash" VARCHAR(64) NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "owner" VARCHAR(50) NOT NULL,
    "architecture" VARCHAR(50) NOT NULL,
    "version" VARCHAR(20) NOT NULL,
    "category" "ModelCategory" NOT NULL,
    "inputSchema" TEXT NOT NULL,
    "outputSchema" TEXT NOT NULL,
    "storageUri" TEXT NOT NULL,
    "sizeBytes" BIGINT,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "totalJobs" BIGINT NOT NULL DEFAULT 0,
    "registeredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Model_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Seal" (
    "id" TEXT NOT NULL,
    "status" "SealStatus" NOT NULL DEFAULT 'ACTIVE',
    "jobId" VARCHAR(64) NOT NULL,
    "modelCommitment" VARCHAR(64) NOT NULL,
    "inputCommitment" VARCHAR(64) NOT NULL,
    "outputCommitment" VARCHAR(64) NOT NULL,
    "requester" VARCHAR(50) NOT NULL,
    "validators" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "revokedBy" VARCHAR(50),
    "revocationReason" TEXT,

    CONSTRAINT "Seal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Proposal" (
    "id" TEXT NOT NULL,
    "proposalId" BIGINT NOT NULL,
    "title" VARCHAR(500) NOT NULL,
    "description" TEXT NOT NULL,
    "status" "ProposalStatus" NOT NULL,
    "category" "ProposalCategory" NOT NULL,
    "proposer" VARCHAR(50) NOT NULL,
    "proposerAddress" VARCHAR(50) NOT NULL,
    "votesFor" TEXT NOT NULL,
    "votesAgainst" TEXT NOT NULL,
    "votesAbstain" TEXT NOT NULL,
    "turnout" DOUBLE PRECISION NOT NULL,
    "quorumPct" DOUBLE PRECISION NOT NULL,
    "submitTime" TIMESTAMP(3) NOT NULL,
    "depositEndTime" TIMESTAMP(3) NOT NULL,
    "votingStartTime" TIMESTAMP(3),
    "votingEndTime" TIMESTAMP(3),
    "totalDeposit" TEXT NOT NULL,

    CONSTRAINT "Proposal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Vote" (
    "id" TEXT NOT NULL,
    "proposalId" TEXT NOT NULL,
    "voter" VARCHAR(50) NOT NULL,
    "option" "VoteOption" NOT NULL,
    "weight" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "metadata" TEXT,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Vote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProposalDeposit" (
    "id" TEXT NOT NULL,
    "proposalId" TEXT NOT NULL,
    "depositor" VARCHAR(50) NOT NULL,
    "amount" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProposalDeposit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VaultState" (
    "id" TEXT NOT NULL,
    "totalStaked" TEXT NOT NULL,
    "totalShares" TEXT NOT NULL,
    "exchangeRate" TEXT NOT NULL,
    "currentEpoch" BIGINT NOT NULL DEFAULT 0,
    "currentApy" DOUBLE PRECISION NOT NULL,
    "totalStakers" BIGINT NOT NULL DEFAULT 0,
    "validatorsBacking" INTEGER NOT NULL,
    "unbondingPeriod" INTEGER NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VaultState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VaultStake" (
    "id" TEXT NOT NULL,
    "delegator" VARCHAR(50) NOT NULL,
    "amount" TEXT NOT NULL,
    "shares" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "txHash" VARCHAR(66) NOT NULL,
    "blockNumber" BIGINT,
    "logIndex" INTEGER,

    CONSTRAINT "VaultStake_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VaultUnstake" (
    "id" TEXT NOT NULL,
    "withdrawalId" BIGINT NOT NULL,
    "delegator" VARCHAR(50) NOT NULL,
    "shares" TEXT NOT NULL,
    "amount" TEXT NOT NULL,
    "startTime" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completionTime" TIMESTAMP(3) NOT NULL,
    "status" "UnstakeStatus" NOT NULL DEFAULT 'PENDING',
    "txHash" VARCHAR(66) NOT NULL,
    "claimTxHash" VARCHAR(66),
    "claimedAt" TIMESTAMP(3),
    "blockNumber" BIGINT,
    "logIndex" INTEGER,

    CONSTRAINT "VaultUnstake_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VaultReward" (
    "id" TEXT NOT NULL,
    "delegator" VARCHAR(50) NOT NULL,
    "amount" TEXT NOT NULL,
    "epoch" BIGINT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "claimed" BOOLEAN NOT NULL DEFAULT false,
    "claimedAt" TIMESTAMP(3),
    "txHash" VARCHAR(66),
    "blockNumber" BIGINT,
    "logIndex" INTEGER,

    CONSTRAINT "VaultReward_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VaultWithdrawal" (
    "id" TEXT NOT NULL,
    "withdrawalId" BIGINT NOT NULL,
    "delegator" VARCHAR(50) NOT NULL,
    "amount" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "txHash" VARCHAR(66) NOT NULL,
    "blockNumber" BIGINT,
    "logIndex" INTEGER,

    CONSTRAINT "VaultWithdrawal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StAethelTransfer" (
    "id" TEXT NOT NULL,
    "from" VARCHAR(50) NOT NULL,
    "to" VARCHAR(50) NOT NULL,
    "amount" TEXT NOT NULL,
    "txHash" VARCHAR(66) NOT NULL,
    "blockNumber" BIGINT NOT NULL,
    "logIndex" INTEGER NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StAethelTransfer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StAethelBalance" (
    "id" TEXT NOT NULL,
    "holder" VARCHAR(50) NOT NULL,
    "balance" TEXT NOT NULL,
    "lastUpdatedAt" TIMESTAMP(3) NOT NULL,
    "lastTxHash" VARCHAR(66),
    "lastBlockNumber" BIGINT,

    CONSTRAINT "StAethelBalance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IndexerCursor" (
    "id" TEXT NOT NULL,
    "cursorKey" VARCHAR(100) NOT NULL,
    "blockNumber" BIGINT NOT NULL,
    "blockHash" VARCHAR(66) NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IndexerCursor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReorgEvent" (
    "id" TEXT NOT NULL,
    "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fromBlock" BIGINT NOT NULL,
    "toBlock" BIGINT NOT NULL,
    "expectedHash" VARCHAR(66) NOT NULL,
    "actualHash" VARCHAR(66) NOT NULL,
    "depth" INTEGER NOT NULL,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "ReorgEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Event" (
    "id" TEXT NOT NULL,
    "type" VARCHAR(100) NOT NULL,
    "blockHeight" BIGINT,
    "transactionId" TEXT,
    "attributes" JSONB NOT NULL,
    "sender" VARCHAR(50),
    "recipient" VARCHAR(50),
    "amount" TEXT,
    "timestamp" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StablecoinConfig" (
    "id" TEXT NOT NULL,
    "assetId" VARCHAR(66) NOT NULL,
    "symbol" VARCHAR(20) NOT NULL,
    "tokenAddress" VARCHAR(42) NOT NULL,
    "routingType" INTEGER NOT NULL,
    "cctpDomain" INTEGER,
    "maxBridgeAmount" TEXT NOT NULL,
    "dailyLimit" TEXT NOT NULL,
    "dailyUsed" TEXT NOT NULL DEFAULT '0',
    "lastResetTimestamp" TIMESTAMP(3),
    "circuitBreakerTripped" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "blockNumber" BIGINT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StablecoinConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StablecoinBridgeEvent" (
    "id" TEXT NOT NULL,
    "assetId" VARCHAR(66) NOT NULL,
    "eventType" VARCHAR(50) NOT NULL,
    "sender" VARCHAR(42) NOT NULL,
    "amount" TEXT NOT NULL,
    "destDomain" INTEGER,
    "txHash" VARCHAR(66) NOT NULL,
    "blockNumber" BIGINT NOT NULL,
    "logIndex" INTEGER NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "metadata" JSONB,

    CONSTRAINT "StablecoinBridgeEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReconciliationSnapshot" (
    "id" TEXT NOT NULL,
    "snapshotKey" VARCHAR(191) NOT NULL,
    "epoch" BIGINT NOT NULL,
    "network" VARCHAR(50) NOT NULL,
    "mode" VARCHAR(50) NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL,
    "epochSource" VARCHAR(120) NOT NULL,
    "chainHeight" BIGINT NOT NULL,
    "validatorLimit" INTEGER NOT NULL,
    "validatorCount" INTEGER NOT NULL,
    "totalEligibleValidators" INTEGER NOT NULL,
    "validatorUniverseHash" VARCHAR(66) NOT NULL,
    "stakeSnapshotHash" VARCHAR(66),
    "stakeSnapshotComplete" BOOLEAN,
    "warningCount" INTEGER NOT NULL DEFAULT 0,
    "discrepancyCount" INTEGER NOT NULL DEFAULT 0,
    "warnings" JSONB NOT NULL,
    "document" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReconciliationSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReconciliationDiscrepancy" (
    "id" TEXT NOT NULL,
    "snapshotId" TEXT NOT NULL,
    "code" VARCHAR(100) NOT NULL,
    "severity" "ReconciliationDiscrepancySeverity" NOT NULL,
    "status" VARCHAR(32) NOT NULL,
    "title" VARCHAR(160) NOT NULL,
    "message" TEXT NOT NULL,
    "affectedAccounts" INTEGER NOT NULL DEFAULT 0,
    "affectedShares" TEXT,
    "impactBps" INTEGER,
    "sampleAddresses" TEXT[],
    "evidence" JSONB,
    "remediation" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReconciliationDiscrepancy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AlertEvent" (
    "id" VARCHAR(80) NOT NULL,
    "severity" VARCHAR(16) NOT NULL,
    "type" VARCHAR(80) NOT NULL,
    "message" TEXT NOT NULL,
    "metadata" JSONB NOT NULL,
    "delivered" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AlertEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SyncState" (
    "id" TEXT NOT NULL,
    "chainId" TEXT NOT NULL,
    "lastBlockHeight" BIGINT NOT NULL,
    "lastBlockTime" TIMESTAMP(3) NOT NULL,
    "isSyncing" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SyncState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApiKey" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "owner" VARCHAR(50) NOT NULL,
    "permissions" TEXT[],
    "rateLimit" INTEGER NOT NULL DEFAULT 1000,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),

    CONSTRAINT "ApiKey_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AuthNonce_nonceHash_key" ON "AuthNonce"("nonceHash");

-- CreateIndex
CREATE INDEX "AuthNonce_address_idx" ON "AuthNonce"("address");

-- CreateIndex
CREATE INDEX "AuthNonce_expiresAt_idx" ON "AuthNonce"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "AuthRefreshSession_tokenHash_key" ON "AuthRefreshSession"("tokenHash");

-- CreateIndex
CREATE INDEX "AuthRefreshSession_address_idx" ON "AuthRefreshSession"("address");

-- CreateIndex
CREATE INDEX "AuthRefreshSession_expiresAt_idx" ON "AuthRefreshSession"("expiresAt");

-- CreateIndex
CREATE INDEX "AuthRefreshSession_revokedAt_idx" ON "AuthRefreshSession"("revokedAt");

-- CreateIndex
CREATE INDEX "AuthAccessRevocation_notBefore_idx" ON "AuthAccessRevocation"("notBefore");

-- CreateIndex
CREATE UNIQUE INDEX "PrivilegedAuditEvent_eventHash_key" ON "PrivilegedAuditEvent"("eventHash");

-- CreateIndex
CREATE INDEX "PrivilegedAuditEvent_requestId_idx" ON "PrivilegedAuditEvent"("requestId");

-- CreateIndex
CREATE INDEX "PrivilegedAuditEvent_actorAddress_idx" ON "PrivilegedAuditEvent"("actorAddress");

-- CreateIndex
CREATE INDEX "PrivilegedAuditEvent_decision_idx" ON "PrivilegedAuditEvent"("decision");

-- CreateIndex
CREATE INDEX "PrivilegedAuditEvent_outcome_idx" ON "PrivilegedAuditEvent"("outcome");

-- CreateIndex
CREATE INDEX "PrivilegedAuditEvent_createdAt_idx" ON "PrivilegedAuditEvent"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Block_height_key" ON "Block"("height");

-- CreateIndex
CREATE UNIQUE INDEX "Block_hash_key" ON "Block"("hash");

-- CreateIndex
CREATE INDEX "Block_height_idx" ON "Block"("height");

-- CreateIndex
CREATE INDEX "Block_timestamp_idx" ON "Block"("timestamp");

-- CreateIndex
CREATE INDEX "Block_proposer_idx" ON "Block"("proposer");

-- CreateIndex
CREATE UNIQUE INDEX "Transaction_hash_key" ON "Transaction"("hash");

-- CreateIndex
CREATE INDEX "Transaction_hash_idx" ON "Transaction"("hash");

-- CreateIndex
CREATE INDEX "Transaction_height_idx" ON "Transaction"("height");

-- CreateIndex
CREATE INDEX "Transaction_status_idx" ON "Transaction"("status");

-- CreateIndex
CREATE INDEX "Transaction_signers_idx" ON "Transaction"("signers");

-- CreateIndex
CREATE INDEX "Transaction_createdAt_idx" ON "Transaction"("createdAt");

-- CreateIndex
CREATE INDEX "Transaction_fromAddress_idx" ON "Transaction"("fromAddress");

-- CreateIndex
CREATE INDEX "Transaction_toAddress_idx" ON "Transaction"("toAddress");

-- CreateIndex
CREATE INDEX "Message_typeUrl_idx" ON "Message"("typeUrl");

-- CreateIndex
CREATE INDEX "Message_sender_idx" ON "Message"("sender");

-- CreateIndex
CREATE INDEX "Message_recipient_idx" ON "Message"("recipient");

-- CreateIndex
CREATE INDEX "Message_validator_idx" ON "Message"("validator");

-- CreateIndex
CREATE UNIQUE INDEX "Account_address_key" ON "Account"("address");

-- CreateIndex
CREATE INDEX "Account_address_idx" ON "Account"("address");

-- CreateIndex
CREATE INDEX "Account_lastSeenAt_idx" ON "Account"("lastSeenAt");

-- CreateIndex
CREATE INDEX "Balance_denom_idx" ON "Balance"("denom");

-- CreateIndex
CREATE UNIQUE INDEX "Balance_accountId_denom_key" ON "Balance"("accountId", "denom");

-- CreateIndex
CREATE UNIQUE INDEX "Validator_operatorAddress_key" ON "Validator"("operatorAddress");

-- CreateIndex
CREATE UNIQUE INDEX "Validator_consensusAddress_key" ON "Validator"("consensusAddress");

-- CreateIndex
CREATE INDEX "Validator_status_idx" ON "Validator"("status");

-- CreateIndex
CREATE INDEX "Validator_teeAttested_idx" ON "Validator"("teeAttested");

-- CreateIndex
CREATE INDEX "Validator_tokens_idx" ON "Validator"("tokens");

-- CreateIndex
CREATE UNIQUE INDEX "Delegation_delegatorId_validatorId_key" ON "Delegation"("delegatorId", "validatorId");

-- CreateIndex
CREATE INDEX "UnbondingDelegation_delegatorId_idx" ON "UnbondingDelegation"("delegatorId");

-- CreateIndex
CREATE INDEX "UnbondingDelegation_completionTime_idx" ON "UnbondingDelegation"("completionTime");

-- CreateIndex
CREATE INDEX "AIJob_status_idx" ON "AIJob"("status");

-- CreateIndex
CREATE INDEX "AIJob_modelHash_idx" ON "AIJob"("modelHash");

-- CreateIndex
CREATE INDEX "AIJob_creatorId_idx" ON "AIJob"("creatorId");

-- CreateIndex
CREATE INDEX "AIJob_validatorId_idx" ON "AIJob"("validatorId");

-- CreateIndex
CREATE INDEX "AIJob_createdAt_idx" ON "AIJob"("createdAt");

-- CreateIndex
CREATE INDEX "AIJob_priority_idx" ON "AIJob"("priority");

-- CreateIndex
CREATE UNIQUE INDEX "TEEAttestation_jobId_key" ON "TEEAttestation"("jobId");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationProof_jobId_key" ON "VerificationProof"("jobId");

-- CreateIndex
CREATE UNIQUE INDEX "ComputeMetrics_jobId_key" ON "ComputeMetrics"("jobId");

-- CreateIndex
CREATE UNIQUE INDEX "Model_modelHash_key" ON "Model"("modelHash");

-- CreateIndex
CREATE INDEX "Model_category_idx" ON "Model"("category");

-- CreateIndex
CREATE INDEX "Model_verified_idx" ON "Model"("verified");

-- CreateIndex
CREATE INDEX "Model_owner_idx" ON "Model"("owner");

-- CreateIndex
CREATE INDEX "Seal_status_idx" ON "Seal"("status");

-- CreateIndex
CREATE INDEX "Seal_jobId_idx" ON "Seal"("jobId");

-- CreateIndex
CREATE INDEX "Seal_requester_idx" ON "Seal"("requester");

-- CreateIndex
CREATE INDEX "Seal_expiresAt_idx" ON "Seal"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "Proposal_proposalId_key" ON "Proposal"("proposalId");

-- CreateIndex
CREATE INDEX "Proposal_status_idx" ON "Proposal"("status");

-- CreateIndex
CREATE INDEX "Proposal_category_idx" ON "Proposal"("category");

-- CreateIndex
CREATE INDEX "Proposal_submitTime_idx" ON "Proposal"("submitTime");

-- CreateIndex
CREATE UNIQUE INDEX "Vote_proposalId_voter_key" ON "Vote"("proposalId", "voter");

-- CreateIndex
CREATE UNIQUE INDEX "VaultStake_txHash_key" ON "VaultStake"("txHash");

-- CreateIndex
CREATE INDEX "VaultStake_delegator_idx" ON "VaultStake"("delegator");

-- CreateIndex
CREATE INDEX "VaultStake_blockNumber_idx" ON "VaultStake"("blockNumber");

-- CreateIndex
CREATE INDEX "VaultStake_timestamp_idx" ON "VaultStake"("timestamp");

-- CreateIndex
CREATE UNIQUE INDEX "VaultUnstake_withdrawalId_key" ON "VaultUnstake"("withdrawalId");

-- CreateIndex
CREATE INDEX "VaultUnstake_delegator_idx" ON "VaultUnstake"("delegator");

-- CreateIndex
CREATE INDEX "VaultUnstake_status_idx" ON "VaultUnstake"("status");

-- CreateIndex
CREATE INDEX "VaultUnstake_blockNumber_idx" ON "VaultUnstake"("blockNumber");

-- CreateIndex
CREATE INDEX "VaultUnstake_completionTime_idx" ON "VaultUnstake"("completionTime");

-- CreateIndex
CREATE INDEX "VaultUnstake_txHash_idx" ON "VaultUnstake"("txHash");

-- CreateIndex
CREATE INDEX "VaultReward_delegator_idx" ON "VaultReward"("delegator");

-- CreateIndex
CREATE INDEX "VaultReward_blockNumber_idx" ON "VaultReward"("blockNumber");

-- CreateIndex
CREATE INDEX "VaultReward_claimed_idx" ON "VaultReward"("claimed");

-- CreateIndex
CREATE UNIQUE INDEX "VaultReward_delegator_epoch_key" ON "VaultReward"("delegator", "epoch");

-- CreateIndex
CREATE UNIQUE INDEX "VaultWithdrawal_withdrawalId_key" ON "VaultWithdrawal"("withdrawalId");

-- CreateIndex
CREATE INDEX "VaultWithdrawal_delegator_idx" ON "VaultWithdrawal"("delegator");

-- CreateIndex
CREATE INDEX "VaultWithdrawal_blockNumber_idx" ON "VaultWithdrawal"("blockNumber");

-- CreateIndex
CREATE INDEX "VaultWithdrawal_txHash_idx" ON "VaultWithdrawal"("txHash");

-- CreateIndex
CREATE INDEX "StAethelTransfer_from_idx" ON "StAethelTransfer"("from");

-- CreateIndex
CREATE INDEX "StAethelTransfer_to_idx" ON "StAethelTransfer"("to");

-- CreateIndex
CREATE INDEX "StAethelTransfer_blockNumber_idx" ON "StAethelTransfer"("blockNumber");

-- CreateIndex
CREATE INDEX "StAethelTransfer_timestamp_idx" ON "StAethelTransfer"("timestamp");

-- CreateIndex
CREATE UNIQUE INDEX "StAethelTransfer_txHash_logIndex_key" ON "StAethelTransfer"("txHash", "logIndex");

-- CreateIndex
CREATE UNIQUE INDEX "StAethelBalance_holder_key" ON "StAethelBalance"("holder");

-- CreateIndex
CREATE INDEX "StAethelBalance_balance_idx" ON "StAethelBalance"("balance");

-- CreateIndex
CREATE UNIQUE INDEX "IndexerCursor_cursorKey_key" ON "IndexerCursor"("cursorKey");

-- CreateIndex
CREATE INDEX "IndexerCursor_cursorKey_idx" ON "IndexerCursor"("cursorKey");

-- CreateIndex
CREATE INDEX "ReorgEvent_detectedAt_idx" ON "ReorgEvent"("detectedAt");

-- CreateIndex
CREATE INDEX "ReorgEvent_fromBlock_idx" ON "ReorgEvent"("fromBlock");

-- CreateIndex
CREATE INDEX "Event_type_idx" ON "Event"("type");

-- CreateIndex
CREATE INDEX "Event_blockHeight_idx" ON "Event"("blockHeight");

-- CreateIndex
CREATE INDEX "Event_transactionId_idx" ON "Event"("transactionId");

-- CreateIndex
CREATE INDEX "Event_sender_idx" ON "Event"("sender");

-- CreateIndex
CREATE INDEX "Event_recipient_idx" ON "Event"("recipient");

-- CreateIndex
CREATE INDEX "Event_timestamp_idx" ON "Event"("timestamp");

-- CreateIndex
CREATE UNIQUE INDEX "StablecoinConfig_assetId_key" ON "StablecoinConfig"("assetId");

-- CreateIndex
CREATE INDEX "StablecoinConfig_assetId_idx" ON "StablecoinConfig"("assetId");

-- CreateIndex
CREATE INDEX "StablecoinConfig_active_idx" ON "StablecoinConfig"("active");

-- CreateIndex
CREATE INDEX "StablecoinBridgeEvent_assetId_idx" ON "StablecoinBridgeEvent"("assetId");

-- CreateIndex
CREATE INDEX "StablecoinBridgeEvent_eventType_idx" ON "StablecoinBridgeEvent"("eventType");

-- CreateIndex
CREATE INDEX "StablecoinBridgeEvent_sender_idx" ON "StablecoinBridgeEvent"("sender");

-- CreateIndex
CREATE INDEX "StablecoinBridgeEvent_blockNumber_idx" ON "StablecoinBridgeEvent"("blockNumber");

-- CreateIndex
CREATE INDEX "StablecoinBridgeEvent_timestamp_idx" ON "StablecoinBridgeEvent"("timestamp");

-- CreateIndex
CREATE UNIQUE INDEX "StablecoinBridgeEvent_txHash_logIndex_key" ON "StablecoinBridgeEvent"("txHash", "logIndex");

-- CreateIndex
CREATE UNIQUE INDEX "ReconciliationSnapshot_snapshotKey_key" ON "ReconciliationSnapshot"("snapshotKey");

-- CreateIndex
CREATE INDEX "ReconciliationSnapshot_epoch_idx" ON "ReconciliationSnapshot"("epoch");

-- CreateIndex
CREATE INDEX "ReconciliationSnapshot_capturedAt_idx" ON "ReconciliationSnapshot"("capturedAt");

-- CreateIndex
CREATE INDEX "ReconciliationSnapshot_validatorUniverseHash_idx" ON "ReconciliationSnapshot"("validatorUniverseHash");

-- CreateIndex
CREATE INDEX "ReconciliationDiscrepancy_snapshotId_idx" ON "ReconciliationDiscrepancy"("snapshotId");

-- CreateIndex
CREATE INDEX "ReconciliationDiscrepancy_code_idx" ON "ReconciliationDiscrepancy"("code");

-- CreateIndex
CREATE INDEX "ReconciliationDiscrepancy_severity_idx" ON "ReconciliationDiscrepancy"("severity");

-- CreateIndex
CREATE INDEX "AlertEvent_severity_idx" ON "AlertEvent"("severity");

-- CreateIndex
CREATE INDEX "AlertEvent_type_idx" ON "AlertEvent"("type");

-- CreateIndex
CREATE INDEX "AlertEvent_createdAt_idx" ON "AlertEvent"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "SyncState_chainId_key" ON "SyncState"("chainId");

-- CreateIndex
CREATE UNIQUE INDEX "ApiKey_key_key" ON "ApiKey"("key");

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_blockHeight_fkey" FOREIGN KEY ("blockHeight") REFERENCES "Block"("height") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "Transaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Balance" ADD CONSTRAINT "Balance_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Delegation" ADD CONSTRAINT "Delegation_delegatorId_fkey" FOREIGN KEY ("delegatorId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Delegation" ADD CONSTRAINT "Delegation_validatorId_fkey" FOREIGN KEY ("validatorId") REFERENCES "Validator"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UnbondingDelegation" ADD CONSTRAINT "UnbondingDelegation_delegatorId_fkey" FOREIGN KEY ("delegatorId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Commission" ADD CONSTRAINT "Commission_validatorId_fkey" FOREIGN KEY ("validatorId") REFERENCES "Validator"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AIJob" ADD CONSTRAINT "AIJob_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AIJob" ADD CONSTRAINT "AIJob_validatorId_fkey" FOREIGN KEY ("validatorId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TEEAttestation" ADD CONSTRAINT "TEEAttestation_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "AIJob"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VerificationProof" ADD CONSTRAINT "VerificationProof_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "AIJob"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ValidatorSignature" ADD CONSTRAINT "ValidatorSignature_proofId_fkey" FOREIGN KEY ("proofId") REFERENCES "VerificationProof"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComputeMetrics" ADD CONSTRAINT "ComputeMetrics_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "AIJob"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Vote" ADD CONSTRAINT "Vote_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "Proposal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProposalDeposit" ADD CONSTRAINT "ProposalDeposit_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "Proposal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Event" ADD CONSTRAINT "Event_blockHeight_fkey" FOREIGN KEY ("blockHeight") REFERENCES "Block"("height") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Event" ADD CONSTRAINT "Event_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "Transaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReconciliationDiscrepancy" ADD CONSTRAINT "ReconciliationDiscrepancy_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "ReconciliationSnapshot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

