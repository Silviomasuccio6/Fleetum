CREATE TYPE "RentalCollectionKind" AS ENUM ('RECEIPT','REFUND','REVERSAL');
CREATE TYPE "RentalCollectionMethod" AS ENUM ('CASH','BANK_TRANSFER','EXTERNAL_POS');
CREATE UNIQUE INDEX "RentalBooking_id_tenantId_key" ON "RentalBooking"("id","tenantId");
CREATE UNIQUE INDEX "User_id_tenantId_key" ON "User"("id","tenantId");
ALTER TABLE "RentalDeposit" ADD COLUMN "captureBefore" TIMESTAMP(3);
CREATE TABLE "RentalCollectionEntry" (
 "id" TEXT NOT NULL PRIMARY KEY,"tenantId" TEXT NOT NULL,"bookingId" TEXT NOT NULL,
 "createdByUserId" TEXT NOT NULL,"kind" "RentalCollectionKind" NOT NULL,
 "method" "RentalCollectionMethod" NOT NULL,"amountCents" INTEGER NOT NULL,
 "currency" TEXT NOT NULL DEFAULT 'EUR',"occurredAt" TIMESTAMP(3) NOT NULL,
 "reference" TEXT NOT NULL,"reason" TEXT NOT NULL,"requestKey" TEXT NOT NULL,
 "requestHash" TEXT NOT NULL,"sourceId" TEXT,"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "RentalCollectionEntry_amount_check" CHECK ("amountCents">0 AND "amountCents"<=100000000 AND "currency"='EUR'),
 CONSTRAINT "RentalCollectionEntry_source_check" CHECK (("kind"='RECEIPT' AND "sourceId" IS NULL) OR ("kind"<>'RECEIPT' AND "sourceId" IS NOT NULL)),
 CONSTRAINT "RentalCollectionEntry_tenant_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT "RentalCollectionEntry_booking_fkey" FOREIGN KEY ("bookingId","tenantId") REFERENCES "RentalBooking"("id","tenantId") ON DELETE RESTRICT ON UPDATE RESTRICT,
 CONSTRAINT "RentalCollectionEntry_author_fkey" FOREIGN KEY ("createdByUserId","tenantId") REFERENCES "User"("id","tenantId") ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE UNIQUE INDEX "RentalCollectionEntry_id_tenantId_bookingId_key" ON "RentalCollectionEntry"("id","tenantId","bookingId");
CREATE UNIQUE INDEX "RentalCollectionEntry_tenantId_requestKey_key" ON "RentalCollectionEntry"("tenantId","requestKey");
CREATE UNIQUE INDEX "RentalCollectionEntry_one_reversal" ON "RentalCollectionEntry"("tenantId","sourceId") WHERE "kind"='REVERSAL';
CREATE INDEX "RentalCollectionEntry_tenantId_bookingId_createdAt_idx" ON "RentalCollectionEntry"("tenantId","bookingId","createdAt");
CREATE INDEX "RentalCollectionEntry_tenantId_occurredAt_idx" ON "RentalCollectionEntry"("tenantId","occurredAt");
ALTER TABLE "RentalCollectionEntry" ADD CONSTRAINT "RentalCollectionEntry_source_fkey" FOREIGN KEY ("sourceId","tenantId","bookingId") REFERENCES "RentalCollectionEntry"("id","tenantId","bookingId") ON DELETE RESTRICT ON UPDATE RESTRICT;
CREATE FUNCTION fleetum_collection_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Rental collections are append-only; record a reversal instead' USING ERRCODE='23514'; END;
$$;
CREATE TRIGGER "RentalCollectionEntry_immutable" BEFORE UPDATE OR DELETE ON "RentalCollectionEntry" FOR EACH ROW EXECUTE FUNCTION fleetum_collection_immutable();
