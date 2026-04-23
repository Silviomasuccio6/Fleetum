-- Add delivery channel/details for booking contract deliveries
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'BookingContractDeliveryChannel') THEN
    CREATE TYPE "BookingContractDeliveryChannel" AS ENUM ('EMAIL', 'WHATSAPP');
  END IF;
END $$;

ALTER TABLE "BookingContractDelivery"
  ADD COLUMN IF NOT EXISTS "channel" "BookingContractDeliveryChannel" NOT NULL DEFAULT 'EMAIL',
  ADD COLUMN IF NOT EXISTS "details" JSONB;

CREATE INDEX IF NOT EXISTS "BookingContract_tenantId_lastSentAt_idx"
  ON "BookingContract"("tenantId", "lastSentAt");

CREATE INDEX IF NOT EXISTS "BookingContractDelivery_tenantId_channel_status_createdAt_idx"
  ON "BookingContractDelivery"("tenantId", "channel", "status", "createdAt");
