-- Add odometer fields for rental handover and return.
ALTER TABLE "RentalBooking"
  ADD COLUMN "pickupKm" INTEGER,
  ADD COLUMN "returnKm" INTEGER;
