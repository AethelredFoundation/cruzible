BEGIN;

-- Give EVM event rows an explicit, replay-safe source identity.  Nullable
-- columns preserve compatibility with non-EVM event producers.
ALTER TABLE "Event"
ADD COLUMN "transactionHash" VARCHAR(66),
ADD COLUMN "logIndex" INTEGER;

-- Backfill the source identity that older indexer versions stored only inside
-- the JSON attributes document.
UPDATE "Event"
SET
    "transactionHash" = "attributes"->>'transactionHash',
    "logIndex" = CASE
        WHEN ("attributes"->>'logIndex') ~ '^[0-9]+$'
        THEN ("attributes"->>'logIndex')::INTEGER
        ELSE NULL
    END
WHERE
    "attributes" ? 'transactionHash'
    AND "attributes" ? 'logIndex';

-- A prior retry could have produced duplicate generic rows. Keep the oldest
-- row before enforcing the canonical (transactionHash, logIndex) identity.
WITH ranked_events AS (
    SELECT
        "id",
        ROW_NUMBER() OVER (
            PARTITION BY "transactionHash", "logIndex"
            ORDER BY "timestamp" ASC, "id" ASC
        ) AS duplicate_rank
    FROM "Event"
    WHERE "transactionHash" IS NOT NULL AND "logIndex" IS NOT NULL
)
DELETE FROM "Event"
USING ranked_events
WHERE
    "Event"."id" = ranked_events."id"
    AND ranked_events.duplicate_rank > 1;

CREATE UNIQUE INDEX "Event_transactionHash_logIndex_key"
ON "Event"("transactionHash", "logIndex");

COMMIT;
