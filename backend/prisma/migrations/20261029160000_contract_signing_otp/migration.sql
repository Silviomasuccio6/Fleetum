CREATE UNIQUE INDEX "StoredFileObject_id_tenantId_key" ON "StoredFileObject"("id","tenantId");
CREATE TABLE "ContractSigningRequest" (
 "id" TEXT PRIMARY KEY, "tenantId" TEXT NOT NULL REFERENCES "Tenant"("id") ON DELETE RESTRICT,
 "contractId" TEXT NOT NULL, "version" INTEGER NOT NULL CHECK("version">0),
 "idempotencyKey" TEXT NOT NULL, "requestHash" TEXT NOT NULL, "tokenHash" TEXT NOT NULL UNIQUE,
 "status" TEXT NOT NULL DEFAULT 'PENDING' CHECK("status" IN ('PENDING','SIGNED','REVOKED','EXPIRED')),
 "documentTitle" TEXT NOT NULL, "bookingCode" TEXT NOT NULL, "documentSha256" TEXT NOT NULL, "sourceHash" TEXT NOT NULL,
 "storedFileObjectId" TEXT NOT NULL, "recipient" TEXT NOT NULL, "signerName" TEXT NOT NULL, "issuerName" TEXT NOT NULL,
 "actorUserId" TEXT NOT NULL, "siteAuthorization" JSONB NOT NULL, "expiresAt" TIMESTAMP(3) NOT NULL,
 "inviteQueueId" TEXT, "otpQueueId" TEXT, "copyQueueId" TEXT,
 "otpGeneration" INTEGER NOT NULL DEFAULT 0, "otpSendCount" INTEGER NOT NULL DEFAULT 0 CHECK("otpSendCount" BETWEEN 0 AND 5),
 "otpAttempts" INTEGER NOT NULL DEFAULT 0 CHECK("otpAttempts" BETWEEN 0 AND 5), "totalAttempts" INTEGER NOT NULL DEFAULT 0 CHECK("totalAttempts" BETWEEN 0 AND 10),
 "otpHash" TEXT, "browserHash" TEXT, "otpExpiresAt" TIMESTAMP(3), "lastOtpAt" TIMESTAMP(3), "documentRequestedAt" TIMESTAMP(3),
 "signedAt" TIMESTAMP(3), "confirmationId" TEXT, "consumedOtpHash" TEXT, "signedBrowserHash" TEXT,
 "consentVersion" TEXT, "evidence" JSONB, "evidenceMac" TEXT,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
 FOREIGN KEY("contractId","tenantId") REFERENCES "BookingContract"("id","tenantId") ON DELETE RESTRICT,
 FOREIGN KEY("storedFileObjectId","tenantId") REFERENCES "StoredFileObject"("id","tenantId") ON DELETE RESTRICT,
 CONSTRAINT "ContractSigningRequest_signed_evidence" CHECK("status"<>'SIGNED' OR ("signedAt" IS NOT NULL AND "evidence" IS NOT NULL AND "evidenceMac" IS NOT NULL AND "consentVersion" IS NOT NULL AND "confirmationId" IS NOT NULL AND "signedBrowserHash" IS NOT NULL AND "consumedOtpHash" IS NOT NULL AND "otpHash" IS NULL AND "browserHash" IS NULL))
);
CREATE UNIQUE INDEX "ContractSigningRequest_tenantId_idempotencyKey_key" ON "ContractSigningRequest"("tenantId","idempotencyKey");
CREATE UNIQUE INDEX "ContractSigningRequest_contractId_version_key" ON "ContractSigningRequest"("contractId","version");
CREATE UNIQUE INDEX "ContractSigningRequest_one_pending" ON "ContractSigningRequest"("contractId") WHERE "status"='PENDING';
CREATE INDEX "ContractSigningRequest_tenantId_contractId_status_idx" ON "ContractSigningRequest"("tenantId","contractId","status");
CREATE FUNCTION fleetum_signing_immutable_document() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF ROW(NEW."tenantId",NEW."contractId",NEW."version",NEW."idempotencyKey",NEW."requestHash",NEW."tokenHash",NEW."documentTitle",NEW."bookingCode",NEW."documentSha256",NEW."sourceHash",NEW."storedFileObjectId",NEW."recipient",NEW."signerName",NEW."issuerName",NEW."actorUserId",NEW."siteAuthorization",NEW."expiresAt",NEW."createdAt") IS DISTINCT FROM ROW(OLD."tenantId",OLD."contractId",OLD."version",OLD."idempotencyKey",OLD."requestHash",OLD."tokenHash",OLD."documentTitle",OLD."bookingCode",OLD."documentSha256",OLD."sourceHash",OLD."storedFileObjectId",OLD."recipient",OLD."signerName",OLD."issuerName",OLD."actorUserId",OLD."siteAuthorization",OLD."expiresAt",OLD."createdAt") THEN
  RAISE EXCEPTION 'Immutable signing document' USING ERRCODE='23514';
 END IF;
 IF OLD."status" IN ('SIGNED','REVOKED','EXPIRED') AND NEW IS DISTINCT FROM OLD THEN
  RAISE EXCEPTION 'Terminal signing request' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "ContractSigningRequest_immutable" BEFORE UPDATE ON "ContractSigningRequest" FOR EACH ROW EXECUTE FUNCTION fleetum_signing_immutable_document();
