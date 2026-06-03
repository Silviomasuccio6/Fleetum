-- Consent logs for marketing/privacy consent evidence.
CREATE TABLE "ConsentLog" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "customerId" TEXT,
    "userId" TEXT,
    "subjectType" TEXT NOT NULL DEFAULT 'rental_customer',
    "subjectId" TEXT,
    "consentType" TEXT NOT NULL,
    "granted" BOOLEAN NOT NULL,
    "channel" TEXT,
    "source" TEXT,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "documentCode" TEXT,
    "documentVersion" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConsentLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ConsentLog_tenantId_createdAt_idx" ON "ConsentLog"("tenantId", "createdAt");
CREATE INDEX "ConsentLog_tenantId_customerId_createdAt_idx" ON "ConsentLog"("tenantId", "customerId", "createdAt");
CREATE INDEX "ConsentLog_tenantId_consentType_createdAt_idx" ON "ConsentLog"("tenantId", "consentType", "createdAt");
CREATE INDEX "ConsentLog_tenantId_subjectType_subjectId_idx" ON "ConsentLog"("tenantId", "subjectType", "subjectId");

ALTER TABLE "ConsentLog" ADD CONSTRAINT "ConsentLog_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
