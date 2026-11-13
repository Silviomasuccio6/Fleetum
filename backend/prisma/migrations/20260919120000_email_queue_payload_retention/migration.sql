ALTER TABLE "EmailQueue"
ADD COLUMN "payloadPurgedAt" TIMESTAMP(3);

CREATE INDEX "EmailQueue_payloadPurgedAt_status_updatedAt_idx"
ON "EmailQueue"("payloadPurgedAt", "status", "updatedAt");
