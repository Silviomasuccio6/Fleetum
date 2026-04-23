-- CreateEnum
CREATE TYPE "BookingContractStatus" AS ENUM ('DRAFT', 'READY', 'SENT', 'SIGNED', 'ERROR');

-- CreateEnum
CREATE TYPE "BookingContractDeliveryStatus" AS ENUM ('PENDING', 'SENT', 'FAILED');

-- AlterTable
ALTER TABLE "RentalBooking" ADD COLUMN     "contractRequired" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "ContractTemplate" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "emailSubject" TEXT,
    "emailBody" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "isDefault" BOOLEAN NOT NULL DEFAULT true,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "ContractTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BookingContract" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "templateId" TEXT,
    "templateVersion" INTEGER NOT NULL DEFAULT 1,
    "status" "BookingContractStatus" NOT NULL DEFAULT 'DRAFT',
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "emailTo" TEXT,
    "emailSubject" TEXT,
    "emailBody" TEXT,
    "pdfFileName" TEXT,
    "pdfGeneratedAt" TIMESTAMP(3),
    "lastSentAt" TIMESTAMP(3),
    "signedAt" TIMESTAMP(3),
    "errorMessage" TEXT,
    "createdByUserId" TEXT,
    "updatedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "BookingContract_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BookingContractEvent" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "actorUserId" TEXT,
    "type" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "details" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BookingContractEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BookingContractDelivery" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "recipient" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "status" "BookingContractDeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "sentAt" TIMESTAMP(3),
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BookingContractDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ContractTemplate_tenantId_isDefault_updatedAt_idx" ON "ContractTemplate"("tenantId", "isDefault", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "BookingContract_bookingId_key" ON "BookingContract"("bookingId");

-- CreateIndex
CREATE INDEX "BookingContract_tenantId_status_createdAt_idx" ON "BookingContract"("tenantId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "BookingContract_tenantId_bookingId_updatedAt_idx" ON "BookingContract"("tenantId", "bookingId", "updatedAt");

-- CreateIndex
CREATE INDEX "BookingContractEvent_tenantId_bookingId_createdAt_idx" ON "BookingContractEvent"("tenantId", "bookingId", "createdAt");

-- CreateIndex
CREATE INDEX "BookingContractEvent_contractId_createdAt_idx" ON "BookingContractEvent"("contractId", "createdAt");

-- CreateIndex
CREATE INDEX "BookingContractDelivery_tenantId_bookingId_createdAt_idx" ON "BookingContractDelivery"("tenantId", "bookingId", "createdAt");

-- CreateIndex
CREATE INDEX "BookingContractDelivery_contractId_status_createdAt_idx" ON "BookingContractDelivery"("contractId", "status", "createdAt");

-- AddForeignKey
ALTER TABLE "ContractTemplate" ADD CONSTRAINT "ContractTemplate_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookingContract" ADD CONSTRAINT "BookingContract_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookingContract" ADD CONSTRAINT "BookingContract_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "RentalBooking"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookingContract" ADD CONSTRAINT "BookingContract_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "ContractTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookingContractEvent" ADD CONSTRAINT "BookingContractEvent_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookingContractEvent" ADD CONSTRAINT "BookingContractEvent_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "BookingContract"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookingContractDelivery" ADD CONSTRAINT "BookingContractDelivery_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookingContractDelivery" ADD CONSTRAINT "BookingContractDelivery_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "BookingContract"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
