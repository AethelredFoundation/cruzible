BEGIN;

-- Rows written by the pre-upgrade indexer cannot all be reconstructed from
-- the upgraded event ABI. Keep them, but make their provenance explicit. In
-- particular, the legacy Unstaked event did not emit completionTime, so an
-- existing deadline must not be presented as replay-verified after upgrade.
CREATE TYPE "VaultProjectionProvenance" AS ENUM (
    'LEGACY_UNVERIFIED',
    'CANONICAL_EVENT'
);

ALTER TABLE "VaultUnstake"
ADD COLUMN "sourceProvenance" "VaultProjectionProvenance" NOT NULL
DEFAULT 'LEGACY_UNVERIFIED';

ALTER TABLE "VaultWithdrawal"
ADD COLUMN "sourceProvenance" "VaultProjectionProvenance" NOT NULL
DEFAULT 'LEGACY_UNVERIFIED';

ALTER TABLE "VaultReward"
ADD COLUMN "sourceProvenance" "VaultProjectionProvenance" NOT NULL
DEFAULT 'LEGACY_UNVERIFIED';

ALTER TABLE "VaultUnstake"
ALTER COLUMN "completionTime" DROP NOT NULL;

-- Fail closed for the exact legacy deadline. The row remains available for
-- audit/status purposes, while consumers see that no exact replay-verified
-- completion time exists.
UPDATE "VaultUnstake"
SET "completionTime" = NULL
WHERE "sourceProvenance" = 'LEGACY_UNVERIFIED';

-- Older indexer versions keyed VaultStake only by transaction hash. A single
-- transaction can emit multiple Staked logs, so choosing MIN(logIndex) would
-- silently discard the other deposits. Instead, atomically rewind the durable
-- cursor to the earliest retained stake source and let the upgraded indexer
-- replay the bounded canonical range with (txHash, logIndex) identity.
DO $$
DECLARE
    replay_from BIGINT;
    recovery_target BIGINT;
BEGIN
    IF EXISTS (
        SELECT 1
        FROM "VaultStake" AS stake
        WHERE stake."blockNumber" IS NULL
          AND NOT EXISTS (
              SELECT 1
              FROM "Event" AS event
              WHERE event."type" = 'Staked'
                AND event."transactionHash" = stake."txHash"
                AND event."blockHeight" IS NOT NULL
          )
    ) THEN
        RAISE EXCEPTION
            'Cannot replay legacy VaultStake row without a source block';
    END IF;

    SELECT MIN(source."blockNumber")
    INTO replay_from
    FROM (
        SELECT event."blockHeight" AS "blockNumber"
        FROM "Event" AS event
        WHERE event."type" = 'Staked'
          AND event."blockHeight" IS NOT NULL

        UNION ALL

        SELECT stake."blockNumber"
        FROM "VaultStake" AS stake
        WHERE stake."blockNumber" IS NOT NULL
    ) AS source;

    IF replay_from IS NOT NULL THEN
        SELECT cursor."blockNumber"
        INTO recovery_target
        FROM "IndexerCursor" AS cursor
        WHERE cursor."cursorKey" = 'evm-indexer'
        FOR UPDATE;

        IF NOT FOUND THEN
            RAISE EXCEPTION
                'Cannot replay VaultStake identity without evm-indexer cursor';
        END IF;

        IF recovery_target < replay_from THEN
            RAISE EXCEPTION
                'VaultStake source block % is ahead of indexer cursor %',
                replay_from,
                recovery_target;
        END IF;

        UPDATE "IndexerCursor"
        SET
            "blockNumber" = replay_from - 1,
            "blockHash" = '0x0',
            "timestamp" = NOW(),
            "requiresRebuild" = true,
            "recoveryTargetBlock" = recovery_target,
            "pendingBlockNumber" = NULL,
            "updatedAt" = NOW()
        WHERE "cursorKey" = 'evm-indexer';

        -- Clear only projections that the upgraded ABI can deterministically
        -- reconstruct. Legacy unstake/withdrawal/reward rows are deliberately
        -- retained with LEGACY_UNVERIFIED provenance above.
        DELETE FROM "StAethelTransfer"
        WHERE "blockNumber" >= replay_from;

        DELETE FROM "StAethelBalance";

        DELETE FROM "StablecoinBridgeEvent"
        WHERE "blockNumber" >= replay_from;

        DELETE FROM "StablecoinConfig"
        WHERE "blockNumber" >= replay_from;

        DELETE FROM "VaultState";

        DELETE FROM "VaultStake";

        DELETE FROM "Event"
        WHERE "blockHeight" >= replay_from;

        DELETE FROM "Message"
        WHERE "transactionId" IN (
            SELECT indexed_tx."id"
            FROM "Transaction" AS indexed_tx
            WHERE indexed_tx."blockHeight" >= replay_from
        );

        DELETE FROM "Transaction"
        WHERE "blockHeight" >= replay_from;

        DELETE FROM "Block"
        WHERE "height" >= replay_from;

        UPDATE "SyncState"
        SET
            "lastBlockHeight" = replay_from - 1,
            "lastBlockTime" = NOW(),
            "isSyncing" = true,
            "updatedAt" = NOW()
        WHERE "chainId" = 'aethelred-evm';
    END IF;
END $$;

ALTER TABLE "VaultStake"
ALTER COLUMN "logIndex" SET NOT NULL;

DROP INDEX IF EXISTS "VaultStake_txHash_key";

CREATE UNIQUE INDEX "VaultStake_txHash_logIndex_key"
ON "VaultStake"("txHash", "logIndex");

COMMIT;
