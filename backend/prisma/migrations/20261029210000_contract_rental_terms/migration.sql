ALTER TABLE "BookingContract"
 ADD COLUMN "rentalTerms" JSONB,
 ADD COLUMN "rentalTermsRevision" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "BookingContract" ADD CONSTRAINT "BookingContract_rentalTermsRevision_nonnegative" CHECK ("rentalTermsRevision" >= 0);
