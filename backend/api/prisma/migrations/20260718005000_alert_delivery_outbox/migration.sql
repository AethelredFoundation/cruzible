BEGIN;

ALTER TABLE "AlertEvent"
ADD COLUMN "attemptCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "lastAttemptAt" TIMESTAMP(3),
ADD COLUMN "nextAttemptAt" TIMESTAMP(3),
ADD COLUMN "deadLetteredAt" TIMESTAMP(3),
ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE INDEX "AlertEvent_delivered_deadLetteredAt_nextAttemptAt_idx"
ON "AlertEvent"("delivered", "deadLetteredAt", "nextAttemptAt");

COMMIT;
