import type { Prisma } from "@prisma/client";
import {
  computeRentalQuote,
  restoreRentalPricingTermsSnapshot,
  toSafeNonNegativeInt
} from "./rental-pricing-service.js";

export type RentalPricingOperationalPatch = {
  estimatedKm?: number | null;
  actualKm?: number | null;
  notes?: string;
};

/** Operational edits consume the saved terms and never resolve mutable lists. */
export const buildRentalPricingOperationalUpdate = (input: {
  snapshot: { metadata: unknown; estimatedKm: number | null; actualKm: number | null };
  pickupAt: Date;
  returnAt: Date;
  patch: RentalPricingOperationalPatch;
}) => {
  const { snapshot, patch } = input;
  const changedEstimate = patch.estimatedKm !== undefined;
  const changedActual = patch.actualKm !== undefined;
  const estimatedKm = changedEstimate ? toSafeNonNegativeInt(patch.estimatedKm) : snapshot.estimatedKm;
  const actualKm = changedActual ? toSafeNonNegativeInt(patch.actualKm) : snapshot.actualKm;
  const data: Prisma.RentalBookingPricingSnapshotUpdateInput = {
    ...(changedEstimate ? { estimatedKm } : {}),
    ...(changedActual ? { actualKm } : {}),
    ...(patch.notes !== undefined ? { notes: patch.notes } : {})
  };
  const terms = restoreRentalPricingTermsSnapshot(snapshot.metadata);
  if (!terms) return { data, quote: null, bookingData: {} };

  const quote = computeRentalQuote({ ...terms, pickupAt: input.pickupAt, returnAt: input.returnAt, estimatedKm, actualKm });
  if (changedEstimate || changedActual) Object.assign(data, {
    includedKmTotal: quote.km.includedKmTotal,
    extraKmEstimated: quote.km.extraKmEstimated,
    extraKmActual: quote.km.extraKmActual,
    extraKmEstimatedCost: quote.pricing.extraKmEstimatedCost,
    extraKmActualCost: quote.pricing.extraKmActualCost,
    daysCharged: quote.duration.daysCharged,
    expectedSubtotal: quote.pricing.expectedSubtotal,
    expectedTaxAmount: quote.pricing.expectedTaxAmount,
    expectedTotal: quote.pricing.expectedTotal,
    finalSubtotal: actualKm === null ? null : quote.pricing.finalSubtotal,
    finalTaxAmount: actualKm === null ? null : quote.pricing.finalTaxAmount,
    finalTotal: actualKm === null ? null : quote.pricing.finalTotal
  });

  // The booking's expected amount may be a deliberate override. Only an explicit
  // actual-km edit authorizes synchronizing its operational final amount.
  const bookingData: Prisma.RentalBookingUpdateInput = changedActual
    ? { finalTotal: actualKm === null ? null : quote.pricing.finalTotal }
    : {};
  return { data, quote, bookingData };
};
