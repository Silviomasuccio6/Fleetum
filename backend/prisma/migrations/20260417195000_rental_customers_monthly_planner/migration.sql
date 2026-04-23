-- AlterTable
ALTER TABLE "RentalBooking"
ADD COLUMN "customerId" TEXT;

-- CreateTable
CREATE TABLE "RentalCustomer" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "firstName" TEXT NOT NULL,
  "lastName" TEXT NOT NULL,
  "email" TEXT,
  "phone" TEXT,
  "dateOfBirth" TIMESTAMP(3),
  "placeOfBirth" TEXT,
  "nationality" TEXT,
  "residenceAddress" TEXT,
  "taxCode" TEXT,
  "documentType" TEXT,
  "documentNumber" TEXT,
  "documentIssuedAt" TIMESTAMP(3),
  "documentExpiresAt" TIMESTAMP(3),
  "documentAuthority" TEXT,
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "deletedAt" TIMESTAMP(3),

  CONSTRAINT "RentalCustomer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RentalCustomerAttachment" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "customerId" TEXT NOT NULL,
  "bookingId" TEXT,
  "filePath" TEXT NOT NULL,
  "fileName" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL,
  "sizeBytes" INTEGER NOT NULL,
  "category" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "RentalCustomerAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RentalBooking_tenantId_customerId_idx" ON "RentalBooking"("tenantId", "customerId");

-- CreateIndex
CREATE INDEX "RentalCustomer_tenantId_lastName_firstName_idx" ON "RentalCustomer"("tenantId", "lastName", "firstName");

-- CreateIndex
CREATE INDEX "RentalCustomer_tenantId_email_idx" ON "RentalCustomer"("tenantId", "email");

-- CreateIndex
CREATE INDEX "RentalCustomer_tenantId_phone_idx" ON "RentalCustomer"("tenantId", "phone");

-- CreateIndex
CREATE INDEX "RentalCustomerAttachment_tenantId_customerId_createdAt_idx" ON "RentalCustomerAttachment"("tenantId", "customerId", "createdAt");

-- CreateIndex
CREATE INDEX "RentalCustomerAttachment_tenantId_bookingId_idx" ON "RentalCustomerAttachment"("tenantId", "bookingId");

-- AddForeignKey
ALTER TABLE "RentalBooking"
  ADD CONSTRAINT "RentalBooking_customerId_fkey"
  FOREIGN KEY ("customerId") REFERENCES "RentalCustomer"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RentalCustomer"
  ADD CONSTRAINT "RentalCustomer_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RentalCustomerAttachment"
  ADD CONSTRAINT "RentalCustomerAttachment_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RentalCustomerAttachment"
  ADD CONSTRAINT "RentalCustomerAttachment_customerId_fkey"
  FOREIGN KEY ("customerId") REFERENCES "RentalCustomer"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RentalCustomerAttachment"
  ADD CONSTRAINT "RentalCustomerAttachment_bookingId_fkey"
  FOREIGN KEY ("bookingId") REFERENCES "RentalBooking"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
