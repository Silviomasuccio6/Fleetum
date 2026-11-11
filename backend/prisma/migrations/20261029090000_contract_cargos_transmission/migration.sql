CREATE UNIQUE INDEX "BookingContract_id_tenantId_key" ON "BookingContract"("id", "tenantId");
CREATE TABLE "TenantCargosConnection" (
 "tenantId" TEXT PRIMARY KEY REFERENCES "Tenant"("id") ON DELETE CASCADE,
 "credentialsEncrypted" TEXT NOT NULL,
 "agencies" JSONB NOT NULL DEFAULT '{}',
 "enabled" BOOLEAN NOT NULL DEFAULT FALSE,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE TABLE "ContractCargosTransmission" (
 "id" TEXT PRIMARY KEY,
 "tenantId" TEXT NOT NULL REFERENCES "Tenant"("id") ON DELETE CASCADE,
 "contractId" TEXT NOT NULL UNIQUE,
 "status" TEXT NOT NULL DEFAULT 'DRAFT' CHECK ("status" IN ('DRAFT','SENDING','ACCEPTED','REJECTED','UNKNOWN','UNAVAILABLE')),
 "recordDraft" JSONB NOT NULL DEFAULT '{}',
 "sourceHash" TEXT,
 "recordHash" TEXT,
 "recordEncrypted" TEXT,
 "requestedByUserId" TEXT,
 "claimToken" TEXT,
 "transactionId" TEXT,
 "errorCode" TEXT,
 "startedAt" TIMESTAMP(3),
 "acceptedAt" TIMESTAMP(3),
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updatedAt" TIMESTAMP(3) NOT NULL,
 CONSTRAINT "ContractCargosTransmission_contractId_tenantId_fkey" FOREIGN KEY ("contractId","tenantId") REFERENCES "BookingContract"("id","tenantId") ON DELETE RESTRICT,
 CONSTRAINT "ContractCargosTransmission_accepted_evidence" CHECK ("status" <> 'ACCEPTED' OR ("transactionId" IS NOT NULL AND "acceptedAt" IS NOT NULL AND "recordHash" IS NOT NULL AND "recordEncrypted" IS NOT NULL AND "requestedByUserId" IS NOT NULL))
);
CREATE INDEX "ContractCargosTransmission_tenantId_status_idx" ON "ContractCargosTransmission"("tenantId","status");
CREATE UNIQUE INDEX "ContractCargosTransmission_contractId_tenantId_key" ON "ContractCargosTransmission"("contractId","tenantId");
