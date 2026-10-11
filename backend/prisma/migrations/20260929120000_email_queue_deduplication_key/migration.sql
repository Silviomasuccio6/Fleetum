-- Optional producer-side idempotency key. PostgreSQL unique indexes allow
-- multiple NULL values, so every historical queue row remains valid.
ALTER TABLE "EmailQueue"
  ADD COLUMN "deduplicationKey" VARCHAR(255);

CREATE UNIQUE INDEX "EmailQueue_deduplicationKey_key"
  ON "EmailQueue"("deduplicationKey");
