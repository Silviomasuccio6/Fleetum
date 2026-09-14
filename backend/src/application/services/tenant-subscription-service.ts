import type { TenantSubscription } from "@prisma/client";
import { prisma } from "../../infrastructure/database/prisma/client.js";
import { exactMoneyReader } from "../../infrastructure/database/exact-money-reader.js";
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

export type StripeTenantSubscriptionGuard = {
  stripeSubscriptionId: string;
  stripeCustomerId?: string | null;
  allowSubscriptionReplacement?: boolean;
  expectedCurrent?: TenantSubscriptionSnapshot | null;
};

export type StripeTenantSubscriptionMutationResult = {
  applied: boolean;
  previous: TenantSubscriptionSnapshot | null;
  subscription: TenantSubscriptionSnapshot | null;
  reason?: "SUBSCRIPTION_REPLACED" | "CUSTOMER_MISMATCH" | "STALE_SNAPSHOT";
};

const toValidStatus = (value: unknown): TenantSubscriptionStatus => {
  if (
    value === "PENDING" ||
    value === "ACTIVE" ||
    value === "SUSPENDED" ||
    value === "EXPIRED" ||
    value === "TRIAL" ||
    value === "PAST_DUE" ||
    value === "CANCELED"
  ) {
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

const snapshotFromRow = (row: TenantSubscription): TenantSubscriptionSnapshot => ({
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
});

const sameSubscriptionSnapshot = (
  actual: TenantSubscriptionSnapshot | null,
  expected: TenantSubscriptionSnapshot | null
) => {
  if (!actual || !expected) return actual === expected;
  return actual.plan === expected.plan
    && actual.seats === expected.seats
    && actual.status === expected.status
    && actual.expiresAt === expected.expiresAt
    && actual.updatedAt === expected.updatedAt
    && actual.priceMonthly === expected.priceMonthly
    && actual.billingCycle === expected.billingCycle
    && actual.provider === expected.provider
    && (actual.stripeCustomerId ?? null) === (expected.stripeCustomerId ?? null)
    && (actual.stripeSubscriptionId ?? null) === (expected.stripeSubscriptionId ?? null);
};

export const readTenantSubscription = async (tenantId: string): Promise<TenantSubscriptionSnapshot | null> => {
  const row = await prisma.tenantSubscription.findUnique({ where: { tenantId } });
  if (!row) return null;
  const exactRow = await exactMoneyReader.hydrateOne(
    "TenantSubscription",
    row,
    { tenantId }
  );

  return snapshotFromRow(exactRow);
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
  const exactRow = await exactMoneyReader.hydrateOne(
    "TenantSubscription",
    row,
    { tenantId: input.tenantId }
  );

  return snapshotFromRow(exactRow);
};

/**
 * Serializes Stripe webhook writes for one tenant and refuses to overwrite a
 * subscription that has already been replaced. The advisory lock also covers
 * the first insert, where SELECT ... FOR UPDATE cannot lock a missing row.
 */
export const upsertStripeTenantSubscriptionIfCurrent = async (
  input: TenantSubscriptionUpsertInput,
  guard: StripeTenantSubscriptionGuard
): Promise<StripeTenantSubscriptionMutationResult> => {
  const plan = ensureKnownPlan(input.plan);
  const billingCycle = normalizeBillingCycle(input.billingCycle);
  const status = toValidStatus(input.status);
  const currentPeriodEnd = toDateOrNull(input.expiresAt);
  const stripeCustomerId = guard.stripeCustomerId ?? input.stripeCustomerId ?? null;
  const stripeSubscriptionId = guard.stripeSubscriptionId;

  return prisma.$transaction(async (tx) => {
    const lockKey = `fleetum:tenant-subscription:${input.tenantId}`;
    await tx.$queryRaw<Array<{ lock: unknown }>>`
      SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))::text AS lock
    `;

    const currentRow = await tx.tenantSubscription.findUnique({ where: { tenantId: input.tenantId } });
    const previous = currentRow ? snapshotFromRow(currentRow) : null;
    const replacementAllowed = guard.allowSubscriptionReplacement === true;

    if (guard.expectedCurrent !== undefined && !sameSubscriptionSnapshot(previous, guard.expectedCurrent)) {
      return { applied: false, previous, subscription: previous, reason: "STALE_SNAPSHOT" };
    }

    if (
      currentRow?.provider === "stripe" &&
      currentRow.stripeSubscriptionId &&
      currentRow.stripeSubscriptionId !== stripeSubscriptionId &&
      !replacementAllowed
    ) {
      return { applied: false, previous, subscription: previous, reason: "SUBSCRIPTION_REPLACED" };
    }

    if (
      currentRow?.provider === "stripe" &&
      currentRow.stripeCustomerId &&
      stripeCustomerId &&
      currentRow.stripeCustomerId !== stripeCustomerId &&
      !replacementAllowed
    ) {
      return { applied: false, previous, subscription: previous, reason: "CUSTOMER_MISMATCH" };
    }

    const row = await tx.tenantSubscription.upsert({
      where: { tenantId: input.tenantId },
      create: {
        tenantId: input.tenantId,
        provider: "stripe",
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
        provider: "stripe",
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

    return { applied: true, previous, subscription: snapshotFromRow(row) };
  });
};
