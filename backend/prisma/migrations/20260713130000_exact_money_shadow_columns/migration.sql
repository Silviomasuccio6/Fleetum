-- Expand phase for exact monetary storage.
-- Legacy Float columns remain available for rollback and current application reads.
ALTER TABLE "TenantSubscription"
  ADD COLUMN "priceMonthlyExact" DECIMAL(19, 2);

ALTER TABLE "Vehicle"
  ADD COLUMN "purchasePriceExact" DECIMAL(19, 2),
  ADD COLUMN "residualValueExact" DECIMAL(19, 2),
  ADD COLUMN "monthlyFixedCostExact" DECIMAL(19, 2);

ALTER TABLE "VehicleCost"
  ADD COLUMN "amountExact" DECIMAL(19, 2);

ALTER TABLE "VehicleMaintenance"
  ADD COLUMN "costExact" DECIMAL(19, 2);

ALTER TABLE "VehicleMaintenanceAttachment"
  ADD COLUMN "invoiceTotalAmountExact" DECIMAL(19, 2);

ALTER TABLE "RentalBooking"
  ADD COLUMN "expectedTotalExact" DECIMAL(19, 2),
  ADD COLUMN "finalTotalExact" DECIMAL(19, 2);

ALTER TABLE "RentalPriceList"
  ADD COLUMN "baseRateAmountExact" DECIMAL(19, 4),
  ADD COLUMN "vatRateExact" DECIMAL(9, 4),
  ADD COLUMN "discountPercentExact" DECIMAL(9, 4);

ALTER TABLE "RentalExtraKmPolicy"
  ADD COLUMN "flatRatePerKmExact" DECIMAL(19, 4);

ALTER TABLE "RentalExtraKmTier"
  ADD COLUMN "ratePerKmExact" DECIMAL(19, 4);

ALTER TABLE "RentalBookingPricingSnapshot"
  ADD COLUMN "baseRateAmountExact" DECIMAL(19, 4),
  ADD COLUMN "vatRateExact" DECIMAL(9, 4),
  ADD COLUMN "discountPercentExact" DECIMAL(9, 4),
  ADD COLUMN "extraKmEstimatedCostExact" DECIMAL(19, 2),
  ADD COLUMN "extraKmActualCostExact" DECIMAL(19, 2),
  ADD COLUMN "expectedSubtotalExact" DECIMAL(19, 2),
  ADD COLUMN "expectedTaxAmountExact" DECIMAL(19, 2),
  ADD COLUMN "expectedTotalExact" DECIMAL(19, 2),
  ADD COLUMN "finalSubtotalExact" DECIMAL(19, 2),
  ADD COLUMN "finalTaxAmountExact" DECIMAL(19, 2),
  ADD COLUMN "finalTotalExact" DECIMAL(19, 2);

ALTER TABLE "Stoppage"
  ADD COLUMN "estimatedCostPerDayExact" DECIMAL(19, 2);

ALTER TABLE "Invoice"
  ADD COLUMN "subtotalExact" DECIMAL(19, 2),
  ADD COLUMN "taxRateExact" DECIMAL(9, 4),
  ADD COLUMN "taxAmountExact" DECIMAL(19, 2),
  ADD COLUMN "totalExact" DECIMAL(19, 2);

ALTER TABLE "InvoiceItem"
  ADD COLUMN "unitPriceExact" DECIMAL(19, 2),
  ADD COLUMN "subtotalExact" DECIMAL(19, 2),
  ADD COLUMN "taxRateExact" DECIMAL(9, 4),
  ADD COLUMN "taxAmountExact" DECIMAL(19, 2),
  ADD COLUMN "totalExact" DECIMAL(19, 2);

UPDATE "TenantSubscription"
SET "priceMonthlyExact" = CASE
  WHEN "priceMonthly" IS NULL THEN NULL
  ELSE ROUND("priceMonthly"::numeric, 2)
END;

UPDATE "Vehicle"
SET "purchasePriceExact" = CASE
  WHEN "purchasePrice" IS NULL THEN NULL
  ELSE ROUND("purchasePrice"::numeric, 2)
END;

UPDATE "Vehicle"
SET "residualValueExact" = CASE
  WHEN "residualValue" IS NULL THEN NULL
  ELSE ROUND("residualValue"::numeric, 2)
END;

UPDATE "Vehicle"
SET "monthlyFixedCostExact" = CASE
  WHEN "monthlyFixedCost" IS NULL THEN NULL
  ELSE ROUND("monthlyFixedCost"::numeric, 2)
END;

UPDATE "VehicleCost"
SET "amountExact" = CASE
  WHEN "amount" IS NULL THEN NULL
  ELSE ROUND("amount"::numeric, 2)
END;

UPDATE "VehicleMaintenance"
SET "costExact" = CASE
  WHEN "cost" IS NULL THEN NULL
  ELSE ROUND("cost"::numeric, 2)
END;

UPDATE "VehicleMaintenanceAttachment"
SET "invoiceTotalAmountExact" = CASE
  WHEN "invoiceTotalAmount" IS NULL THEN NULL
  ELSE ROUND("invoiceTotalAmount"::numeric, 2)
END;

UPDATE "RentalBooking"
SET "expectedTotalExact" = CASE
  WHEN "expectedTotal" IS NULL THEN NULL
  ELSE ROUND("expectedTotal"::numeric, 2)
END;

UPDATE "RentalBooking"
SET "finalTotalExact" = CASE
  WHEN "finalTotal" IS NULL THEN NULL
  ELSE ROUND("finalTotal"::numeric, 2)
END;

UPDATE "RentalPriceList"
SET "baseRateAmountExact" = CASE
  WHEN "baseRateAmount" IS NULL THEN NULL
  ELSE ROUND("baseRateAmount"::numeric, 4)
END;

UPDATE "RentalPriceList"
SET "vatRateExact" = CASE
  WHEN "vatRate" IS NULL THEN NULL
  ELSE ROUND("vatRate"::numeric, 4)
END;

UPDATE "RentalPriceList"
SET "discountPercentExact" = CASE
  WHEN "discountPercent" IS NULL THEN NULL
  ELSE ROUND("discountPercent"::numeric, 4)
END;

UPDATE "RentalExtraKmPolicy"
SET "flatRatePerKmExact" = CASE
  WHEN "flatRatePerKm" IS NULL THEN NULL
  ELSE ROUND("flatRatePerKm"::numeric, 4)
END;

UPDATE "RentalExtraKmTier"
SET "ratePerKmExact" = CASE
  WHEN "ratePerKm" IS NULL THEN NULL
  ELSE ROUND("ratePerKm"::numeric, 4)
END;

UPDATE "RentalBookingPricingSnapshot"
SET "baseRateAmountExact" = CASE
  WHEN "baseRateAmount" IS NULL THEN NULL
  ELSE ROUND("baseRateAmount"::numeric, 4)
END;

UPDATE "RentalBookingPricingSnapshot"
SET "vatRateExact" = CASE
  WHEN "vatRate" IS NULL THEN NULL
  ELSE ROUND("vatRate"::numeric, 4)
END;

UPDATE "RentalBookingPricingSnapshot"
SET "discountPercentExact" = CASE
  WHEN "discountPercent" IS NULL THEN NULL
  ELSE ROUND("discountPercent"::numeric, 4)
END;

UPDATE "RentalBookingPricingSnapshot"
SET "extraKmEstimatedCostExact" = CASE
  WHEN "extraKmEstimatedCost" IS NULL THEN NULL
  ELSE ROUND("extraKmEstimatedCost"::numeric, 2)
END;

UPDATE "RentalBookingPricingSnapshot"
SET "extraKmActualCostExact" = CASE
  WHEN "extraKmActualCost" IS NULL THEN NULL
  ELSE ROUND("extraKmActualCost"::numeric, 2)
END;

UPDATE "RentalBookingPricingSnapshot"
SET "expectedSubtotalExact" = CASE
  WHEN "expectedSubtotal" IS NULL THEN NULL
  ELSE ROUND("expectedSubtotal"::numeric, 2)
END;

UPDATE "RentalBookingPricingSnapshot"
SET "expectedTaxAmountExact" = CASE
  WHEN "expectedTaxAmount" IS NULL THEN NULL
  ELSE ROUND("expectedTaxAmount"::numeric, 2)
END;

UPDATE "RentalBookingPricingSnapshot"
SET "expectedTotalExact" = CASE
  WHEN "expectedTotal" IS NULL THEN NULL
  ELSE ROUND("expectedTotal"::numeric, 2)
END;

UPDATE "RentalBookingPricingSnapshot"
SET "finalSubtotalExact" = CASE
  WHEN "finalSubtotal" IS NULL THEN NULL
  ELSE ROUND("finalSubtotal"::numeric, 2)
END;

UPDATE "RentalBookingPricingSnapshot"
SET "finalTaxAmountExact" = CASE
  WHEN "finalTaxAmount" IS NULL THEN NULL
  ELSE ROUND("finalTaxAmount"::numeric, 2)
END;

UPDATE "RentalBookingPricingSnapshot"
SET "finalTotalExact" = CASE
  WHEN "finalTotal" IS NULL THEN NULL
  ELSE ROUND("finalTotal"::numeric, 2)
END;

UPDATE "Stoppage"
SET "estimatedCostPerDayExact" = CASE
  WHEN "estimatedCostPerDay" IS NULL THEN NULL
  ELSE ROUND("estimatedCostPerDay"::numeric, 2)
END;

UPDATE "Invoice"
SET "subtotalExact" = CASE
  WHEN "subtotal" IS NULL THEN NULL
  ELSE ROUND("subtotal"::numeric, 2)
END;

UPDATE "Invoice"
SET "taxRateExact" = CASE
  WHEN "taxRate" IS NULL THEN NULL
  ELSE ROUND("taxRate"::numeric, 4)
END;

UPDATE "Invoice"
SET "taxAmountExact" = CASE
  WHEN "taxAmount" IS NULL THEN NULL
  ELSE ROUND("taxAmount"::numeric, 2)
END;

UPDATE "Invoice"
SET "totalExact" = CASE
  WHEN "total" IS NULL THEN NULL
  ELSE ROUND("total"::numeric, 2)
END;

UPDATE "InvoiceItem"
SET "unitPriceExact" = CASE
  WHEN "unitPrice" IS NULL THEN NULL
  ELSE ROUND("unitPrice"::numeric, 2)
END;

UPDATE "InvoiceItem"
SET "subtotalExact" = CASE
  WHEN "subtotal" IS NULL THEN NULL
  ELSE ROUND("subtotal"::numeric, 2)
END;

UPDATE "InvoiceItem"
SET "taxRateExact" = CASE
  WHEN "taxRate" IS NULL THEN NULL
  ELSE ROUND("taxRate"::numeric, 4)
END;

UPDATE "InvoiceItem"
SET "taxAmountExact" = CASE
  WHEN "taxAmount" IS NULL THEN NULL
  ELSE ROUND("taxAmount"::numeric, 2)
END;

UPDATE "InvoiceItem"
SET "totalExact" = CASE
  WHEN "total" IS NULL THEN NULL
  ELSE ROUND("total"::numeric, 2)
END;

CREATE OR REPLACE FUNCTION "fleetum_sync_exact_tenant_subscription"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW."priceMonthlyExact" := CASE
    WHEN NEW."priceMonthly" IS NULL THEN NULL
    ELSE ROUND(NEW."priceMonthly"::numeric, 2)
  END;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS "fleetum_exact_tenant_subscription_trigger" ON "TenantSubscription";
CREATE TRIGGER "fleetum_exact_tenant_subscription_trigger"
BEFORE INSERT OR UPDATE OF "priceMonthly"
ON "TenantSubscription"
FOR EACH ROW
EXECUTE FUNCTION "fleetum_sync_exact_tenant_subscription"();

CREATE OR REPLACE FUNCTION "fleetum_sync_exact_vehicle"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW."purchasePriceExact" := CASE
    WHEN NEW."purchasePrice" IS NULL THEN NULL
    ELSE ROUND(NEW."purchasePrice"::numeric, 2)
  END;
  NEW."residualValueExact" := CASE
    WHEN NEW."residualValue" IS NULL THEN NULL
    ELSE ROUND(NEW."residualValue"::numeric, 2)
  END;
  NEW."monthlyFixedCostExact" := CASE
    WHEN NEW."monthlyFixedCost" IS NULL THEN NULL
    ELSE ROUND(NEW."monthlyFixedCost"::numeric, 2)
  END;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS "fleetum_exact_vehicle_trigger" ON "Vehicle";
CREATE TRIGGER "fleetum_exact_vehicle_trigger"
BEFORE INSERT OR UPDATE OF "purchasePrice", "residualValue", "monthlyFixedCost"
ON "Vehicle"
FOR EACH ROW
EXECUTE FUNCTION "fleetum_sync_exact_vehicle"();

CREATE OR REPLACE FUNCTION "fleetum_sync_exact_vehicle_cost"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW."amountExact" := CASE
    WHEN NEW."amount" IS NULL THEN NULL
    ELSE ROUND(NEW."amount"::numeric, 2)
  END;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS "fleetum_exact_vehicle_cost_trigger" ON "VehicleCost";
CREATE TRIGGER "fleetum_exact_vehicle_cost_trigger"
BEFORE INSERT OR UPDATE OF "amount"
ON "VehicleCost"
FOR EACH ROW
EXECUTE FUNCTION "fleetum_sync_exact_vehicle_cost"();

CREATE OR REPLACE FUNCTION "fleetum_sync_exact_vehicle_maintenance"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW."costExact" := CASE
    WHEN NEW."cost" IS NULL THEN NULL
    ELSE ROUND(NEW."cost"::numeric, 2)
  END;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS "fleetum_exact_vehicle_maintenance_trigger" ON "VehicleMaintenance";
CREATE TRIGGER "fleetum_exact_vehicle_maintenance_trigger"
BEFORE INSERT OR UPDATE OF "cost"
ON "VehicleMaintenance"
FOR EACH ROW
EXECUTE FUNCTION "fleetum_sync_exact_vehicle_maintenance"();

CREATE OR REPLACE FUNCTION "fleetum_sync_exact_vehicle_maintenance_attachment"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW."invoiceTotalAmountExact" := CASE
    WHEN NEW."invoiceTotalAmount" IS NULL THEN NULL
    ELSE ROUND(NEW."invoiceTotalAmount"::numeric, 2)
  END;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS "fleetum_exact_vehicle_maintenance_attachment_trigger" ON "VehicleMaintenanceAttachment";
CREATE TRIGGER "fleetum_exact_vehicle_maintenance_attachment_trigger"
BEFORE INSERT OR UPDATE OF "invoiceTotalAmount"
ON "VehicleMaintenanceAttachment"
FOR EACH ROW
EXECUTE FUNCTION "fleetum_sync_exact_vehicle_maintenance_attachment"();

CREATE OR REPLACE FUNCTION "fleetum_sync_exact_rental_booking"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW."expectedTotalExact" := CASE
    WHEN NEW."expectedTotal" IS NULL THEN NULL
    ELSE ROUND(NEW."expectedTotal"::numeric, 2)
  END;
  NEW."finalTotalExact" := CASE
    WHEN NEW."finalTotal" IS NULL THEN NULL
    ELSE ROUND(NEW."finalTotal"::numeric, 2)
  END;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS "fleetum_exact_rental_booking_trigger" ON "RentalBooking";
CREATE TRIGGER "fleetum_exact_rental_booking_trigger"
BEFORE INSERT OR UPDATE OF "expectedTotal", "finalTotal"
ON "RentalBooking"
FOR EACH ROW
EXECUTE FUNCTION "fleetum_sync_exact_rental_booking"();

CREATE OR REPLACE FUNCTION "fleetum_sync_exact_rental_price_list"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW."baseRateAmountExact" := CASE
    WHEN NEW."baseRateAmount" IS NULL THEN NULL
    ELSE ROUND(NEW."baseRateAmount"::numeric, 4)
  END;
  NEW."vatRateExact" := CASE
    WHEN NEW."vatRate" IS NULL THEN NULL
    ELSE ROUND(NEW."vatRate"::numeric, 4)
  END;
  NEW."discountPercentExact" := CASE
    WHEN NEW."discountPercent" IS NULL THEN NULL
    ELSE ROUND(NEW."discountPercent"::numeric, 4)
  END;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS "fleetum_exact_rental_price_list_trigger" ON "RentalPriceList";
CREATE TRIGGER "fleetum_exact_rental_price_list_trigger"
BEFORE INSERT OR UPDATE OF "baseRateAmount", "vatRate", "discountPercent"
ON "RentalPriceList"
FOR EACH ROW
EXECUTE FUNCTION "fleetum_sync_exact_rental_price_list"();

CREATE OR REPLACE FUNCTION "fleetum_sync_exact_rental_extra_km_policy"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW."flatRatePerKmExact" := CASE
    WHEN NEW."flatRatePerKm" IS NULL THEN NULL
    ELSE ROUND(NEW."flatRatePerKm"::numeric, 4)
  END;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS "fleetum_exact_rental_extra_km_policy_trigger" ON "RentalExtraKmPolicy";
CREATE TRIGGER "fleetum_exact_rental_extra_km_policy_trigger"
BEFORE INSERT OR UPDATE OF "flatRatePerKm"
ON "RentalExtraKmPolicy"
FOR EACH ROW
EXECUTE FUNCTION "fleetum_sync_exact_rental_extra_km_policy"();

CREATE OR REPLACE FUNCTION "fleetum_sync_exact_rental_extra_km_tier"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW."ratePerKmExact" := CASE
    WHEN NEW."ratePerKm" IS NULL THEN NULL
    ELSE ROUND(NEW."ratePerKm"::numeric, 4)
  END;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS "fleetum_exact_rental_extra_km_tier_trigger" ON "RentalExtraKmTier";
CREATE TRIGGER "fleetum_exact_rental_extra_km_tier_trigger"
BEFORE INSERT OR UPDATE OF "ratePerKm"
ON "RentalExtraKmTier"
FOR EACH ROW
EXECUTE FUNCTION "fleetum_sync_exact_rental_extra_km_tier"();

CREATE OR REPLACE FUNCTION "fleetum_sync_exact_rental_booking_pricing_snapshot"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW."baseRateAmountExact" := CASE
    WHEN NEW."baseRateAmount" IS NULL THEN NULL
    ELSE ROUND(NEW."baseRateAmount"::numeric, 4)
  END;
  NEW."vatRateExact" := CASE
    WHEN NEW."vatRate" IS NULL THEN NULL
    ELSE ROUND(NEW."vatRate"::numeric, 4)
  END;
  NEW."discountPercentExact" := CASE
    WHEN NEW."discountPercent" IS NULL THEN NULL
    ELSE ROUND(NEW."discountPercent"::numeric, 4)
  END;
  NEW."extraKmEstimatedCostExact" := CASE
    WHEN NEW."extraKmEstimatedCost" IS NULL THEN NULL
    ELSE ROUND(NEW."extraKmEstimatedCost"::numeric, 2)
  END;
  NEW."extraKmActualCostExact" := CASE
    WHEN NEW."extraKmActualCost" IS NULL THEN NULL
    ELSE ROUND(NEW."extraKmActualCost"::numeric, 2)
  END;
  NEW."expectedSubtotalExact" := CASE
    WHEN NEW."expectedSubtotal" IS NULL THEN NULL
    ELSE ROUND(NEW."expectedSubtotal"::numeric, 2)
  END;
  NEW."expectedTaxAmountExact" := CASE
    WHEN NEW."expectedTaxAmount" IS NULL THEN NULL
    ELSE ROUND(NEW."expectedTaxAmount"::numeric, 2)
  END;
  NEW."expectedTotalExact" := CASE
    WHEN NEW."expectedTotal" IS NULL THEN NULL
    ELSE ROUND(NEW."expectedTotal"::numeric, 2)
  END;
  NEW."finalSubtotalExact" := CASE
    WHEN NEW."finalSubtotal" IS NULL THEN NULL
    ELSE ROUND(NEW."finalSubtotal"::numeric, 2)
  END;
  NEW."finalTaxAmountExact" := CASE
    WHEN NEW."finalTaxAmount" IS NULL THEN NULL
    ELSE ROUND(NEW."finalTaxAmount"::numeric, 2)
  END;
  NEW."finalTotalExact" := CASE
    WHEN NEW."finalTotal" IS NULL THEN NULL
    ELSE ROUND(NEW."finalTotal"::numeric, 2)
  END;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS "fleetum_exact_rental_booking_pricing_snapshot_trigger" ON "RentalBookingPricingSnapshot";
CREATE TRIGGER "fleetum_exact_rental_booking_pricing_snapshot_trigger"
BEFORE INSERT OR UPDATE OF "baseRateAmount", "vatRate", "discountPercent", "extraKmEstimatedCost", "extraKmActualCost", "expectedSubtotal", "expectedTaxAmount", "expectedTotal", "finalSubtotal", "finalTaxAmount", "finalTotal"
ON "RentalBookingPricingSnapshot"
FOR EACH ROW
EXECUTE FUNCTION "fleetum_sync_exact_rental_booking_pricing_snapshot"();

CREATE OR REPLACE FUNCTION "fleetum_sync_exact_stoppage"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW."estimatedCostPerDayExact" := CASE
    WHEN NEW."estimatedCostPerDay" IS NULL THEN NULL
    ELSE ROUND(NEW."estimatedCostPerDay"::numeric, 2)
  END;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS "fleetum_exact_stoppage_trigger" ON "Stoppage";
CREATE TRIGGER "fleetum_exact_stoppage_trigger"
BEFORE INSERT OR UPDATE OF "estimatedCostPerDay"
ON "Stoppage"
FOR EACH ROW
EXECUTE FUNCTION "fleetum_sync_exact_stoppage"();

CREATE OR REPLACE FUNCTION "fleetum_sync_exact_invoice"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW."subtotalExact" := CASE
    WHEN NEW."subtotal" IS NULL THEN NULL
    ELSE ROUND(NEW."subtotal"::numeric, 2)
  END;
  NEW."taxRateExact" := CASE
    WHEN NEW."taxRate" IS NULL THEN NULL
    ELSE ROUND(NEW."taxRate"::numeric, 4)
  END;
  NEW."taxAmountExact" := CASE
    WHEN NEW."taxAmount" IS NULL THEN NULL
    ELSE ROUND(NEW."taxAmount"::numeric, 2)
  END;
  NEW."totalExact" := CASE
    WHEN NEW."total" IS NULL THEN NULL
    ELSE ROUND(NEW."total"::numeric, 2)
  END;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS "fleetum_exact_invoice_trigger" ON "Invoice";
CREATE TRIGGER "fleetum_exact_invoice_trigger"
BEFORE INSERT OR UPDATE OF "subtotal", "taxRate", "taxAmount", "total"
ON "Invoice"
FOR EACH ROW
EXECUTE FUNCTION "fleetum_sync_exact_invoice"();

CREATE OR REPLACE FUNCTION "fleetum_sync_exact_invoice_item"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW."unitPriceExact" := CASE
    WHEN NEW."unitPrice" IS NULL THEN NULL
    ELSE ROUND(NEW."unitPrice"::numeric, 2)
  END;
  NEW."subtotalExact" := CASE
    WHEN NEW."subtotal" IS NULL THEN NULL
    ELSE ROUND(NEW."subtotal"::numeric, 2)
  END;
  NEW."taxRateExact" := CASE
    WHEN NEW."taxRate" IS NULL THEN NULL
    ELSE ROUND(NEW."taxRate"::numeric, 4)
  END;
  NEW."taxAmountExact" := CASE
    WHEN NEW."taxAmount" IS NULL THEN NULL
    ELSE ROUND(NEW."taxAmount"::numeric, 2)
  END;
  NEW."totalExact" := CASE
    WHEN NEW."total" IS NULL THEN NULL
    ELSE ROUND(NEW."total"::numeric, 2)
  END;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS "fleetum_exact_invoice_item_trigger" ON "InvoiceItem";
CREATE TRIGGER "fleetum_exact_invoice_item_trigger"
BEFORE INSERT OR UPDATE OF "unitPrice", "subtotal", "taxRate", "taxAmount", "total"
ON "InvoiceItem"
FOR EACH ROW
EXECUTE FUNCTION "fleetum_sync_exact_invoice_item"();

ALTER TABLE "VehicleCost" ALTER COLUMN "amountExact" SET NOT NULL;

ALTER TABLE "RentalPriceList" ALTER COLUMN "baseRateAmountExact" SET NOT NULL;

ALTER TABLE "RentalPriceList" ALTER COLUMN "vatRateExact" SET NOT NULL;

ALTER TABLE "RentalPriceList" ALTER COLUMN "discountPercentExact" SET NOT NULL;

ALTER TABLE "RentalExtraKmTier" ALTER COLUMN "ratePerKmExact" SET NOT NULL;

ALTER TABLE "Invoice" ALTER COLUMN "subtotalExact" SET NOT NULL;

ALTER TABLE "Invoice" ALTER COLUMN "taxRateExact" SET NOT NULL;

ALTER TABLE "Invoice" ALTER COLUMN "taxAmountExact" SET NOT NULL;

ALTER TABLE "Invoice" ALTER COLUMN "totalExact" SET NOT NULL;

ALTER TABLE "InvoiceItem" ALTER COLUMN "unitPriceExact" SET NOT NULL;

ALTER TABLE "InvoiceItem" ALTER COLUMN "subtotalExact" SET NOT NULL;

ALTER TABLE "InvoiceItem" ALTER COLUMN "taxRateExact" SET NOT NULL;

ALTER TABLE "InvoiceItem" ALTER COLUMN "taxAmountExact" SET NOT NULL;

ALTER TABLE "InvoiceItem" ALTER COLUMN "totalExact" SET NOT NULL;

ALTER TABLE "TenantSubscription"
  ADD CONSTRAINT "fleetum_exact_001" CHECK (("priceMonthly" IS NULL AND "priceMonthlyExact" IS NULL) OR ("priceMonthly" IS NOT NULL AND "priceMonthlyExact" IS NOT NULL AND "priceMonthlyExact" = ROUND("priceMonthly"::numeric, 2))) NOT VALID;
ALTER TABLE "TenantSubscription" VALIDATE CONSTRAINT "fleetum_exact_001";

ALTER TABLE "Vehicle"
  ADD CONSTRAINT "fleetum_exact_002" CHECK (("purchasePrice" IS NULL AND "purchasePriceExact" IS NULL) OR ("purchasePrice" IS NOT NULL AND "purchasePriceExact" IS NOT NULL AND "purchasePriceExact" = ROUND("purchasePrice"::numeric, 2))) NOT VALID;
ALTER TABLE "Vehicle" VALIDATE CONSTRAINT "fleetum_exact_002";

ALTER TABLE "Vehicle"
  ADD CONSTRAINT "fleetum_exact_003" CHECK (("residualValue" IS NULL AND "residualValueExact" IS NULL) OR ("residualValue" IS NOT NULL AND "residualValueExact" IS NOT NULL AND "residualValueExact" = ROUND("residualValue"::numeric, 2))) NOT VALID;
ALTER TABLE "Vehicle" VALIDATE CONSTRAINT "fleetum_exact_003";

ALTER TABLE "Vehicle"
  ADD CONSTRAINT "fleetum_exact_004" CHECK (("monthlyFixedCost" IS NULL AND "monthlyFixedCostExact" IS NULL) OR ("monthlyFixedCost" IS NOT NULL AND "monthlyFixedCostExact" IS NOT NULL AND "monthlyFixedCostExact" = ROUND("monthlyFixedCost"::numeric, 2))) NOT VALID;
ALTER TABLE "Vehicle" VALIDATE CONSTRAINT "fleetum_exact_004";

ALTER TABLE "VehicleCost"
  ADD CONSTRAINT "fleetum_exact_005" CHECK ("amountExact" = ROUND("amount"::numeric, 2)) NOT VALID;
ALTER TABLE "VehicleCost" VALIDATE CONSTRAINT "fleetum_exact_005";

ALTER TABLE "VehicleMaintenance"
  ADD CONSTRAINT "fleetum_exact_006" CHECK (("cost" IS NULL AND "costExact" IS NULL) OR ("cost" IS NOT NULL AND "costExact" IS NOT NULL AND "costExact" = ROUND("cost"::numeric, 2))) NOT VALID;
ALTER TABLE "VehicleMaintenance" VALIDATE CONSTRAINT "fleetum_exact_006";

ALTER TABLE "VehicleMaintenanceAttachment"
  ADD CONSTRAINT "fleetum_exact_007" CHECK (("invoiceTotalAmount" IS NULL AND "invoiceTotalAmountExact" IS NULL) OR ("invoiceTotalAmount" IS NOT NULL AND "invoiceTotalAmountExact" IS NOT NULL AND "invoiceTotalAmountExact" = ROUND("invoiceTotalAmount"::numeric, 2))) NOT VALID;
ALTER TABLE "VehicleMaintenanceAttachment" VALIDATE CONSTRAINT "fleetum_exact_007";

ALTER TABLE "RentalBooking"
  ADD CONSTRAINT "fleetum_exact_008" CHECK (("expectedTotal" IS NULL AND "expectedTotalExact" IS NULL) OR ("expectedTotal" IS NOT NULL AND "expectedTotalExact" IS NOT NULL AND "expectedTotalExact" = ROUND("expectedTotal"::numeric, 2))) NOT VALID;
ALTER TABLE "RentalBooking" VALIDATE CONSTRAINT "fleetum_exact_008";

ALTER TABLE "RentalBooking"
  ADD CONSTRAINT "fleetum_exact_009" CHECK (("finalTotal" IS NULL AND "finalTotalExact" IS NULL) OR ("finalTotal" IS NOT NULL AND "finalTotalExact" IS NOT NULL AND "finalTotalExact" = ROUND("finalTotal"::numeric, 2))) NOT VALID;
ALTER TABLE "RentalBooking" VALIDATE CONSTRAINT "fleetum_exact_009";

ALTER TABLE "RentalPriceList"
  ADD CONSTRAINT "fleetum_exact_010" CHECK ("baseRateAmountExact" = ROUND("baseRateAmount"::numeric, 4)) NOT VALID;
ALTER TABLE "RentalPriceList" VALIDATE CONSTRAINT "fleetum_exact_010";

ALTER TABLE "RentalPriceList"
  ADD CONSTRAINT "fleetum_exact_011" CHECK ("vatRateExact" = ROUND("vatRate"::numeric, 4)) NOT VALID;
ALTER TABLE "RentalPriceList" VALIDATE CONSTRAINT "fleetum_exact_011";

ALTER TABLE "RentalPriceList"
  ADD CONSTRAINT "fleetum_exact_012" CHECK ("discountPercentExact" = ROUND("discountPercent"::numeric, 4)) NOT VALID;
ALTER TABLE "RentalPriceList" VALIDATE CONSTRAINT "fleetum_exact_012";

ALTER TABLE "RentalExtraKmPolicy"
  ADD CONSTRAINT "fleetum_exact_013" CHECK (("flatRatePerKm" IS NULL AND "flatRatePerKmExact" IS NULL) OR ("flatRatePerKm" IS NOT NULL AND "flatRatePerKmExact" IS NOT NULL AND "flatRatePerKmExact" = ROUND("flatRatePerKm"::numeric, 4))) NOT VALID;
ALTER TABLE "RentalExtraKmPolicy" VALIDATE CONSTRAINT "fleetum_exact_013";

ALTER TABLE "RentalExtraKmTier"
  ADD CONSTRAINT "fleetum_exact_014" CHECK ("ratePerKmExact" = ROUND("ratePerKm"::numeric, 4)) NOT VALID;
ALTER TABLE "RentalExtraKmTier" VALIDATE CONSTRAINT "fleetum_exact_014";

ALTER TABLE "RentalBookingPricingSnapshot"
  ADD CONSTRAINT "fleetum_exact_015" CHECK (("baseRateAmount" IS NULL AND "baseRateAmountExact" IS NULL) OR ("baseRateAmount" IS NOT NULL AND "baseRateAmountExact" IS NOT NULL AND "baseRateAmountExact" = ROUND("baseRateAmount"::numeric, 4))) NOT VALID;
ALTER TABLE "RentalBookingPricingSnapshot" VALIDATE CONSTRAINT "fleetum_exact_015";

ALTER TABLE "RentalBookingPricingSnapshot"
  ADD CONSTRAINT "fleetum_exact_016" CHECK (("vatRate" IS NULL AND "vatRateExact" IS NULL) OR ("vatRate" IS NOT NULL AND "vatRateExact" IS NOT NULL AND "vatRateExact" = ROUND("vatRate"::numeric, 4))) NOT VALID;
ALTER TABLE "RentalBookingPricingSnapshot" VALIDATE CONSTRAINT "fleetum_exact_016";

ALTER TABLE "RentalBookingPricingSnapshot"
  ADD CONSTRAINT "fleetum_exact_017" CHECK (("discountPercent" IS NULL AND "discountPercentExact" IS NULL) OR ("discountPercent" IS NOT NULL AND "discountPercentExact" IS NOT NULL AND "discountPercentExact" = ROUND("discountPercent"::numeric, 4))) NOT VALID;
ALTER TABLE "RentalBookingPricingSnapshot" VALIDATE CONSTRAINT "fleetum_exact_017";

ALTER TABLE "RentalBookingPricingSnapshot"
  ADD CONSTRAINT "fleetum_exact_018" CHECK (("extraKmEstimatedCost" IS NULL AND "extraKmEstimatedCostExact" IS NULL) OR ("extraKmEstimatedCost" IS NOT NULL AND "extraKmEstimatedCostExact" IS NOT NULL AND "extraKmEstimatedCostExact" = ROUND("extraKmEstimatedCost"::numeric, 2))) NOT VALID;
ALTER TABLE "RentalBookingPricingSnapshot" VALIDATE CONSTRAINT "fleetum_exact_018";

ALTER TABLE "RentalBookingPricingSnapshot"
  ADD CONSTRAINT "fleetum_exact_019" CHECK (("extraKmActualCost" IS NULL AND "extraKmActualCostExact" IS NULL) OR ("extraKmActualCost" IS NOT NULL AND "extraKmActualCostExact" IS NOT NULL AND "extraKmActualCostExact" = ROUND("extraKmActualCost"::numeric, 2))) NOT VALID;
ALTER TABLE "RentalBookingPricingSnapshot" VALIDATE CONSTRAINT "fleetum_exact_019";

ALTER TABLE "RentalBookingPricingSnapshot"
  ADD CONSTRAINT "fleetum_exact_020" CHECK (("expectedSubtotal" IS NULL AND "expectedSubtotalExact" IS NULL) OR ("expectedSubtotal" IS NOT NULL AND "expectedSubtotalExact" IS NOT NULL AND "expectedSubtotalExact" = ROUND("expectedSubtotal"::numeric, 2))) NOT VALID;
ALTER TABLE "RentalBookingPricingSnapshot" VALIDATE CONSTRAINT "fleetum_exact_020";

ALTER TABLE "RentalBookingPricingSnapshot"
  ADD CONSTRAINT "fleetum_exact_021" CHECK (("expectedTaxAmount" IS NULL AND "expectedTaxAmountExact" IS NULL) OR ("expectedTaxAmount" IS NOT NULL AND "expectedTaxAmountExact" IS NOT NULL AND "expectedTaxAmountExact" = ROUND("expectedTaxAmount"::numeric, 2))) NOT VALID;
ALTER TABLE "RentalBookingPricingSnapshot" VALIDATE CONSTRAINT "fleetum_exact_021";

ALTER TABLE "RentalBookingPricingSnapshot"
  ADD CONSTRAINT "fleetum_exact_022" CHECK (("expectedTotal" IS NULL AND "expectedTotalExact" IS NULL) OR ("expectedTotal" IS NOT NULL AND "expectedTotalExact" IS NOT NULL AND "expectedTotalExact" = ROUND("expectedTotal"::numeric, 2))) NOT VALID;
ALTER TABLE "RentalBookingPricingSnapshot" VALIDATE CONSTRAINT "fleetum_exact_022";

ALTER TABLE "RentalBookingPricingSnapshot"
  ADD CONSTRAINT "fleetum_exact_023" CHECK (("finalSubtotal" IS NULL AND "finalSubtotalExact" IS NULL) OR ("finalSubtotal" IS NOT NULL AND "finalSubtotalExact" IS NOT NULL AND "finalSubtotalExact" = ROUND("finalSubtotal"::numeric, 2))) NOT VALID;
ALTER TABLE "RentalBookingPricingSnapshot" VALIDATE CONSTRAINT "fleetum_exact_023";

ALTER TABLE "RentalBookingPricingSnapshot"
  ADD CONSTRAINT "fleetum_exact_024" CHECK (("finalTaxAmount" IS NULL AND "finalTaxAmountExact" IS NULL) OR ("finalTaxAmount" IS NOT NULL AND "finalTaxAmountExact" IS NOT NULL AND "finalTaxAmountExact" = ROUND("finalTaxAmount"::numeric, 2))) NOT VALID;
ALTER TABLE "RentalBookingPricingSnapshot" VALIDATE CONSTRAINT "fleetum_exact_024";

ALTER TABLE "RentalBookingPricingSnapshot"
  ADD CONSTRAINT "fleetum_exact_025" CHECK (("finalTotal" IS NULL AND "finalTotalExact" IS NULL) OR ("finalTotal" IS NOT NULL AND "finalTotalExact" IS NOT NULL AND "finalTotalExact" = ROUND("finalTotal"::numeric, 2))) NOT VALID;
ALTER TABLE "RentalBookingPricingSnapshot" VALIDATE CONSTRAINT "fleetum_exact_025";

ALTER TABLE "Stoppage"
  ADD CONSTRAINT "fleetum_exact_026" CHECK (("estimatedCostPerDay" IS NULL AND "estimatedCostPerDayExact" IS NULL) OR ("estimatedCostPerDay" IS NOT NULL AND "estimatedCostPerDayExact" IS NOT NULL AND "estimatedCostPerDayExact" = ROUND("estimatedCostPerDay"::numeric, 2))) NOT VALID;
ALTER TABLE "Stoppage" VALIDATE CONSTRAINT "fleetum_exact_026";

ALTER TABLE "Invoice"
  ADD CONSTRAINT "fleetum_exact_027" CHECK ("subtotalExact" = ROUND("subtotal"::numeric, 2)) NOT VALID;
ALTER TABLE "Invoice" VALIDATE CONSTRAINT "fleetum_exact_027";

ALTER TABLE "Invoice"
  ADD CONSTRAINT "fleetum_exact_028" CHECK ("taxRateExact" = ROUND("taxRate"::numeric, 4)) NOT VALID;
ALTER TABLE "Invoice" VALIDATE CONSTRAINT "fleetum_exact_028";

ALTER TABLE "Invoice"
  ADD CONSTRAINT "fleetum_exact_029" CHECK ("taxAmountExact" = ROUND("taxAmount"::numeric, 2)) NOT VALID;
ALTER TABLE "Invoice" VALIDATE CONSTRAINT "fleetum_exact_029";

ALTER TABLE "Invoice"
  ADD CONSTRAINT "fleetum_exact_030" CHECK ("totalExact" = ROUND("total"::numeric, 2)) NOT VALID;
ALTER TABLE "Invoice" VALIDATE CONSTRAINT "fleetum_exact_030";

ALTER TABLE "InvoiceItem"
  ADD CONSTRAINT "fleetum_exact_031" CHECK ("unitPriceExact" = ROUND("unitPrice"::numeric, 2)) NOT VALID;
ALTER TABLE "InvoiceItem" VALIDATE CONSTRAINT "fleetum_exact_031";

ALTER TABLE "InvoiceItem"
  ADD CONSTRAINT "fleetum_exact_032" CHECK ("subtotalExact" = ROUND("subtotal"::numeric, 2)) NOT VALID;
ALTER TABLE "InvoiceItem" VALIDATE CONSTRAINT "fleetum_exact_032";

ALTER TABLE "InvoiceItem"
  ADD CONSTRAINT "fleetum_exact_033" CHECK ("taxRateExact" = ROUND("taxRate"::numeric, 4)) NOT VALID;
ALTER TABLE "InvoiceItem" VALIDATE CONSTRAINT "fleetum_exact_033";

ALTER TABLE "InvoiceItem"
  ADD CONSTRAINT "fleetum_exact_034" CHECK ("taxAmountExact" = ROUND("taxAmount"::numeric, 2)) NOT VALID;
ALTER TABLE "InvoiceItem" VALIDATE CONSTRAINT "fleetum_exact_034";

ALTER TABLE "InvoiceItem"
  ADD CONSTRAINT "fleetum_exact_035" CHECK ("totalExact" = ROUND("total"::numeric, 2)) NOT VALID;
ALTER TABLE "InvoiceItem" VALIDATE CONSTRAINT "fleetum_exact_035";
