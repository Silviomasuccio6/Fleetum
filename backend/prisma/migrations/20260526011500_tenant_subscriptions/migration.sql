-- Persist SaaS subscription/license state outside audit logs.
CREATE TABLE "TenantSubscription" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "provider" TEXT NOT NULL DEFAULT 'local',
  "plan" TEXT NOT NULL DEFAULT 'STARTER',
  "billingCycle" TEXT NOT NULL DEFAULT 'monthly',
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "seats" INTEGER NOT NULL DEFAULT 3,
  "priceMonthly" DOUBLE PRECISION,
  "stripeCustomerId" TEXT,
  "stripeSubscriptionId" TEXT,
  "currentPeriodEnd" TIMESTAMP(3),
  "trialEndsAt" TIMESTAMP(3),
  "canceledAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "TenantSubscription_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TenantSubscription_tenantId_key" ON "TenantSubscription"("tenantId");
CREATE INDEX "TenantSubscription_plan_status_idx" ON "TenantSubscription"("plan", "status");
CREATE INDEX "TenantSubscription_status_currentPeriodEnd_idx" ON "TenantSubscription"("status", "currentPeriodEnd");
CREATE INDEX "TenantSubscription_stripeCustomerId_idx" ON "TenantSubscription"("stripeCustomerId");
CREATE INDEX "TenantSubscription_stripeSubscriptionId_idx" ON "TenantSubscription"("stripeSubscriptionId");

ALTER TABLE "TenantSubscription"
  ADD CONSTRAINT "TenantSubscription_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill existing tenants from the latest historical license audit when available.
WITH latest_license_audit AS (
  SELECT DISTINCT ON ("resourceId")
    "resourceId" AS "tenantId",
    "details"
  FROM "AuditLog"
  WHERE "resource" = 'tenant'
    AND "action" = 'PLATFORM_LICENSE_UPDATED'
    AND "resourceId" IS NOT NULL
  ORDER BY "resourceId", "createdAt" DESC
),
parsed_license AS (
  SELECT
    latest_license_audit."tenantId",
    COALESCE(
      latest_license_audit."details"::jsonb #> '{after,subscription}',
      latest_license_audit."details"::jsonb -> 'subscription',
      latest_license_audit."details"::jsonb -> 'after',
      latest_license_audit."details"::jsonb
    ) AS "license"
  FROM latest_license_audit
)
INSERT INTO "TenantSubscription" (
  "id",
  "tenantId",
  "provider",
  "plan",
  "billingCycle",
  "status",
  "seats",
  "priceMonthly",
  "currentPeriodEnd",
  "trialEndsAt",
  "createdAt",
  "updatedAt"
)
SELECT
  CONCAT('ts_', MD5(parsed_license."tenantId")),
  parsed_license."tenantId",
  COALESCE(NULLIF(parsed_license."license" ->> 'provider', ''), 'local'),
  COALESCE(NULLIF(parsed_license."license" ->> 'plan', ''), 'STARTER'),
  COALESCE(NULLIF(parsed_license."license" ->> 'billingCycle', ''), 'monthly'),
  COALESCE(NULLIF(parsed_license."license" ->> 'status', ''), 'ACTIVE'),
  CASE
    WHEN NULLIF(parsed_license."license" ->> 'seats', '') ~ '^[0-9]+$'
      THEN GREATEST((parsed_license."license" ->> 'seats')::INTEGER, 1)
    ELSE 3
  END,
  CASE
    WHEN NULLIF(parsed_license."license" ->> 'priceMonthly', '') ~ '^[0-9]+(\.[0-9]+)?$'
      THEN (parsed_license."license" ->> 'priceMonthly')::DOUBLE PRECISION
    ELSE NULL
  END,
  CASE
    WHEN NULLIF(parsed_license."license" ->> 'expiresAt', '') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}'
      THEN (parsed_license."license" ->> 'expiresAt')::TIMESTAMP(3)
    ELSE NULL
  END,
  CASE
    WHEN COALESCE(NULLIF(parsed_license."license" ->> 'status', ''), 'ACTIVE') = 'TRIAL'
      AND NULLIF(parsed_license."license" ->> 'expiresAt', '') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}'
      THEN (parsed_license."license" ->> 'expiresAt')::TIMESTAMP(3)
    ELSE NULL
  END,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM parsed_license
INNER JOIN "Tenant" ON "Tenant"."id" = parsed_license."tenantId"
ON CONFLICT ("tenantId") DO NOTHING;
