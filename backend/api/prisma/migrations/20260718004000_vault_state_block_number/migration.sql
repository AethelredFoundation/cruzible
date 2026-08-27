BEGIN;

-- Record the exact canonical block used for each VaultState projection so
-- reconciliation can compare indexed and independent RPC truth at one block.
ALTER TABLE "VaultState"
ADD COLUMN "blockNumber" BIGINT;

COMMIT;
