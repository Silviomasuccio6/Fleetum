-- Persist Platform Console password resets without writing secrets to the VPS environment file.
CREATE TABLE "PlatformAdminCredential" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "passwordChangedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastResetAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlatformAdminCredential_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PlatformAdminCredential_email_key" ON "PlatformAdminCredential"("email");
