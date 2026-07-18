BEGIN;

-- stAETHEL is rebasing: ERC-20 Transfer values are AETHEL-denominated and
-- change meaning as rewards accrue. TransferShares is the invariant ledger.
-- Older indexers persisted every raw log as a generic Event, so identify the
-- historical share events before rebuilding projections in application code.
UPDATE "Event"
SET "type" = 'TransferShares'
WHERE LOWER("attributes"->'topics'->>0) =
      '0x9d9c909296d9c674451c0c24f02cb64981eb3b727f99865939192f880a755dcb';

-- Refuse a destructive projection reset unless the durable recovery cursor is
-- present. Operators must initialize the indexer once before this migration.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM "IndexerCursor"
        WHERE "cursorKey" = 'evm-indexer'
    ) AND (
        EXISTS (SELECT 1 FROM "StAethelTransfer")
        OR EXISTS (SELECT 1 FROM "StAethelBalance")
    ) THEN
        RAISE EXCEPTION 'Cannot migrate stAETHEL share ledger without evm-indexer cursor';
    END IF;
END
$$;

UPDATE "IndexerCursor"
SET "requiresRebuild" = true
WHERE "cursorKey" = 'evm-indexer';

-- Existing rows contain rebasing AETHEL values and must never be interpreted
-- as shares. The marker update and destructive reset commit atomically. The
-- new worker reconstructs both tables from retained raw TransferShares events.
DELETE FROM "StAethelTransfer";
DELETE FROM "StAethelBalance";

COMMIT;
