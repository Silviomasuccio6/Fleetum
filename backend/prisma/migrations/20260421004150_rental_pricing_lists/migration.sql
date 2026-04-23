-- CreateEnum
CREATE TYPE "RentalPricingScope" AS ENUM ('GLOBAL', 'SITE', 'VEHICLE_CATEGORY', 'VEHICLE');

-- CreateEnum
CREATE TYPE "RentalBaseRateUnit" AS ENUM ('DAILY', 'WEEKLY', 'MONTHLY');

-- CreateEnum
CREATE TYPE "RentalKmPackageType" AS ENUM ('LIMITED', 'UNLIMITED');

-- CreateEnum
CREATE TYPE "RentalKmScope" AS ENUM ('PER_DAY', 'PER_RENTAL');

-- CreateEnum
CREATE TYPE "RentalExtraKmPolicyType" AS ENUM ('FLAT', 'TIERED');

-- CreateEnum
CREATE TYPE "RentalHourOverflowRule" AS ENUM ('NONE', 'HALF_DAY', 'FULL_DAY');

-- CreateTable
CREATE TABLE "RentalPriceList" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "validFrom" TIMESTAMP(3),
    "validTo" TIMESTAMP(3),
    "scope" "RentalPricingScope" NOT NULL DEFAULT 'GLOBAL',
    "siteId" TEXT,
    "vehicleId" TEXT,
    "vehicleCategory" TEXT,
    "baseRateUnit" "RentalBaseRateUnit" NOT NULL DEFAULT 'DAILY',
    "baseRateAmount" DOUBLE PRECISION NOT NULL,
    "vatRate" DOUBLE PRECISION NOT NULL DEFAULT 22,
    "discountPercent" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "hourOverflowRule" "RentalHourOverflowRule" NOT NULL DEFAULT 'FULL_DAY',
    "priority" INTEGER NOT NULL DEFAULT 100,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "RentalPriceList_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RentalPricePackage" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "priceListId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "type" "RentalKmPackageType" NOT NULL DEFAULT 'LIMITED',
    "kmIncluded" INTEGER,
    "kmScope" "RentalKmScope" NOT NULL DEFAULT 'PER_DAY',
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "RentalPricePackage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RentalExtraKmPolicy" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "priceListId" TEXT NOT NULL,
    "packageId" TEXT,
    "name" TEXT NOT NULL,
    "type" "RentalExtraKmPolicyType" NOT NULL DEFAULT 'FLAT',
    "flatRatePerKm" DOUBLE PRECISION,
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "RentalExtraKmPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RentalExtraKmTier" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "policyId" TEXT NOT NULL,
    "fromKm" INTEGER NOT NULL DEFAULT 1,
    "toKm" INTEGER,
    "ratePerKm" DOUBLE PRECISION NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RentalExtraKmTier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RentalBookingPricingSnapshot" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "priceListId" TEXT,
    "pricePackageId" TEXT,
    "extraKmPolicyId" TEXT,
    "priceListName" TEXT,
    "pricePackageName" TEXT,
    "extraKmPolicyName" TEXT,
    "baseRateUnit" "RentalBaseRateUnit",
    "baseRateAmount" DOUBLE PRECISION,
    "vatRate" DOUBLE PRECISION,
    "discountPercent" DOUBLE PRECISION,
    "hourOverflowRule" "RentalHourOverflowRule",
    "estimatedKm" INTEGER,
    "actualKm" INTEGER,
    "includedKmTotal" INTEGER,
    "extraKmEstimated" INTEGER,
    "extraKmActual" INTEGER,
    "extraKmEstimatedCost" DOUBLE PRECISION,
    "extraKmActualCost" DOUBLE PRECISION,
    "daysCharged" DOUBLE PRECISION,
    "expectedSubtotal" DOUBLE PRECISION,
    "expectedTaxAmount" DOUBLE PRECISION,
    "expectedTotal" DOUBLE PRECISION,
    "finalSubtotal" DOUBLE PRECISION,
    "finalTaxAmount" DOUBLE PRECISION,
    "finalTotal" DOUBLE PRECISION,
    "notes" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "RentalBookingPricingSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RentalPriceList_tenantId_isActive_idx" ON "RentalPriceList"("tenantId", "isActive");

-- CreateIndex
CREATE INDEX "RentalPriceList_tenantId_validFrom_validTo_idx" ON "RentalPriceList"("tenantId", "validFrom", "validTo");

-- CreateIndex
CREATE INDEX "RentalPriceList_tenantId_siteId_vehicleCategory_vehicleId_idx" ON "RentalPriceList"("tenantId", "siteId", "vehicleCategory", "vehicleId");

-- CreateIndex
CREATE INDEX "RentalPriceList_tenantId_priority_updatedAt_idx" ON "RentalPriceList"("tenantId", "priority", "updatedAt");

-- CreateIndex
CREATE INDEX "RentalPricePackage_tenantId_priceListId_isActive_idx" ON "RentalPricePackage"("tenantId", "priceListId", "isActive");

-- CreateIndex
CREATE INDEX "RentalPricePackage_tenantId_code_idx" ON "RentalPricePackage"("tenantId", "code");

-- CreateIndex
CREATE INDEX "RentalPricePackage_tenantId_sortOrder_updatedAt_idx" ON "RentalPricePackage"("tenantId", "sortOrder", "updatedAt");

-- CreateIndex
CREATE INDEX "RentalExtraKmPolicy_tenantId_isActive_idx" ON "RentalExtraKmPolicy"("tenantId", "isActive");

-- CreateIndex
CREATE INDEX "RentalExtraKmPolicy_tenantId_priceListId_packageId_idx" ON "RentalExtraKmPolicy"("tenantId", "priceListId", "packageId");

-- CreateIndex
CREATE INDEX "RentalExtraKmPolicy_tenantId_type_updatedAt_idx" ON "RentalExtraKmPolicy"("tenantId", "type", "updatedAt");

-- CreateIndex
CREATE INDEX "RentalExtraKmTier_tenantId_policyId_sortOrder_idx" ON "RentalExtraKmTier"("tenantId", "policyId", "sortOrder");

-- CreateIndex
CREATE INDEX "RentalExtraKmTier_policyId_fromKm_toKm_idx" ON "RentalExtraKmTier"("policyId", "fromKm", "toKm");

-- CreateIndex
CREATE UNIQUE INDEX "RentalBookingPricingSnapshot_bookingId_key" ON "RentalBookingPricingSnapshot"("bookingId");

-- CreateIndex
CREATE INDEX "RentalBookingPricingSnapshot_tenantId_bookingId_idx" ON "RentalBookingPricingSnapshot"("tenantId", "bookingId");

-- CreateIndex
CREATE INDEX "RentalBookingPricingSnapshot_tenantId_priceListId_pricePack_idx" ON "RentalBookingPricingSnapshot"("tenantId", "priceListId", "pricePackageId", "extraKmPolicyId");

-- CreateIndex
CREATE INDEX "RentalBookingPricingSnapshot_tenantId_updatedAt_idx" ON "RentalBookingPricingSnapshot"("tenantId", "updatedAt");

-- AddForeignKey
ALTER TABLE "RentalPriceList" ADD CONSTRAINT "RentalPriceList_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RentalPriceList" ADD CONSTRAINT "RentalPriceList_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RentalPriceList" ADD CONSTRAINT "RentalPriceList_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RentalPricePackage" ADD CONSTRAINT "RentalPricePackage_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RentalPricePackage" ADD CONSTRAINT "RentalPricePackage_priceListId_fkey" FOREIGN KEY ("priceListId") REFERENCES "RentalPriceList"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RentalExtraKmPolicy" ADD CONSTRAINT "RentalExtraKmPolicy_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RentalExtraKmPolicy" ADD CONSTRAINT "RentalExtraKmPolicy_priceListId_fkey" FOREIGN KEY ("priceListId") REFERENCES "RentalPriceList"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RentalExtraKmPolicy" ADD CONSTRAINT "RentalExtraKmPolicy_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "RentalPricePackage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RentalExtraKmTier" ADD CONSTRAINT "RentalExtraKmTier_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RentalExtraKmTier" ADD CONSTRAINT "RentalExtraKmTier_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "RentalExtraKmPolicy"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RentalBookingPricingSnapshot" ADD CONSTRAINT "RentalBookingPricingSnapshot_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RentalBookingPricingSnapshot" ADD CONSTRAINT "RentalBookingPricingSnapshot_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "RentalBooking"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RentalBookingPricingSnapshot" ADD CONSTRAINT "RentalBookingPricingSnapshot_priceListId_fkey" FOREIGN KEY ("priceListId") REFERENCES "RentalPriceList"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RentalBookingPricingSnapshot" ADD CONSTRAINT "RentalBookingPricingSnapshot_pricePackageId_fkey" FOREIGN KEY ("pricePackageId") REFERENCES "RentalPricePackage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RentalBookingPricingSnapshot" ADD CONSTRAINT "RentalBookingPricingSnapshot_extraKmPolicyId_fkey" FOREIGN KEY ("extraKmPolicyId") REFERENCES "RentalExtraKmPolicy"("id") ON DELETE SET NULL ON UPDATE CASCADE;
