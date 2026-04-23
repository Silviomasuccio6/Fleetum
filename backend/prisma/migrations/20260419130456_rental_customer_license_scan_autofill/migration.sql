-- AlterTable
ALTER TABLE "RentalCustomer" ADD COLUMN     "drivingLicenseAuthority" TEXT,
ADD COLUMN     "drivingLicenseCategory" TEXT,
ADD COLUMN     "drivingLicenseExpiresAt" TIMESTAMP(3),
ADD COLUMN     "drivingLicenseIssuedAt" TIMESTAMP(3),
ADD COLUMN     "drivingLicenseNumber" TEXT NOT NULL DEFAULT '';

-- CreateIndex
CREATE INDEX "RentalCustomer_tenantId_drivingLicenseNumber_idx" ON "RentalCustomer"("tenantId", "drivingLicenseNumber");
