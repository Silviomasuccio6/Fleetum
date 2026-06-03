-- CreateTable
CREATE TABLE "PlatformOtpChallenge" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlatformOtpChallenge_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PlatformOtpChallenge_key_key" ON "PlatformOtpChallenge"("key");

-- CreateIndex
CREATE INDEX "PlatformOtpChallenge_key_expiresAt_idx" ON "PlatformOtpChallenge"("key", "expiresAt");
