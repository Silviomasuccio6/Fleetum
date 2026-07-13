export type ExactNumericField = {
  model: string;
  table: string;
  legacyField: string;
  exactField: string;
  legacyColumn: string;
  exactColumn: string;
  scale: 2 | 4;
  nullable: boolean;
};

export const EXACT_NUMERIC_FIELDS = [
  { model: "TenantSubscription", table: "TenantSubscription", legacyField: "priceMonthly", exactField: "priceMonthlyExact", legacyColumn: "priceMonthly", exactColumn: "priceMonthlyExact", scale: 2, nullable: true },
  { model: "Vehicle", table: "Vehicle", legacyField: "purchasePrice", exactField: "purchasePriceExact", legacyColumn: "purchasePrice", exactColumn: "purchasePriceExact", scale: 2, nullable: true },
  { model: "Vehicle", table: "Vehicle", legacyField: "residualValue", exactField: "residualValueExact", legacyColumn: "residualValue", exactColumn: "residualValueExact", scale: 2, nullable: true },
  { model: "Vehicle", table: "Vehicle", legacyField: "monthlyFixedCost", exactField: "monthlyFixedCostExact", legacyColumn: "monthlyFixedCost", exactColumn: "monthlyFixedCostExact", scale: 2, nullable: true },
  { model: "VehicleCost", table: "VehicleCost", legacyField: "amount", exactField: "amountExact", legacyColumn: "amount", exactColumn: "amountExact", scale: 2, nullable: false },
  { model: "VehicleMaintenance", table: "VehicleMaintenance", legacyField: "cost", exactField: "costExact", legacyColumn: "cost", exactColumn: "costExact", scale: 2, nullable: true },
  { model: "VehicleMaintenanceAttachment", table: "VehicleMaintenanceAttachment", legacyField: "invoiceTotalAmount", exactField: "invoiceTotalAmountExact", legacyColumn: "invoiceTotalAmount", exactColumn: "invoiceTotalAmountExact", scale: 2, nullable: true },
  { model: "RentalBooking", table: "RentalBooking", legacyField: "expectedTotal", exactField: "expectedTotalExact", legacyColumn: "expectedTotal", exactColumn: "expectedTotalExact", scale: 2, nullable: true },
  { model: "RentalBooking", table: "RentalBooking", legacyField: "finalTotal", exactField: "finalTotalExact", legacyColumn: "finalTotal", exactColumn: "finalTotalExact", scale: 2, nullable: true },
  { model: "RentalPriceList", table: "RentalPriceList", legacyField: "baseRateAmount", exactField: "baseRateAmountExact", legacyColumn: "baseRateAmount", exactColumn: "baseRateAmountExact", scale: 4, nullable: false },
  { model: "RentalPriceList", table: "RentalPriceList", legacyField: "vatRate", exactField: "vatRateExact", legacyColumn: "vatRate", exactColumn: "vatRateExact", scale: 4, nullable: false },
  { model: "RentalPriceList", table: "RentalPriceList", legacyField: "discountPercent", exactField: "discountPercentExact", legacyColumn: "discountPercent", exactColumn: "discountPercentExact", scale: 4, nullable: false },
  { model: "RentalExtraKmPolicy", table: "RentalExtraKmPolicy", legacyField: "flatRatePerKm", exactField: "flatRatePerKmExact", legacyColumn: "flatRatePerKm", exactColumn: "flatRatePerKmExact", scale: 4, nullable: true },
  { model: "RentalExtraKmTier", table: "RentalExtraKmTier", legacyField: "ratePerKm", exactField: "ratePerKmExact", legacyColumn: "ratePerKm", exactColumn: "ratePerKmExact", scale: 4, nullable: false },
  { model: "RentalBookingPricingSnapshot", table: "RentalBookingPricingSnapshot", legacyField: "baseRateAmount", exactField: "baseRateAmountExact", legacyColumn: "baseRateAmount", exactColumn: "baseRateAmountExact", scale: 4, nullable: true },
  { model: "RentalBookingPricingSnapshot", table: "RentalBookingPricingSnapshot", legacyField: "vatRate", exactField: "vatRateExact", legacyColumn: "vatRate", exactColumn: "vatRateExact", scale: 4, nullable: true },
  { model: "RentalBookingPricingSnapshot", table: "RentalBookingPricingSnapshot", legacyField: "discountPercent", exactField: "discountPercentExact", legacyColumn: "discountPercent", exactColumn: "discountPercentExact", scale: 4, nullable: true },
  { model: "RentalBookingPricingSnapshot", table: "RentalBookingPricingSnapshot", legacyField: "extraKmEstimatedCost", exactField: "extraKmEstimatedCostExact", legacyColumn: "extraKmEstimatedCost", exactColumn: "extraKmEstimatedCostExact", scale: 2, nullable: true },
  { model: "RentalBookingPricingSnapshot", table: "RentalBookingPricingSnapshot", legacyField: "extraKmActualCost", exactField: "extraKmActualCostExact", legacyColumn: "extraKmActualCost", exactColumn: "extraKmActualCostExact", scale: 2, nullable: true },
  { model: "RentalBookingPricingSnapshot", table: "RentalBookingPricingSnapshot", legacyField: "expectedSubtotal", exactField: "expectedSubtotalExact", legacyColumn: "expectedSubtotal", exactColumn: "expectedSubtotalExact", scale: 2, nullable: true },
  { model: "RentalBookingPricingSnapshot", table: "RentalBookingPricingSnapshot", legacyField: "expectedTaxAmount", exactField: "expectedTaxAmountExact", legacyColumn: "expectedTaxAmount", exactColumn: "expectedTaxAmountExact", scale: 2, nullable: true },
  { model: "RentalBookingPricingSnapshot", table: "RentalBookingPricingSnapshot", legacyField: "expectedTotal", exactField: "expectedTotalExact", legacyColumn: "expectedTotal", exactColumn: "expectedTotalExact", scale: 2, nullable: true },
  { model: "RentalBookingPricingSnapshot", table: "RentalBookingPricingSnapshot", legacyField: "finalSubtotal", exactField: "finalSubtotalExact", legacyColumn: "finalSubtotal", exactColumn: "finalSubtotalExact", scale: 2, nullable: true },
  { model: "RentalBookingPricingSnapshot", table: "RentalBookingPricingSnapshot", legacyField: "finalTaxAmount", exactField: "finalTaxAmountExact", legacyColumn: "finalTaxAmount", exactColumn: "finalTaxAmountExact", scale: 2, nullable: true },
  { model: "RentalBookingPricingSnapshot", table: "RentalBookingPricingSnapshot", legacyField: "finalTotal", exactField: "finalTotalExact", legacyColumn: "finalTotal", exactColumn: "finalTotalExact", scale: 2, nullable: true },
  { model: "Stoppage", table: "Stoppage", legacyField: "estimatedCostPerDay", exactField: "estimatedCostPerDayExact", legacyColumn: "estimatedCostPerDay", exactColumn: "estimatedCostPerDayExact", scale: 2, nullable: true },
  { model: "Invoice", table: "Invoice", legacyField: "subtotal", exactField: "subtotalExact", legacyColumn: "subtotal", exactColumn: "subtotalExact", scale: 2, nullable: false },
  { model: "Invoice", table: "Invoice", legacyField: "taxRate", exactField: "taxRateExact", legacyColumn: "taxRate", exactColumn: "taxRateExact", scale: 4, nullable: false },
  { model: "Invoice", table: "Invoice", legacyField: "taxAmount", exactField: "taxAmountExact", legacyColumn: "taxAmount", exactColumn: "taxAmountExact", scale: 2, nullable: false },
  { model: "Invoice", table: "Invoice", legacyField: "total", exactField: "totalExact", legacyColumn: "total", exactColumn: "totalExact", scale: 2, nullable: false },
  { model: "InvoiceItem", table: "InvoiceItem", legacyField: "unitPrice", exactField: "unitPriceExact", legacyColumn: "unitPrice", exactColumn: "unitPriceExact", scale: 2, nullable: false },
  { model: "InvoiceItem", table: "InvoiceItem", legacyField: "subtotal", exactField: "subtotalExact", legacyColumn: "subtotal", exactColumn: "subtotalExact", scale: 2, nullable: false },
  { model: "InvoiceItem", table: "InvoiceItem", legacyField: "taxRate", exactField: "taxRateExact", legacyColumn: "taxRate", exactColumn: "taxRateExact", scale: 4, nullable: false },
  { model: "InvoiceItem", table: "InvoiceItem", legacyField: "taxAmount", exactField: "taxAmountExact", legacyColumn: "taxAmount", exactColumn: "taxAmountExact", scale: 2, nullable: false },
  { model: "InvoiceItem", table: "InvoiceItem", legacyField: "total", exactField: "totalExact", legacyColumn: "total", exactColumn: "totalExact", scale: 2, nullable: false }
] as const satisfies readonly ExactNumericField[];

export const NON_MONETARY_FLOAT_FIELDS = [
  { model: "RentalBookingPricingSnapshot", field: "daysCharged", reason: "Fractional rental duration" },
  { model: "InvoiceItem", field: "quantity", reason: "Fractional invoice quantity" }
] as const;
