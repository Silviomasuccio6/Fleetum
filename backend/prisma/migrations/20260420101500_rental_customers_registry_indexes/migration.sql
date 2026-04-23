-- CreateIndex
CREATE INDEX "RentalBooking_tenantId_customerId_pickupAt_idx" ON "RentalBooking"("tenantId", "customerId", "pickupAt");

-- CreateIndex
CREATE INDEX "BookingContract_tenantId_bookingId_status_createdAt_idx" ON "BookingContract"("tenantId", "bookingId", "status", "createdAt");
