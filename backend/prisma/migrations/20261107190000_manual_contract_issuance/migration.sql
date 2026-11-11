-- Additive only: historical records and PDFs are deliberately not backfilled.
ALTER TABLE "RentalBooking" ADD COLUMN "priceAgreement" JSONB;
ALTER TABLE "BookingContract" ADD COLUMN "documentRevision" INTEGER NOT NULL DEFAULT 0, ADD COLUMN "issuedAt" TIMESTAMP(3), ADD COLUMN "issuedByUserId" TEXT, ADD COLUMN "issuanceHash" TEXT;
ALTER TABLE "ContractSigningRequest" ADD COLUMN "contractRevision" INTEGER NOT NULL DEFAULT 0, ADD COLUMN "method" TEXT NOT NULL DEFAULT 'EMAIL_OTP', ADD COLUMN "signedDocumentSha256" TEXT, ADD COLUMN "signedStoredFileObjectId" TEXT;
ALTER TABLE "ContractSigningRequest" ADD CONSTRAINT "ContractSigningRequest_signedStoredFileObjectId_tenantId_fkey" FOREIGN KEY ("signedStoredFileObjectId","tenantId") REFERENCES "StoredFileObject"("id","tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ContractSigningRequest" ADD CONSTRAINT "ContractSigningRequest_method_check" CHECK ("method" IN ('EMAIL_OTP','IN_PERSON'));
ALTER TABLE "ContractSigningRequest" ADD CONSTRAINT "ContractSigningRequest_signed_artifact_check" CHECK (("signedDocumentSha256" IS NULL) = ("signedStoredFileObjectId" IS NULL));
-- Keep all existing email-OTP evidence requirements and add separate in-person proof.
ALTER TABLE "ContractSigningRequest" DROP CONSTRAINT "ContractSigningRequest_signed_evidence";
ALTER TABLE "ContractSigningRequest" ADD CONSTRAINT "ContractSigningRequest_signed_evidence" CHECK (
 "status" <> 'SIGNED' OR ("signedAt" IS NOT NULL AND "evidence" IS NOT NULL AND "evidenceMac" IS NOT NULL AND "consentVersion" IS NOT NULL AND "confirmationId" IS NOT NULL AND "signedBrowserHash" IS NOT NULL AND "otpHash" IS NULL AND "browserHash" IS NULL AND
 (("method"='EMAIL_OTP' AND "consumedOtpHash" IS NOT NULL) OR
  ("method"='IN_PERSON' AND "consumedOtpHash" IS NULL AND "documentRequestedAt" IS NOT NULL AND "signedStoredFileObjectId" IS NOT NULL AND "consentVersion"='in-person-v1' AND "evidence"->>'method'='IN_PERSON' AND "evidence"->>'signatureSha256' ~ '^[a-f0-9]{64}$')))
);
CREATE FUNCTION fleetum_signing_method_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW."method" IS DISTINCT FROM OLD."method" OR NEW."contractRevision" IS DISTINCT FROM OLD."contractRevision" THEN RAISE EXCEPTION 'Immutable signing method' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "ContractSigningRequest_method_immutable" BEFORE UPDATE ON "ContractSigningRequest" FOR EACH ROW EXECUTE FUNCTION fleetum_signing_method_immutable();
