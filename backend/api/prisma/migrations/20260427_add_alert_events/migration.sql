-- Durable alert history for multi-instance operations and post-incident review.

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

CREATE INDEX "AlertEvent_severity_idx" ON "AlertEvent"("severity");
CREATE INDEX "AlertEvent_type_idx" ON "AlertEvent"("type");
CREATE INDEX "AlertEvent_createdAt_idx" ON "AlertEvent"("createdAt");
