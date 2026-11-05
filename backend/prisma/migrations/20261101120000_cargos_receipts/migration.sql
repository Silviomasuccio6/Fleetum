ALTER TABLE "ContractCargosTransmission"
 ADD COLUMN "checkStatus" TEXT,
 ADD COLUMN "checkedAt" TIMESTAMP(3),
 ADD COLUMN "checkSourceHash" TEXT,
 ADD COLUMN "checkErrorCode" TEXT,
 ADD COLUMN "manualConfirmedAt" TIMESTAMP(3);
ALTER TABLE "ContractCargosTransmission" DROP CONSTRAINT "ContractCargosTransmission_status_check";
ALTER TABLE "ContractCargosTransmission" ADD CONSTRAINT "ContractCargosTransmission_status_check" CHECK ("status" IN ('DRAFT','SENDING','ACCEPTED','REJECTED','UNKNOWN','UNAVAILABLE','MANUAL_CONFIRMED'));
ALTER TABLE "ContractCargosTransmission" ADD CONSTRAINT "ContractCargosTransmission_manual_evidence" CHECK ("status" <> 'MANUAL_CONFIRMED' OR ("transactionId" IS NOT NULL AND "manualConfirmedAt" IS NOT NULL AND "sourceHash" IS NOT NULL AND "recordHash" IS NOT NULL AND "recordEncrypted" IS NOT NULL));
CREATE UNIQUE INDEX "ContractCargosTransmission_id_tenantId_key" ON "ContractCargosTransmission"("id","tenantId");
CREATE TABLE "ContractCargosReceipt" (
 "id" TEXT PRIMARY KEY,"tenantId" TEXT NOT NULL REFERENCES "Tenant"("id") ON DELETE CASCADE,
 "transmissionId" TEXT NOT NULL,"storedFileObjectId" TEXT NOT NULL UNIQUE,
 "idempotencyKey" TEXT NOT NULL,"requestHash" TEXT NOT NULL,"sha256" TEXT NOT NULL,
 "protocol" TEXT NOT NULL,"receiptDate" DATE NOT NULL,"transactionId" TEXT NOT NULL,
 "sourceHash" TEXT NOT NULL,"recordHash" TEXT NOT NULL,
 "kind" TEXT NOT NULL CHECK ("kind" IN ('API_ACCEPTED_RECEIPT','PORTAL_CONFIRMED')),
 "actorUserId" TEXT NOT NULL,"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY ("transmissionId","tenantId") REFERENCES "ContractCargosTransmission"("id","tenantId") ON DELETE RESTRICT,
 FOREIGN KEY ("storedFileObjectId","tenantId") REFERENCES "StoredFileObject"("id","tenantId") ON DELETE RESTRICT,
 UNIQUE ("tenantId","idempotencyKey")
);
CREATE INDEX "ContractCargosReceipt_tenantId_transmissionId_createdAt_idx" ON "ContractCargosReceipt"("tenantId","transmissionId","createdAt");
CREATE FUNCTION prevent_cargos_receipt_update() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'CARGOS receipt evidence cannot be updated'; END; $$ LANGUAGE plpgsql;
CREATE TRIGGER cargos_receipt_immutable BEFORE UPDATE ON "ContractCargosReceipt" FOR EACH ROW EXECUTE FUNCTION prevent_cargos_receipt_update();

CREATE UNIQUE INDEX "ContractCargosTransmission_tenantId_transactionId_key" ON "ContractCargosTransmission"("tenantId","transactionId");
