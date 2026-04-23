import { RentalBaseRateUnit, RentalExtraKmPolicyType, RentalHourOverflowRule, RentalKmPackageType, RentalKmScope } from "@prisma/client";

type RentalExtraKmTierLike = {
  fromKm: number;
  toKm: number | null;
  ratePerKm: number;
  sortOrder?: number;
};

type RentalExtraKmPolicyLike = {
  id: string;
  name: string;
  type: RentalExtraKmPolicyType;
  flatRatePerKm: number | null;
  tiers?: RentalExtraKmTierLike[];
};

type RentalPricePackageLike = {
  id: string;
  name: string;
  type: RentalKmPackageType;
  kmIncluded: number | null;
  kmScope: RentalKmScope;
};

type RentalPriceListLike = {
  id: string;
  name: string;
  baseRateUnit: RentalBaseRateUnit;
  baseRateAmount: number;
  vatRate: number;
  discountPercent: number;
  hourOverflowRule: RentalHourOverflowRule;
};

export type RentalQuoteInput = {
  priceList: RentalPriceListLike;
  pricePackage?: RentalPricePackageLike | null;
  extraKmPolicy?: RentalExtraKmPolicyLike | null;
  pickupAt: Date;
  returnAt: Date;
  estimatedKm?: number | null;
  actualKm?: number | null;
};

export type RentalQuoteResult = {
  pricingRef: {
    priceListId: string;
    pricePackageId: string | null;
    extraKmPolicyId: string | null;
    priceListName: string;
    pricePackageName: string | null;
    extraKmPolicyName: string | null;
  };
  duration: {
    totalHours: number;
    daysCharged: number;
    unit: RentalBaseRateUnit;
    chargedUnits: number;
    overflowRule: RentalHourOverflowRule;
  };
  km: {
    packageType: RentalKmPackageType | null;
    kmScope: RentalKmScope | null;
    includedKmTotal: number | null;
    estimatedKm: number | null;
    actualKm: number | null;
    extraKmEstimated: number;
    extraKmActual: number;
  };
  pricing: {
    baseRateAmount: number;
    baseCost: number;
    discountPercent: number;
    discountedBaseCost: number;
    vatRate: number;
    extraKmPolicyType: RentalExtraKmPolicyType | null;
    extraKmEstimatedCost: number;
    extraKmActualCost: number;
    expectedSubtotal: number;
    expectedTaxAmount: number;
    expectedTotal: number;
    finalSubtotal: number;
    finalTaxAmount: number;
    finalTotal: number;
    extraKmEffectiveRateEstimated: number | null;
    extraKmEffectiveRateActual: number | null;
  };
};

const round2 = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

const clampNumber = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export const toSafeNonNegativeInt = (value: unknown): number | null => {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.max(0, Math.round(parsed));
};

export const computeChargedDays = (pickupAt: Date, returnAt: Date, overflowRule: RentalHourOverflowRule): { totalHours: number; daysCharged: number } => {
  const diffMs = Math.max(0, returnAt.getTime() - pickupAt.getTime());
  const totalHours = diffMs / (1000 * 60 * 60);

  if (totalHours <= 0) {
    return { totalHours: 0, daysCharged: 1 };
  }

  const fullDays = Math.floor(totalHours / 24);
  const remainderHours = totalHours - fullDays * 24;

  let chargedDays = fullDays > 0 ? fullDays : 1;

  if (fullDays > 0 && remainderHours > 0) {
    if (overflowRule === "FULL_DAY") chargedDays += 1;
    if (overflowRule === "HALF_DAY") chargedDays += 0.5;
  }

  return { totalHours, daysCharged: Math.max(1, chargedDays) };
};

export const toChargeUnits = (daysCharged: number, unit: RentalBaseRateUnit) => {
  if (unit === "WEEKLY") return Math.max(1, Math.ceil(daysCharged / 7));
  if (unit === "MONTHLY") return Math.max(1, Math.ceil(daysCharged / 30));
  return Math.max(1, daysCharged);
};

const computeIncludedKm = (pkg: RentalPricePackageLike | null | undefined, daysCharged: number): number | null => {
  if (!pkg) return 0;
  if (pkg.type === "UNLIMITED") return null;

  const km = Math.max(0, pkg.kmIncluded ?? 0);
  if (pkg.kmScope === "PER_RENTAL") return km;

  return Math.round(km * Math.max(1, Math.ceil(daysCharged)));
};

const computeExtraKmCost = (extraKm: number, policy: RentalExtraKmPolicyLike | null | undefined): { cost: number; effectiveRate: number | null } => {
  if (extraKm <= 0) return { cost: 0, effectiveRate: null };
  if (!policy) return { cost: 0, effectiveRate: null };

  if (policy.type === "FLAT") {
    const rate = Math.max(0, policy.flatRatePerKm ?? 0);
    return { cost: round2(extraKm * rate), effectiveRate: rate };
  }

  const tiers = [...(policy.tiers ?? [])].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.fromKm - b.fromKm);
  if (tiers.length === 0) return { cost: 0, effectiveRate: null };

  let cost = 0;
  for (const tier of tiers) {
    const start = Math.max(1, tier.fromKm);
    const end = tier.toKm == null ? Number.POSITIVE_INFINITY : Math.max(start, tier.toKm);
    if (extraKm < start) continue;

    const applicableTo = Math.min(end, extraKm);
    const chunk = applicableTo - start + 1;
    if (chunk > 0) {
      cost += chunk * Math.max(0, tier.ratePerKm);
    }
  }

  const rounded = round2(cost);
  return { cost: rounded, effectiveRate: extraKm > 0 ? round2(rounded / extraKm) : null };
};

export const computeRentalQuote = (input: RentalQuoteInput): RentalQuoteResult => {
  const { priceList, pricePackage = null, extraKmPolicy = null, pickupAt, returnAt } = input;

  const { totalHours, daysCharged } = computeChargedDays(pickupAt, returnAt, priceList.hourOverflowRule);
  const chargedUnits = toChargeUnits(daysCharged, priceList.baseRateUnit);

  const baseRateAmount = Math.max(0, Number(priceList.baseRateAmount) || 0);
  const baseCost = round2(chargedUnits * baseRateAmount);
  const discountPercent = clampNumber(Number(priceList.discountPercent) || 0, 0, 100);
  const discountedBaseCost = round2(baseCost * (1 - discountPercent / 100));
  const vatRate = clampNumber(Number(priceList.vatRate) || 0, 0, 100);

  const includedKmTotal = computeIncludedKm(pricePackage, daysCharged);
  const estimatedKm = toSafeNonNegativeInt(input.estimatedKm);
  const actualKm = toSafeNonNegativeInt(input.actualKm);

  const extraKmEstimated =
    includedKmTotal === null
      ? 0
      : Math.max(0, (estimatedKm ?? 0) - includedKmTotal);
  const extraKmActual =
    includedKmTotal === null
      ? 0
      : Math.max(0, (actualKm ?? 0) - includedKmTotal);

  const estimatedExtra = computeExtraKmCost(extraKmEstimated, extraKmPolicy);
  const actualExtra = computeExtraKmCost(extraKmActual, extraKmPolicy);

  const expectedSubtotal = round2(discountedBaseCost + estimatedExtra.cost);
  const expectedTaxAmount = round2((expectedSubtotal * vatRate) / 100);
  const expectedTotal = round2(expectedSubtotal + expectedTaxAmount);

  const finalSubtotal = round2(discountedBaseCost + actualExtra.cost);
  const finalTaxAmount = round2((finalSubtotal * vatRate) / 100);
  const finalTotal = round2(finalSubtotal + finalTaxAmount);

  return {
    pricingRef: {
      priceListId: priceList.id,
      pricePackageId: pricePackage?.id ?? null,
      extraKmPolicyId: extraKmPolicy?.id ?? null,
      priceListName: priceList.name,
      pricePackageName: pricePackage?.name ?? null,
      extraKmPolicyName: extraKmPolicy?.name ?? null
    },
    duration: {
      totalHours: round2(totalHours),
      daysCharged: round2(daysCharged),
      unit: priceList.baseRateUnit,
      chargedUnits: round2(chargedUnits),
      overflowRule: priceList.hourOverflowRule
    },
    km: {
      packageType: pricePackage?.type ?? null,
      kmScope: pricePackage?.kmScope ?? null,
      includedKmTotal,
      estimatedKm,
      actualKm,
      extraKmEstimated,
      extraKmActual
    },
    pricing: {
      baseRateAmount,
      baseCost,
      discountPercent,
      discountedBaseCost,
      vatRate,
      extraKmPolicyType: extraKmPolicy?.type ?? null,
      extraKmEstimatedCost: estimatedExtra.cost,
      extraKmActualCost: actualExtra.cost,
      expectedSubtotal,
      expectedTaxAmount,
      expectedTotal,
      finalSubtotal,
      finalTaxAmount,
      finalTotal,
      extraKmEffectiveRateEstimated: estimatedExtra.effectiveRate,
      extraKmEffectiveRateActual: actualExtra.effectiveRate
    }
  };
};
