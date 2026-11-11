-- Additive only: legacy assignments and booking sites remain unclassified.
-- Never infer a booking's historical site from a vehicle's current position.
ALTER TABLE "User" ADD COLUMN "assignedSiteId" TEXT;
ALTER TABLE "RentalBooking" ADD COLUMN "siteId" TEXT,
    ADD COLUMN "pickupSiteId" TEXT, ADD COLUMN "returnSiteId" TEXT;

CREATE UNIQUE INDEX "Site_id_tenantId_key" ON "Site"("id", "tenantId");
CREATE INDEX "User_tenantId_assignedSiteId_idx" ON "User"("tenantId", "assignedSiteId");
CREATE INDEX "RentalBooking_tenantId_siteId_pickupAt_idx" ON "RentalBooking"("tenantId", "siteId", "pickupAt");
CREATE INDEX "RentalBooking_tenantId_pickupSiteId_pickupAt_idx" ON "RentalBooking"("tenantId", "pickupSiteId", "pickupAt");
CREATE INDEX "RentalBooking_tenantId_returnSiteId_returnAt_idx" ON "RentalBooking"("tenantId", "returnSiteId", "returnAt");

ALTER TABLE "User" ADD CONSTRAINT "User_assignedSiteId_tenantId_fkey"
    FOREIGN KEY ("assignedSiteId", "tenantId") REFERENCES "Site"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RentalBooking" ADD CONSTRAINT "RentalBooking_siteId_tenantId_fkey"
    FOREIGN KEY ("siteId", "tenantId") REFERENCES "Site"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RentalBooking" ADD CONSTRAINT "RentalBooking_pickupSiteId_tenantId_fkey"
    FOREIGN KEY ("pickupSiteId", "tenantId") REFERENCES "Site"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RentalBooking" ADD CONSTRAINT "RentalBooking_returnSiteId_tenantId_fkey"
    FOREIGN KEY ("returnSiteId", "tenantId") REFERENCES "Site"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;
