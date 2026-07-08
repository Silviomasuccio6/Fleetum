import assert from "node:assert/strict";
import test from "node:test";
import { BillingDunningService } from "../src/application/services/billing-dunning-service.js";
import { BillingLifecycleEmailInput, BillingLifecycleNotifierLike } from "../src/application/services/billing-lifecycle-notifier.js";
import { TenantSubscriptionSnapshot, TenantSubscriptionUpsertInput } from "../src/application/services/tenant-subscription-service.js";
import { AuditLogRepository, AuditLogRow } from "../src/domain/repositories/audit-log-repository.js";
import { env } from "../src/shared/config/env.js";

class FakeAuditRepo implements AuditLogRepository {
  public rows: Array<Parameters<AuditLogRepository["create"]>[0]> = [];

  async countByTenant(_tenantId: string): Promise<number> {
    return 0;
  }

  async listByTenant(_tenantId: string, _input: { skip: number; take: number }): Promise<AuditLogRow[]> {
    return [];
  }

  async listLatestByTenant(_tenantId: string, _take: number): Promise<AuditLogRow[]> {
    return [];
  }

  async getLatestByAction(_tenantId: string, _resource: string, _action: string): Promise<AuditLogRow | null> {
    return null;
  }

  async create(input: Parameters<AuditLogRepository["create"]>[0]): Promise<void> {
    this.rows.push(input);
  }
}

const snapshotFromInput = (input: TenantSubscriptionUpsertInput): TenantSubscriptionSnapshot => ({
  plan: input.plan as TenantSubscriptionSnapshot["plan"],
  seats: input.seats,
  status: input.status as TenantSubscriptionSnapshot["status"],
  expiresAt: input.expiresAt ?? null,
  updatedAt: new Date("2026-07-08T10:00:00.000Z").toISOString(),
  priceMonthly: input.priceMonthly ?? null,
  billingCycle: (input.billingCycle ?? "monthly") as TenantSubscriptionSnapshot["billingCycle"],
  provider: input.provider ?? "stripe",
  stripeCustomerId: input.stripeCustomerId ?? null,
  stripeSubscriptionId: input.stripeSubscriptionId ?? null
});

const makeNotifier = () => {
  const notifications: BillingLifecycleEmailInput[] = [];
  const notifier: BillingLifecycleNotifierLike = {
    async notifyPaymentFailed() {},
    async notifySubscriptionSuspended(input) {
      notifications.push(input);
    },
    async notifySubscriptionReactivated() {},
    async notifySubscriptionCanceled() {},
    async notifyCardExpiring() {}
  };

  return { notifications, notifier };
};

test("billing dunning suspends Stripe PAST_DUE subscriptions older than the configured grace window", async () => {
  (env as Record<string, unknown>).BILLING_PAST_DUE_GRACE_DAYS = 7;
  (env as Record<string, unknown>).BILLING_DUNNING_BATCH_SIZE = 100;
  const audit = new FakeAuditRepo();
  const { notifications, notifier } = makeNotifier();
  const upserts: TenantSubscriptionUpsertInput[] = [];
  const now = new Date("2026-07-08T12:00:00.000Z");
  const updatedAt = new Date("2026-06-29T12:00:00.000Z");

  const service = new BillingDunningService(audit, notifier, {
    async findOverduePastDueSubscriptions(cutoff, take) {
      assert.equal(cutoff.toISOString(), "2026-07-01T12:00:00.000Z");
      assert.equal(take, 100);
      return [{
        tenantId: "tenant-overdue",
        plan: "PRO",
        seats: 5,
        billingCycle: "monthly",
        priceMonthly: 199,
        currentPeriodEnd: new Date("2026-07-31T23:59:59.000Z"),
        stripeCustomerId: "cus_overdue",
        stripeSubscriptionId: "sub_overdue",
        updatedAt
      }];
    },
    async upsertSubscription(input) {
      upserts.push(input);
      return snapshotFromInput(input);
    }
  });

  const result = await service.suspendOverduePastDueSubscriptions(now);

  assert.deepEqual(result, { checked: 1, suspended: 1, tenantIds: ["tenant-overdue"] });
  assert.equal(upserts.length, 1);
  assert.equal(upserts[0].status, "SUSPENDED");
  assert.equal(upserts[0].tenantId, "tenant-overdue");
  assert.equal(audit.rows.at(-1)?.action, "PLATFORM_LICENSE_UPDATED");
  assert.equal((audit.rows.at(-1)?.details as { source?: string }).source, "billing_dunning_cron");
  assert.equal(notifications.length, 1);
  assert.equal(notifications[0].previousStatus, "PAST_DUE");
  assert.equal(notifications[0].nextStatus, "SUSPENDED");
});

test("billing dunning leaves recent PAST_DUE subscriptions untouched", async () => {
  (env as Record<string, unknown>).BILLING_PAST_DUE_GRACE_DAYS = 7;
  (env as Record<string, unknown>).BILLING_DUNNING_BATCH_SIZE = 100;
  const audit = new FakeAuditRepo();
  const { notifications, notifier } = makeNotifier();
  const upserts: TenantSubscriptionUpsertInput[] = [];

  const service = new BillingDunningService(audit, notifier, {
    async findOverduePastDueSubscriptions() {
      return [];
    },
    async upsertSubscription(input) {
      upserts.push(input);
      return snapshotFromInput(input);
    }
  });

  const result = await service.suspendOverduePastDueSubscriptions(new Date("2026-07-08T12:00:00.000Z"));

  assert.deepEqual(result, { checked: 0, suspended: 0, tenantIds: [] });
  assert.equal(upserts.length, 0);
  assert.equal(audit.rows.length, 0);
  assert.equal(notifications.length, 0);
});
