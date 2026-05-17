-- Tenant company profile, branding and legal settings for SaaS onboarding.
CREATE TABLE "TenantProfile" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "legalName" TEXT NOT NULL,
  "tradeName" TEXT,
  "legalForm" TEXT,
  "vatNumber" TEXT,
  "taxCode" TEXT,
  "pec" TEXT,
  "sdiCode" TEXT,
  "rea" TEXT,
  "legalAddress" TEXT,
  "city" TEXT,
  "province" TEXT,
  "postalCode" TEXT,
  "country" TEXT NOT NULL DEFAULT 'IT',
  "phone" TEXT,
  "email" TEXT,
  "website" TEXT,
  "adminFirstName" TEXT,
  "adminLastName" TEXT,
  "adminEmail" TEXT,
  "adminPhone" TEXT,
  "adminRole" TEXT,
  "profileCompletedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deletedAt" TIMESTAMP(3),
  CONSTRAINT "TenantProfile_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TenantBranding" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "logoFilePath" TEXT,
  "logoFileName" TEXT,
  "logoMimeType" TEXT,
  "primaryColor" TEXT,
  "accentColor" TEXT,
  "fontFamily" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TenantBranding_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TenantLegalSettings" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "contractFooterText" TEXT,
  "defaultContractTerms" TEXT,
  "privacyNoticeVersion" TEXT,
  "termsVersion" TEXT,
  "dpaVersion" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TenantLegalSettings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TenantProfile_tenantId_key" ON "TenantProfile"("tenantId");
CREATE INDEX "TenantProfile_vatNumber_idx" ON "TenantProfile"("vatNumber");
CREATE INDEX "TenantProfile_taxCode_idx" ON "TenantProfile"("taxCode");
CREATE INDEX "TenantProfile_email_idx" ON "TenantProfile"("email");
CREATE INDEX "TenantProfile_tenantId_deletedAt_idx" ON "TenantProfile"("tenantId", "deletedAt");

CREATE UNIQUE INDEX "TenantBranding_tenantId_key" ON "TenantBranding"("tenantId");
CREATE UNIQUE INDEX "TenantLegalSettings_tenantId_key" ON "TenantLegalSettings"("tenantId");

ALTER TABLE "TenantProfile" ADD CONSTRAINT "TenantProfile_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TenantBranding" ADD CONSTRAINT "TenantBranding_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TenantLegalSettings" ADD CONSTRAINT "TenantLegalSettings_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Backfill existing tenants with a minimum incomplete profile and default settings.
INSERT INTO "TenantProfile" (
  "id", "tenantId", "legalName", "tradeName", "vatNumber", "country", "adminFirstName", "adminLastName", "adminEmail", "createdAt", "updatedAt"
)
SELECT
  'tenant_profile_' || t."id",
  t."id",
  t."name",
  t."name",
  t."vatNumber",
  'IT',
  u."firstName",
  u."lastName",
  u."email",
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "Tenant" t
LEFT JOIN LATERAL (
  SELECT u."firstName", u."lastName", u."email"
  FROM "User" u
  WHERE u."tenantId" = t."id" AND u."deletedAt" IS NULL
  ORDER BY u."createdAt" ASC
  LIMIT 1
) u ON true
ON CONFLICT ("tenantId") DO NOTHING;

INSERT INTO "TenantBranding" ("id", "tenantId", "primaryColor", "accentColor", "fontFamily", "createdAt", "updatedAt")
SELECT 'tenant_branding_' || "id", "id", '#21375d', '#5d82c2', 'helvetica', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "Tenant"
ON CONFLICT ("tenantId") DO NOTHING;

INSERT INTO "TenantLegalSettings" ("id", "tenantId", "contractFooterText", "privacyNoticeVersion", "createdAt", "updatedAt")
SELECT 'tenant_legal_' || "id", "id", 'Contratto generato dal gestionale aziendale. Verificare i dati prima della sottoscrizione.', '2026-05-05', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "Tenant"
ON CONFLICT ("tenantId") DO NOTHING;
