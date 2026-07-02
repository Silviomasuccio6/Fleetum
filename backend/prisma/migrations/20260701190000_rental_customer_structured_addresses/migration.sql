-- Structured customer geography for safer autofill and cleaner registry data.
ALTER TABLE "RentalCustomer"
  ADD COLUMN "birthCountry" TEXT,
  ADD COLUMN "birthProvince" TEXT,
  ADD COLUMN "birthMunicipalityCode" TEXT,
  ADD COLUMN "birthCity" TEXT,
  ADD COLUMN "nationalityCountry" TEXT,
  ADD COLUMN "residenceCountry" TEXT,
  ADD COLUMN "residenceRegion" TEXT,
  ADD COLUMN "residenceProvince" TEXT,
  ADD COLUMN "residenceMunicipalityCode" TEXT,
  ADD COLUMN "residenceCity" TEXT,
  ADD COLUMN "residencePostalCode" TEXT,
  ADD COLUMN "residenceStreetAddress" TEXT,
  ADD COLUMN "companyCountry" TEXT,
  ADD COLUMN "companyRegion" TEXT,
  ADD COLUMN "companyProvince" TEXT,
  ADD COLUMN "companyMunicipalityCode" TEXT,
  ADD COLUMN "companyCity" TEXT,
  ADD COLUMN "companyPostalCode" TEXT,
  ADD COLUMN "companyStreetAddress" TEXT;

CREATE INDEX "RentalCustomer_tenantId_residenceProvince_residenceCity_idx"
  ON "RentalCustomer"("tenantId", "residenceProvince", "residenceCity");

CREATE INDEX "RentalCustomer_tenantId_companyProvince_companyCity_idx"
  ON "RentalCustomer"("tenantId", "companyProvince", "companyCity");
