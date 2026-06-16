import { prisma } from "../../infrastructure/database/prisma/client.js";
import { BillingCycle, SaasPlan, ensureKnownPlan, normalizeBillingCycle } from "./feature-entitlements-service.js";

export type TenantSubscriptionStatus = "PENDING" | "ACTIVE" | "SUSPENDED" | "EXPIRED" | "TRIAL" | "PAST_DUE" | "CANCELED";

export type TenantSubscriptionSnapshot = {
  plan: SaasPlan;
  seats: number;
  status: TenantSubscriptionStatus;
  expiresAt: string | null;
  updatedAt?: string;
  priceMonthly: number | null;
  billingCycle: BillingCycle;
  provider: "stripe" | "local";
  stripeCustomerId?: string | null;
  stripeSubscriptionId?: string | null;
};

export type TenantSubscriptionUpsertInput = {
  tenantId: string;
  plan: string;
  seats: number;
  status: string;
  expiresAt?: string | null;
  priceMonthly?: number | null;
  billingCycle?: string | null;
  provider?: "stripe" | "local";
  stripeCustomerId?: string | null;
  stripeSubscriptionId?: string | null;
};

const toValidStatus = (value: unknown): TenantSubscriptionStatus => {
  if (value === "PENDING" || value === "ACTIVE" || value === "SUSPENDED" || value === "EXPIRED" || value === "TRIAL" || value === "PAST_DUE" || value === "CANCELED") {
    return value;
  }
  return "PENDING";
};

const toPositiveSeats = (value: unknown) => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 3;
};

const toPositivePriceOrNull = (value: unknown): number | null => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Number(n.toFixed(2)) : null;
};

const toDateOrNull = (value: string | null | undefined) => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const toIsoOrNull = (value: Date | null | undefined) => value?.toISOString() ?? null;

export const readTenantSubscription = async (tenantId: string): Promise<TenantSubscriptionSnapshot | null> => {
  const row = await prisma.tenantSubscription.findUnique({ where: { tenantId } });
  if (!row) return null;

  return {
    plan: ensureKnownPlan(row.plan),
    seats: toPositiveSeats(row.seats),
    status: toValidStatus(row.status),
    expiresAt: toIsoOrNull(row.currentPeriodEnd ?? row.trialEndsAt),
    updatedAt: row.updatedAt.toISOString(),
    priceMonthly: toPositivePriceOrNull(row.priceMonthly),
    billingCycle: normalizeBillingCycle(row.billingCycle),
    provider: row.provider === "stripe" ? "stripe" : "local",
    stripeCustomerId: row.stripeCustomerId,
    stripeSubscriptionId: row.stripeSubscriptionId
  };
};

export const upsertTenantSubscription = async (input: TenantSubscriptionUpsertInput): Promise<TenantSubscriptionSnapshot> => {
  const plan = ensureKnownPlan(input.plan);
  const billingCycle = normalizeBillingCycle(input.billingCycle);
  const status = toValidStatus(input.status);
  const provider = input.provider === "stripe" ? "stripe" : "local";
  const currentPeriodEnd = toDateOrNull(input.expiresAt);
  const stripeCustomerId = provider === "stripe" ? (input.stripeCustomerId ?? null) : null;
  const stripeSubscriptionId = provider === "stripe" ? (input.stripeSubscriptionId ?? null) : null;

  const row = await prisma.tenantSubscription.upsert({
    where: { tenantId: input.tenantId },
    create: {
      tenantId: input.tenantId,
      provider,
      plan,
      billingCycle,
      status,
      seats: toPositiveSeats(input.seats),
      priceMonthly: toPositivePriceOrNull(input.priceMonthly),
      stripeCustomerId,
      stripeSubscriptionId,
      currentPeriodEnd,
      trialEndsAt: status === "TRIAL" ? currentPeriodEnd : null,
      canceledAt: status === "CANCELED" ? new Date() : null
    },
    update: {
      provider,
      plan,
      billingCycle,
      status,
      seats: toPositiveSeats(input.seats),
      priceMonthly: toPositivePriceOrNull(input.priceMonthly),
      stripeCustomerId,
      stripeSubscriptionId,
      currentPeriodEnd,
      trialEndsAt: status === "TRIAL" ? currentPeriodEnd : null,
      canceledAt: status === "CANCELED" ? new Date() : null
    }
  });

  return {
    plan: ensureKnownPlan(row.plan),
    seats: row.seats,
    status: toValidStatus(row.status),
    expiresAt: toIsoOrNull(row.currentPeriodEnd ?? row.trialEndsAt),
    updatedAt: row.updatedAt.toISOString(),
    priceMonthly: toPositivePriceOrNull(row.priceMonthly),
    billingCycle: normalizeBillingCycle(row.billingCycle),
    provider: row.provider === "stripe" ? "stripe" : "local",
    stripeCustomerId: row.stripeCustomerId,
    stripeSubscriptionId: row.stripeSubscriptionId
  };
};
