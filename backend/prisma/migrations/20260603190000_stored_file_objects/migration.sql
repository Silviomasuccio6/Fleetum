-- CreateTable
CREATE TABLE "StoredFileObject" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "bucket" TEXT,
    "storageKey" TEXT NOT NULL,
    "originalName" TEXT,
    "mimeType" TEXT,
    "sizeBytes" INTEGER NOT NULL,
    "checksumSha256" TEXT,
    "resourceType" TEXT,
    "resourceId" TEXT,
    "visibility" TEXT NOT NULL DEFAULT 'private',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "StoredFileObject_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StoredFileObject_provider_bucket_storageKey_key" ON "StoredFileObject"("provider", "bucket", "storageKey");

-- CreateIndex
CREATE INDEX "StoredFileObject_tenantId_createdAt_idx" ON "StoredFileObject"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "StoredFileObject_tenantId_resourceType_resourceId_idx" ON "StoredFileObject"("tenantId", "resourceType", "resourceId");

-- CreateIndex
CREATE INDEX "StoredFileObject_tenantId_storageKey_idx" ON "StoredFileObject"("tenantId", "storageKey");

-- CreateIndex
CREATE INDEX "StoredFileObject_deletedAt_idx" ON "StoredFileObject"("deletedAt");

-- AddForeignKey
ALTER TABLE "StoredFileObject" ADD CONSTRAINT "StoredFileObject_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
