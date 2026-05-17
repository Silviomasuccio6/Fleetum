-- Privacy notice versioning and acceptance audit.
CREATE TABLE "PrivacyNotice" (
    "id" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "summary" TEXT,
    "publishedAt" TIMESTAMP(3) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PrivacyNotice_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PrivacyAcceptance" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "noticeId" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'banner',
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "acceptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PrivacyAcceptance_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PrivacyNotice_version_key" ON "PrivacyNotice"("version");
CREATE INDEX "PrivacyNotice_isActive_publishedAt_idx" ON "PrivacyNotice"("isActive", "publishedAt");
CREATE UNIQUE INDEX "PrivacyAcceptance_tenantId_userId_version_key" ON "PrivacyAcceptance"("tenantId", "userId", "version");
CREATE INDEX "PrivacyAcceptance_tenantId_acceptedAt_idx" ON "PrivacyAcceptance"("tenantId", "acceptedAt");
CREATE INDEX "PrivacyAcceptance_tenantId_userId_acceptedAt_idx" ON "PrivacyAcceptance"("tenantId", "userId", "acceptedAt");
CREATE INDEX "PrivacyAcceptance_noticeId_acceptedAt_idx" ON "PrivacyAcceptance"("noticeId", "acceptedAt");

ALTER TABLE "PrivacyAcceptance" ADD CONSTRAINT "PrivacyAcceptance_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PrivacyAcceptance" ADD CONSTRAINT "PrivacyAcceptance_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PrivacyAcceptance" ADD CONSTRAINT "PrivacyAcceptance_noticeId_fkey" FOREIGN KEY ("noticeId") REFERENCES "PrivacyNotice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

