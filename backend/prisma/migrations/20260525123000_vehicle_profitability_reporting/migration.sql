-- Vehicle profitability reporting fields are nullable to keep the migration safe for existing tenants.
CREATE TYPE "VehicleCostType" AS ENUM ('PURCHASE', 'INSURANCE', 'TAX', 'MAINTENANCE', 'REPAIR', 'REVISION', 'CLEANING', 'OTHER');

ALTER TABLE "Vehicle"
  ADD COLUMN "purchasePrice" DOUBLE PRECISION,
  ADD COLUMN "purchaseDate" TIMESTAMP(3),
  ADD COLUMN "residualValue" DOUBLE PRECISION,
  ADD COLUMN "monthlyFixedCost" DOUBLE PRECISION;

CREATE TABLE "VehicleCost" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "vehicleId" TEXT NOT NULL,
  "type" "VehicleCostType" NOT NULL DEFAULT 'OTHER',
  "description" TEXT,
  "amount" DOUBLE PRECISION NOT NULL,
  "date" TIMESTAMP(3) NOT NULL,
  "recurring" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "deletedAt" TIMESTAMP(3),
  CONSTRAINT "VehicleCost_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "VehicleCost_tenantId_vehicleId_date_idx" ON "VehicleCost"("tenantId", "vehicleId", "date");
CREATE INDEX "VehicleCost_tenantId_type_idx" ON "VehicleCost"("tenantId", "type");
CREATE INDEX "VehicleCost_tenantId_deletedAt_idx" ON "VehicleCost"("tenantId", "deletedAt");

ALTER TABLE "VehicleCost" ADD CONSTRAINT "VehicleCost_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "VehicleCost" ADD CONSTRAINT "VehicleCost_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
