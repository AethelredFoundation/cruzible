CREATE TYPE "ReconciliationDiscrepancySeverity" AS ENUM ('INFO', 'WARNING', 'CRITICAL');

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

CREATE UNIQUE INDEX "ReconciliationSnapshot_snapshotKey_key"
  ON "ReconciliationSnapshot"("snapshotKey");

CREATE INDEX "ReconciliationSnapshot_epoch_idx"
  ON "ReconciliationSnapshot"("epoch");

CREATE INDEX "ReconciliationSnapshot_capturedAt_idx"
  ON "ReconciliationSnapshot"("capturedAt");

CREATE INDEX "ReconciliationSnapshot_validatorUniverseHash_idx"
  ON "ReconciliationSnapshot"("validatorUniverseHash");

CREATE INDEX "ReconciliationDiscrepancy_snapshotId_idx"
  ON "ReconciliationDiscrepancy"("snapshotId");

CREATE INDEX "ReconciliationDiscrepancy_code_idx"
  ON "ReconciliationDiscrepancy"("code");

CREATE INDEX "ReconciliationDiscrepancy_severity_idx"
  ON "ReconciliationDiscrepancy"("severity");

ALTER TABLE "ReconciliationDiscrepancy"
  ADD CONSTRAINT "ReconciliationDiscrepancy_snapshotId_fkey"
  FOREIGN KEY ("snapshotId") REFERENCES "ReconciliationSnapshot"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
