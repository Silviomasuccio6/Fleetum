-- Atomic email worker claims and idempotent rental-booking creation.
ALTER TABLE "EmailQueue"
  ADD COLUMN "processingToken" TEXT,
  ADD COLUMN "processingStartedAt" TIMESTAMP(3),
  ADD COLUMN "leaseExpiresAt" TIMESTAMP(3);

CREATE INDEX "EmailQueue_status_nextAttemptAt_leaseExpiresAt_idx"
  ON "EmailQueue"("status", "nextAttemptAt", "leaseExpiresAt");

CREATE TABLE "RentalBookingCreateRequest" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "requestHash" TEXT NOT NULL,
  "bookingId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "RentalBookingCreateRequest_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "RentalBookingCreateRequest_bookingId_key"
  ON "RentalBookingCreateRequest"("bookingId");

CREATE UNIQUE INDEX "RentalBookingCreateRequest_tenantId_idempotencyKey_key"
  ON "RentalBookingCreateRequest"("tenantId", "idempotencyKey");

CREATE INDEX "RentalBookingCreateRequest_tenantId_createdAt_idx"
  ON "RentalBookingCreateRequest"("tenantId", "createdAt");

ALTER TABLE "RentalBookingCreateRequest"
  ADD CONSTRAINT "RentalBookingCreateRequest_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "RentalBookingCreateRequest"
  ADD CONSTRAINT "RentalBookingCreateRequest_bookingId_fkey"
  FOREIGN KEY ("bookingId") REFERENCES "RentalBooking"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Tenant-scoped request ledger for atomic, idempotent contract email enqueue.
CREATE TABLE "BookingContractEmailRequest" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "requestHash" TEXT NOT NULL,
  "deliveryId" TEXT NOT NULL,
  "queueEmailId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "BookingContractEmailRequest_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BookingContractEmailRequest_deliveryId_key"
  ON "BookingContractEmailRequest"("deliveryId");

CREATE UNIQUE INDEX "BookingContractEmailRequest_queueEmailId_key"
  ON "BookingContractEmailRequest"("queueEmailId");

CREATE UNIQUE INDEX "BookingContractEmailRequest_tenantId_idempotencyKey_key"
  ON "BookingContractEmailRequest"("tenantId", "idempotencyKey");

CREATE INDEX "BookingContractEmailRequest_tenantId_createdAt_idx"
  ON "BookingContractEmailRequest"("tenantId", "createdAt");

ALTER TABLE "BookingContractEmailRequest"
  ADD CONSTRAINT "BookingContractEmailRequest_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "BookingContractEmailRequest"
  ADD CONSTRAINT "BookingContractEmailRequest_deliveryId_fkey"
  FOREIGN KEY ("deliveryId") REFERENCES "BookingContractDelivery"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Persistent command ledger for atomic, idempotent invoice email enqueue.
CREATE TABLE "InvoiceEmailRequest" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "requestHash" TEXT NOT NULL,
  "deliveryId" TEXT NOT NULL,
  "queueEmailId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "InvoiceEmailRequest_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "InvoiceEmailRequest_deliveryId_key"
  ON "InvoiceEmailRequest"("deliveryId");

CREATE UNIQUE INDEX "InvoiceEmailRequest_queueEmailId_key"
  ON "InvoiceEmailRequest"("queueEmailId");

CREATE UNIQUE INDEX "InvoiceEmailRequest_tenantId_idempotencyKey_key"
  ON "InvoiceEmailRequest"("tenantId", "idempotencyKey");

CREATE INDEX "InvoiceEmailRequest_tenantId_createdAt_idx"
  ON "InvoiceEmailRequest"("tenantId", "createdAt");

ALTER TABLE "InvoiceEmailRequest"
  ADD CONSTRAINT "InvoiceEmailRequest_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "InvoiceEmailRequest"
  ADD CONSTRAINT "InvoiceEmailRequest_deliveryId_fkey"
  FOREIGN KEY ("deliveryId") REFERENCES "InvoiceDelivery"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Public demo command correlation. Historical leads keep both fields NULL.
ALTER TABLE "DemoLead"
  ADD COLUMN "idempotencyKey" TEXT,
  ADD COLUMN "requestHash" TEXT;

CREATE UNIQUE INDEX "DemoLead_idempotencyKey_key"
  ON "DemoLead"("idempotencyKey");
