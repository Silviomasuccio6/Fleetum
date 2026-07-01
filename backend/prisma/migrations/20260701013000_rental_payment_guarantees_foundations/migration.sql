-- Foundations for rental guarantees and customer payment methods.
-- This module is intentionally separate from Fleetum SaaS billing tables
-- (TenantSubscription/BillingEvent) because it concerns the tenant's end customers.

CREATE TYPE "RentalPaymentMethodStatus" AS ENUM (
  'SETUP_PENDING',
  'ACTIVE',
  'FAILED',
  'REQUIRES_ACTION',
  'EXPIRED',
  'REMOVED'
);

CREATE TYPE "RentalDepositStatus" AS ENUM (
  'DRAFT',
  'AUTHORIZING',
  'AUTHORIZED',
  'PARTIALLY_CAPTURED',
  'CAPTURED',
  'RELEASED',
  'CANCELED',
  'FAILED',
  'EXPIRED'
);

CREATE TYPE "RentalExtraChargeStatus" AS ENUM (
  'DRAFT',
  'PENDING_APPROVAL',
  'APPROVED',
  'NOTIFIED',
  'PAYMENT_PROCESSING',
  'PAID',
  'FAILED',
  'REQUIRES_ACTION',
  'CANCELED',
  'REFUNDED',
  'DISPUTED'
);

CREATE TYPE "RentalExtraChargeType" AS ENUM (
  'FINE',
  'DAMAGE',
  'DEDUCTIBLE',
  'FUEL',
  'TOLL',
  'LATE_RETURN',
  'CLEANING',
  'MISSING_ACCESSORY',
  'ADMIN_FEE',
  'OTHER'
);

CREATE TABLE "RentalCustomerPaymentProfile" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "rentalCustomerId" TEXT NOT NULL,
  "stripeCustomerId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "deletedAt" TIMESTAMP(3),

  CONSTRAINT "RentalCustomerPaymentProfile_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "RentalCustomerPaymentMethod" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "paymentProfileId" TEXT NOT NULL,
  "rentalCustomerId" TEXT NOT NULL,
  "bookingId" TEXT,
  "stripeCustomerId" TEXT NOT NULL,
  "stripePaymentMethodId" TEXT NOT NULL,
  "stripeSetupIntentId" TEXT,
  "cardBrand" TEXT,
  "cardLast4" TEXT,
  "cardExpMonth" INTEGER,
  "cardExpYear" INTEGER,
  "cardholderName" TEXT,
  "status" "RentalPaymentMethodStatus" NOT NULL DEFAULT 'SETUP_PENDING',
  "mandateAccepted" BOOLEAN NOT NULL DEFAULT false,
  "mandateAcceptedAt" TIMESTAMP(3),
  "mandateIp" TEXT,
  "mandateUserAgent" TEXT,
  "termsVersion" TEXT,
  "isDefault" BOOLEAN NOT NULL DEFAULT false,
  "createdByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "deletedAt" TIMESTAMP(3),

  CONSTRAINT "RentalCustomerPaymentMethod_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "RentalDeposit" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "bookingId" TEXT NOT NULL,
  "rentalCustomerId" TEXT NOT NULL,
  "vehicleId" TEXT,
  "paymentMethodId" TEXT NOT NULL,
  "stripePaymentIntentId" TEXT,
  "amountCents" INTEGER NOT NULL,
  "capturedAmountCents" INTEGER NOT NULL DEFAULT 0,
  "currency" TEXT NOT NULL DEFAULT 'EUR',
  "status" "RentalDepositStatus" NOT NULL DEFAULT 'DRAFT',
  "failureReason" TEXT,
  "authorizedAt" TIMESTAMP(3),
  "capturedAt" TIMESTAMP(3),
  "releasedAt" TIMESTAMP(3),
  "createdByUserId" TEXT,
  "approvedByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "deletedAt" TIMESTAMP(3),

  CONSTRAINT "RentalDeposit_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "RentalExtraCharge" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "bookingId" TEXT NOT NULL,
  "rentalCustomerId" TEXT NOT NULL,
  "vehicleId" TEXT,
  "paymentMethodId" TEXT,
  "stripePaymentIntentId" TEXT,
  "type" "RentalExtraChargeType" NOT NULL,
  "description" TEXT NOT NULL,
  "amountCents" INTEGER NOT NULL,
  "adminFeeCents" INTEGER NOT NULL DEFAULT 0,
  "totalAmountCents" INTEGER NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'EUR',
  "status" "RentalExtraChargeStatus" NOT NULL DEFAULT 'DRAFT',
  "evidenceFileUrl" TEXT,
  "notifiedAt" TIMESTAMP(3),
  "chargedAt" TIMESTAMP(3),
  "failureReason" TEXT,
  "createdByUserId" TEXT,
  "approvedByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "deletedAt" TIMESTAMP(3),

  CONSTRAINT "RentalExtraCharge_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "RentalPaymentEvent" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "provider" TEXT NOT NULL DEFAULT 'stripe',
  "eventId" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "paymentProfileId" TEXT,
  "paymentMethodId" TEXT,
  "depositId" TEXT,
  "extraChargeId" TEXT,
  "bookingId" TEXT,
  "rentalCustomerId" TEXT,
  "processedAt" TIMESTAMP(3),
  "status" TEXT NOT NULL DEFAULT 'RECEIVED',
  "errorMessage" TEXT,
  "payload" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "deletedAt" TIMESTAMP(3),

  CONSTRAINT "RentalPaymentEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "RentalCustomerPaymentProfile_tenantId_rentalCustomerId_key" ON "RentalCustomerPaymentProfile"("tenantId", "rentalCustomerId");
CREATE UNIQUE INDEX "RentalCustomerPaymentProfile_stripeCustomerId_key" ON "RentalCustomerPaymentProfile"("stripeCustomerId");
CREATE INDEX "RentalCustomerPaymentProfile_tenantId_rentalCustomerId_idx" ON "RentalCustomerPaymentProfile"("tenantId", "rentalCustomerId");
CREATE INDEX "RentalCustomerPaymentProfile_tenantId_status_idx" ON "RentalCustomerPaymentProfile"("tenantId", "status");
CREATE INDEX "RentalCustomerPaymentProfile_tenantId_deletedAt_idx" ON "RentalCustomerPaymentProfile"("tenantId", "deletedAt");

CREATE UNIQUE INDEX "RentalCustomerPaymentMethod_stripePaymentMethodId_key" ON "RentalCustomerPaymentMethod"("stripePaymentMethodId");
CREATE INDEX "RentalCustomerPaymentMethod_tenantId_rentalCustomerId_idx" ON "RentalCustomerPaymentMethod"("tenantId", "rentalCustomerId");
CREATE INDEX "RentalCustomerPaymentMethod_tenantId_bookingId_idx" ON "RentalCustomerPaymentMethod"("tenantId", "bookingId");
CREATE INDEX "RentalCustomerPaymentMethod_tenantId_status_idx" ON "RentalCustomerPaymentMethod"("tenantId", "status");
CREATE INDEX "RentalCustomerPaymentMethod_tenantId_deletedAt_idx" ON "RentalCustomerPaymentMethod"("tenantId", "deletedAt");
CREATE INDEX "RentalCustomerPaymentMethod_stripeSetupIntentId_idx" ON "RentalCustomerPaymentMethod"("stripeSetupIntentId");

CREATE INDEX "RentalDeposit_tenantId_bookingId_idx" ON "RentalDeposit"("tenantId", "bookingId");
CREATE INDEX "RentalDeposit_tenantId_rentalCustomerId_idx" ON "RentalDeposit"("tenantId", "rentalCustomerId");
CREATE INDEX "RentalDeposit_tenantId_status_idx" ON "RentalDeposit"("tenantId", "status");
CREATE INDEX "RentalDeposit_tenantId_deletedAt_idx" ON "RentalDeposit"("tenantId", "deletedAt");
CREATE INDEX "RentalDeposit_stripePaymentIntentId_idx" ON "RentalDeposit"("stripePaymentIntentId");

CREATE INDEX "RentalExtraCharge_tenantId_bookingId_idx" ON "RentalExtraCharge"("tenantId", "bookingId");
CREATE INDEX "RentalExtraCharge_tenantId_rentalCustomerId_idx" ON "RentalExtraCharge"("tenantId", "rentalCustomerId");
CREATE INDEX "RentalExtraCharge_tenantId_status_idx" ON "RentalExtraCharge"("tenantId", "status");
CREATE INDEX "RentalExtraCharge_tenantId_type_idx" ON "RentalExtraCharge"("tenantId", "type");
CREATE INDEX "RentalExtraCharge_tenantId_deletedAt_idx" ON "RentalExtraCharge"("tenantId", "deletedAt");
CREATE INDEX "RentalExtraCharge_stripePaymentIntentId_idx" ON "RentalExtraCharge"("stripePaymentIntentId");

CREATE UNIQUE INDEX "RentalPaymentEvent_provider_eventId_key" ON "RentalPaymentEvent"("provider", "eventId");
CREATE INDEX "RentalPaymentEvent_tenantId_type_idx" ON "RentalPaymentEvent"("tenantId", "type");
CREATE INDEX "RentalPaymentEvent_tenantId_status_createdAt_idx" ON "RentalPaymentEvent"("tenantId", "status", "createdAt");
CREATE INDEX "RentalPaymentEvent_tenantId_bookingId_idx" ON "RentalPaymentEvent"("tenantId", "bookingId");
CREATE INDEX "RentalPaymentEvent_tenantId_rentalCustomerId_idx" ON "RentalPaymentEvent"("tenantId", "rentalCustomerId");
CREATE INDEX "RentalPaymentEvent_tenantId_deletedAt_idx" ON "RentalPaymentEvent"("tenantId", "deletedAt");

ALTER TABLE "RentalCustomerPaymentProfile" ADD CONSTRAINT "RentalCustomerPaymentProfile_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RentalCustomerPaymentProfile" ADD CONSTRAINT "RentalCustomerPaymentProfile_rentalCustomerId_fkey" FOREIGN KEY ("rentalCustomerId") REFERENCES "RentalCustomer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "RentalCustomerPaymentMethod" ADD CONSTRAINT "RentalCustomerPaymentMethod_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RentalCustomerPaymentMethod" ADD CONSTRAINT "RentalCustomerPaymentMethod_paymentProfileId_fkey" FOREIGN KEY ("paymentProfileId") REFERENCES "RentalCustomerPaymentProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RentalCustomerPaymentMethod" ADD CONSTRAINT "RentalCustomerPaymentMethod_rentalCustomerId_fkey" FOREIGN KEY ("rentalCustomerId") REFERENCES "RentalCustomer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RentalCustomerPaymentMethod" ADD CONSTRAINT "RentalCustomerPaymentMethod_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "RentalBooking"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "RentalCustomerPaymentMethod" ADD CONSTRAINT "RentalCustomerPaymentMethod_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "RentalDeposit" ADD CONSTRAINT "RentalDeposit_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RentalDeposit" ADD CONSTRAINT "RentalDeposit_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "RentalBooking"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RentalDeposit" ADD CONSTRAINT "RentalDeposit_rentalCustomerId_fkey" FOREIGN KEY ("rentalCustomerId") REFERENCES "RentalCustomer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RentalDeposit" ADD CONSTRAINT "RentalDeposit_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "RentalDeposit" ADD CONSTRAINT "RentalDeposit_paymentMethodId_fkey" FOREIGN KEY ("paymentMethodId") REFERENCES "RentalCustomerPaymentMethod"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RentalDeposit" ADD CONSTRAINT "RentalDeposit_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "RentalDeposit" ADD CONSTRAINT "RentalDeposit_approvedByUserId_fkey" FOREIGN KEY ("approvedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "RentalExtraCharge" ADD CONSTRAINT "RentalExtraCharge_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RentalExtraCharge" ADD CONSTRAINT "RentalExtraCharge_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "RentalBooking"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RentalExtraCharge" ADD CONSTRAINT "RentalExtraCharge_rentalCustomerId_fkey" FOREIGN KEY ("rentalCustomerId") REFERENCES "RentalCustomer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RentalExtraCharge" ADD CONSTRAINT "RentalExtraCharge_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "RentalExtraCharge" ADD CONSTRAINT "RentalExtraCharge_paymentMethodId_fkey" FOREIGN KEY ("paymentMethodId") REFERENCES "RentalCustomerPaymentMethod"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "RentalExtraCharge" ADD CONSTRAINT "RentalExtraCharge_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "RentalExtraCharge" ADD CONSTRAINT "RentalExtraCharge_approvedByUserId_fkey" FOREIGN KEY ("approvedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "RentalPaymentEvent" ADD CONSTRAINT "RentalPaymentEvent_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RentalPaymentEvent" ADD CONSTRAINT "RentalPaymentEvent_paymentProfileId_fkey" FOREIGN KEY ("paymentProfileId") REFERENCES "RentalCustomerPaymentProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "RentalPaymentEvent" ADD CONSTRAINT "RentalPaymentEvent_paymentMethodId_fkey" FOREIGN KEY ("paymentMethodId") REFERENCES "RentalCustomerPaymentMethod"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "RentalPaymentEvent" ADD CONSTRAINT "RentalPaymentEvent_depositId_fkey" FOREIGN KEY ("depositId") REFERENCES "RentalDeposit"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "RentalPaymentEvent" ADD CONSTRAINT "RentalPaymentEvent_extraChargeId_fkey" FOREIGN KEY ("extraChargeId") REFERENCES "RentalExtraCharge"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "RentalPaymentEvent" ADD CONSTRAINT "RentalPaymentEvent_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "RentalBooking"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "RentalPaymentEvent" ADD CONSTRAINT "RentalPaymentEvent_rentalCustomerId_fkey" FOREIGN KEY ("rentalCustomerId") REFERENCES "RentalCustomer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
