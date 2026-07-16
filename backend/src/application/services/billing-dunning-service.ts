import { prisma } from "../../infrastructure/database/prisma/client.js";
import { exactMoneyReader } from "../../infrastructure/database/exact-money-reader.js";
import { logger } from "../../infrastructure/logging/logger.js";
import { AuditLogRepository } from "../../domain/repositories/audit-log-repository.js";
import { env } from "../../shared/config/env.js";
import {
  BillingLifecycleEmailInput,
  BillingLifecycleNotifier,
  BillingLifecycleNotifierLike
} from "./billing-lifecycle-notifier.js";
import { TenantSubscriptionSnapshot, TenantSubscriptionUpsertInput, upsertTenantSubscription } from "./tenant-subscription-service.js";
import { BillingCycle, SaasPlan, ensureKnownPlan, normalizeBillingCycle } from "./feature-entitlements-service.js";

type DunningSubscriptionRow = {
  id: string;
  tenantId: string;
  plan: string;
  seats: number;
  billingCycle: string;
  priceMonthly: number | null;
  currentPeriodEnd: Date | null;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  updatedAt: Date;
};

type BillingDunningDeps = {
  findOverduePastDueSubscriptions(cutoff: Date, take: number): Promise<DunningSubscriptionRow[]>;
  upsertSubscription(input: TenantSubscriptionUpsertInput): Promise<TenantSubscriptionSnapshot>;
};

const defaultDeps: BillingDunningDeps = {
  async findOverduePastDueSubscriptions(cutoff, take) {
    const rows = await prisma.tenantSubscription.findMany({
      where: {
        provider: "stripe",
        status: "PAST_DUE",
        updatedAt: { lte: cutoff }
      },
      orderBy: { updatedAt: "asc" },
      take,
      select: {
        id: true,
        tenantId: true,
        plan: true,
        seats: true,
        billingCycle: true,
        priceMonthly: true,
        currentPeriodEnd: true,
        stripeCustomerId: true,
        stripeSubscriptionId: true,
        updatedAt: true
      }
    });
    return exactMoneyReader.hydrate("TenantSubscription", rows);
  },
  async upsertSubscription(input) {
    return upsertTenantSubscription(input);
  }
};

const toIsoOrNull = (value?: Date | null) => value?.toISOString() ?? null;

const toSnapshot = (row: DunningSubscriptionRow): TenantSubscriptionSnapshot => ({
  plan: ensureKnownPlan(row.plan),
  seats: row.seats,
  status: "PAST_DUE",
  expiresAt: toIsoOrNull(row.currentPeriodEnd),
  updatedAt: row.updatedAt.toISOString(),
  priceMonthly: row.priceMonthly,
  billingCycle: normalizeBillingCycle(row.billingCycle),
  provider: "stripe",
  stripeCustomerId: row.stripeCustomerId,
  stripeSubscriptionId: row.stripeSubscriptionId
});

export class BillingDunningService {
  constructor(
    private readonly auditRepository: AuditLogRepository,
    private readonly notifier: BillingLifecycleNotifierLike = new BillingLifecycleNotifier(),
    private readonly deps: BillingDunningDeps = defaultDeps
  ) {}

  async suspendOverduePastDueSubscriptions(now = new Date()) {
    const graceDays = Math.max(0, env.BILLING_PAST_DUE_GRACE_DAYS);
    const batchSize = Math.max(1, env.BILLING_DUNNING_BATCH_SIZE);
    const cutoff = new Date(now.getTime() - graceDays * 24 * 60 * 60 * 1000);
    const rows = await this.deps.findOverduePastDueSubscriptions(cutoff, batchSize);
    const suspended: string[] = [];

    for (const row of rows) {
      const previous = toSnapshot(row);
      const next = await this.deps.upsertSubscription({
        tenantId: row.tenantId,
        plan: row.plan,
        seats: row.seats,
        status: "SUSPENDED",
        expiresAt: toIsoOrNull(row.currentPeriodEnd),
        priceMonthly: row.priceMonthly,
        billingCycle: row.billingCycle,
        provider: "stripe",
        stripeCustomerId: row.stripeCustomerId,
        stripeSubscriptionId: row.stripeSubscriptionId
      });

      await this.auditRepository.create({
        tenantId: row.tenantId,
        userId: null,
        action: "PLATFORM_LICENSE_UPDATED",
        resource: "tenant",
        resourceId: row.tenantId,
        details: {
          source: "billing_dunning_cron",
          persisted: true,
          graceDays,
          cutoff: cutoff.toISOString(),
          before: previous,
          after: next
        }
      });

      await this.notifySuspended(row.tenantId, previous, next, graceDays);
      suspended.push(row.tenantId);
    }

    return {
      checked: rows.length,
      suspended: suspended.length,
      tenantIds: suspended
    };
  }

  private async notifySuspended(
    tenantId: string,
    previous: TenantSubscriptionSnapshot,
    next: TenantSubscriptionSnapshot,
    graceDays: number
  ) {
    const input: BillingLifecycleEmailInput = {
      tenantId,
      plan: next.plan as SaasPlan,
      billingCycle: next.billingCycle as BillingCycle,
      previousStatus: previous.status,
      nextStatus: next.status,
      expiresAt: next.expiresAt,
      stripeCustomerId: next.stripeCustomerId,
      stripeSubscriptionId: next.stripeSubscriptionId,
      graceDays
    };

    try {
      await this.notifier.notifySubscriptionSuspended(input);
    } catch (error) {
      logger.warn({ error, tenantId, action: "BILLING_SUBSCRIPTION_SUSPENDED" }, "Billing dunning notification failed");
      await this.auditRepository.create({
        tenantId,
        userId: null,
        action: "BILLING_NOTIFICATION_FAILED",
        resource: "billing",
        resourceId: tenantId,
        details: { action: "BILLING_SUBSCRIPTION_SUSPENDED", source: "billing_dunning_cron" }
      }).catch(() => undefined);
    }
  }
}
