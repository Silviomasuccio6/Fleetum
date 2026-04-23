-- CreateEnum
CREATE TYPE "RentalBookingStatus" AS ENUM (
  'DRAFT',
  'QUOTED',
  'HOLD',
  'CONFIRMED',
  'CONTRACT_SIGNED',
  'READY_FOR_HANDOVER',
  'IN_RENT',
  'CLOSED',
  'CANCELED',
  'NO_SHOW'
);

-- CreateEnum
CREATE TYPE "RentalContractStatus" AS ENUM (
  'NOT_READY',
  'READY',
  'SIGNED'
);

-- CreateEnum
CREATE TYPE "RentalCargosStatus" AS ENUM (
  'NOT_REQUIRED',
  'PENDING',
  'SENT',
  'ERROR'
);

-- CreateTable
CREATE TABLE "RentalBooking" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "vehicleId" TEXT NOT NULL,
  "createdByUserId" TEXT,
  "code" TEXT NOT NULL,
  "status" "RentalBookingStatus" NOT NULL DEFAULT 'DRAFT',
  "contractStatus" "RentalContractStatus" NOT NULL DEFAULT 'NOT_READY',
  "cargosStatus" "RentalCargosStatus" NOT NULL DEFAULT 'NOT_REQUIRED',
  "customerName" TEXT NOT NULL,
  "customerEmail" TEXT,
  "customerPhone" TEXT,
  "customerDocument" TEXT,
  "pickupAt" TIMESTAMP(3) NOT NULL,
  "returnAt" TIMESTAMP(3) NOT NULL,
  "pickupLocation" TEXT,
  "returnLocation" TEXT,
  "expectedTotal" DOUBLE PRECISION,
  "finalTotal" DOUBLE PRECISION,
  "reason" TEXT,
  "internalNotes" TEXT,
  "contractSignedAt" TIMESTAMP(3),
  "cargosSentAt" TIMESTAMP(3),
  "cargosOutcomeMessage" TEXT,
  "cargosTransmissionId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "deletedAt" TIMESTAMP(3),

  CONSTRAINT "RentalBooking_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RentalBookingNote" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "bookingId" TEXT NOT NULL,
  "userId" TEXT,
  "type" TEXT NOT NULL DEFAULT 'NOTE',
  "message" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "RentalBookingNote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RentalBooking_tenantId_code_key" ON "RentalBooking"("tenantId", "code");

-- CreateIndex
CREATE INDEX "RentalBooking_tenantId_status_idx" ON "RentalBooking"("tenantId", "status");

-- CreateIndex
CREATE INDEX "RentalBooking_tenantId_contractStatus_idx" ON "RentalBooking"("tenantId", "contractStatus");

-- CreateIndex
CREATE INDEX "RentalBooking_tenantId_cargosStatus_idx" ON "RentalBooking"("tenantId", "cargosStatus");

-- CreateIndex
CREATE INDEX "RentalBooking_tenantId_pickupAt_idx" ON "RentalBooking"("tenantId", "pickupAt");

-- CreateIndex
CREATE INDEX "RentalBooking_tenantId_returnAt_idx" ON "RentalBooking"("tenantId", "returnAt");

-- CreateIndex
CREATE INDEX "RentalBooking_vehicleId_pickupAt_returnAt_idx" ON "RentalBooking"("vehicleId", "pickupAt", "returnAt");

-- CreateIndex
CREATE INDEX "RentalBookingNote_tenantId_bookingId_createdAt_idx" ON "RentalBookingNote"("tenantId", "bookingId", "createdAt");

-- AddForeignKey
ALTER TABLE "RentalBooking"
  ADD CONSTRAINT "RentalBooking_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RentalBooking"
  ADD CONSTRAINT "RentalBooking_vehicleId_fkey"
  FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RentalBooking"
  ADD CONSTRAINT "RentalBooking_createdByUserId_fkey"
  FOREIGN KEY ("createdByUserId") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RentalBookingNote"
  ADD CONSTRAINT "RentalBookingNote_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RentalBookingNote"
  ADD CONSTRAINT "RentalBookingNote_bookingId_fkey"
  FOREIGN KEY ("bookingId") REFERENCES "RentalBooking"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
