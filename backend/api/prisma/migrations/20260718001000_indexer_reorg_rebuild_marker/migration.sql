BEGIN;

-- Persist incomplete materialized-state recovery across indexer retries and
-- process restarts. The flag is set atomically with reorg deletion/cursor
-- rollback and cleared only after every derived projection has been rebuilt
-- and the canonical replacement range has reached recoveryTargetBlock.
ALTER TABLE "IndexerCursor"
ADD COLUMN "requiresRebuild" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "recoveryTargetBlock" BIGINT,
ADD COLUMN "pendingBlockNumber" BIGINT,
ADD COLUMN "networkChainId" VARCHAR(78),
ADD COLUMN "networkAnchorHash" VARCHAR(66),
ADD COLUMN "networkVaultAddress" VARCHAR(42),
ADD COLUMN "networkStaethelAddress" VARCHAR(42),
ADD COLUMN "networkStablecoinBridgeAddress" VARCHAR(42);

COMMIT;
