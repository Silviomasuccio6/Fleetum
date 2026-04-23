-- CreateEnum
CREATE TYPE "RentalCustomerType" AS ENUM ('PERSONA_FISICA', 'PERSONA_GIURIDICA');

-- AlterTable
ALTER TABLE "RentalCustomer"
  ADD COLUMN "customerType" "RentalCustomerType" NOT NULL DEFAULT 'PERSONA_FISICA',
  ADD COLUMN "companyName" TEXT,
  ADD COLUMN "companyLegalForm" TEXT,
  ADD COLUMN "companyVatNumber" TEXT,
  ADD COLUMN "companyTaxCode" TEXT,
  ADD COLUMN "companyLegalAddress" TEXT,
  ADD COLUMN "companyPec" TEXT,
  ADD COLUMN "companySdi" TEXT,
  ADD COLUMN "companyRea" TEXT,
  ADD COLUMN "legalRepFirstName" TEXT,
  ADD COLUMN "legalRepLastName" TEXT,
  ADD COLUMN "legalRepTaxCode" TEXT,
  ADD COLUMN "legalRepRole" TEXT,
  ADD COLUMN "legalRepEmail" TEXT,
  ADD COLUMN "legalRepPhone" TEXT;

-- CreateIndex
CREATE INDEX "RentalCustomer_tenantId_customerType_idx" ON "RentalCustomer"("tenantId", "customerType");

-- CreateIndex
CREATE INDEX "RentalCustomer_tenantId_companyName_idx" ON "RentalCustomer"("tenantId", "companyName");

-- CreateIndex
CREATE INDEX "RentalCustomer_tenantId_companyVatNumber_idx" ON "RentalCustomer"("tenantId", "companyVatNumber");
