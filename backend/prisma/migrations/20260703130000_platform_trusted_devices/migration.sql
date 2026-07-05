-- Trusted device support for the founder-only Platform Console.
-- Tokens are never stored in clear text; only hashes are persisted.

CREATE TABLE "PlatformTrustedDevice" (
  "id" TEXT NOT NULL,
  "deviceId" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "label" TEXT,
  "userAgentHash" TEXT NOT NULL,
  "lastIpHash" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastUsedAt" TIMESTAMP(3),
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "revokedAt" TIMESTAMP(3),

  CONSTRAINT "PlatformTrustedDevice_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PlatformSecurityEvent" (
  "id" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "actor" TEXT,
  "ipHash" TEXT,
  "userAgentHash" TEXT,
  "details" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "PlatformSecurityEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PlatformTrustedDevice_deviceId_key" ON "PlatformTrustedDevice"("deviceId");
CREATE INDEX "PlatformTrustedDevice_deviceId_revokedAt_expiresAt_idx" ON "PlatformTrustedDevice"("deviceId", "revokedAt", "expiresAt");
CREATE INDEX "PlatformTrustedDevice_revokedAt_expiresAt_idx" ON "PlatformTrustedDevice"("revokedAt", "expiresAt");
CREATE INDEX "PlatformTrustedDevice_lastUsedAt_idx" ON "PlatformTrustedDevice"("lastUsedAt");

CREATE INDEX "PlatformSecurityEvent_action_createdAt_idx" ON "PlatformSecurityEvent"("action", "createdAt");
CREATE INDEX "PlatformSecurityEvent_actor_createdAt_idx" ON "PlatformSecurityEvent"("actor", "createdAt");
