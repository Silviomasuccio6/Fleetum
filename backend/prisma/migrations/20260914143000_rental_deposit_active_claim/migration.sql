-- Refuse to install the concurrency barrier over ambiguous existing data.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "RentalDeposit"
    WHERE "deletedAt" IS NULL
      AND "status" IN ('AUTHORIZING', 'AUTHORIZED')
    GROUP BY "tenantId", "bookingId"
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Cannot enforce one active rental deposit: duplicate active deposits exist';
  END IF;
END $$;

-- The claim is acquired by inserting AUTHORIZING before contacting Stripe.
-- Terminal states leave the key space available for a later authorization.
CREATE UNIQUE INDEX "RentalDeposit_one_active_per_booking_uidx"
  ON "RentalDeposit"("tenantId", "bookingId")
  WHERE "deletedAt" IS NULL
    AND "status" IN ('AUTHORIZING', 'AUTHORIZED');
