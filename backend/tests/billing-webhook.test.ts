import assert from "node:assert/strict";
import test from "node:test";
import Stripe from "stripe";
import { BillingService } from "../src/application/services/billing-service.js";
import { TenantSubscriptionSnapshot, TenantSubscriptionUpsertInput } from "../src/application/services/tenant-subscription-service.js";
import { AuditLogRepository, AuditLogRow } from "../src/domain/repositories/audit-log-repository.js";
import { AppError } from "../src/shared/errors/app-error.js";
import { env } from "../src/shared/config/env.js";

const webhookSecret = "whsec_test_billing_webhook_secret";

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

type StoredBillingEvent = {
  eventId: string;
  tenantId: string | null;
  status: string;
  processedAt: Date | null;
  type: string;
  errorMessage?: string | null;
};

const snapshotFromInput = (input: TenantSubscriptionUpsertInput): TenantSubscriptionSnapshot => ({
  plan: input.plan as TenantSubscriptionSnapshot["plan"],
  seats: input.seats,
  status: input.status as TenantSubscriptionSnapshot["status"],
  expiresAt: input.expiresAt ?? null,
  updatedAt: new Date().toISOString(),
  priceMonthly: input.priceMonthly ?? null,
  billingCycle: (input.billingCycle ?? "monthly") as TenantSubscriptionSnapshot["billingCycle"],
  provider: input.provider ?? "stripe",
  stripeCustomerId: input.stripeCustomerId ?? null,
  stripeSubscriptionId: input.stripeSubscriptionId ?? null
});

const makeHarness = () => {
  (env as Record<string, unknown>).STRIPE_SECRET_KEY = "sk_test_unit_billing";
  (env as Record<string, unknown>).STRIPE_WEBHOOK_SECRET = webhookSecret;

  const stripe = new Stripe("sk_test_unit_billing");
  const audit = new FakeAuditRepo();
  const events = new Map<string, StoredBillingEvent>();
  const subscriptions = new Map<string, TenantSubscriptionSnapshot>();
  const upserts: TenantSubscriptionUpsertInput[] = [];

  const service = new BillingService(audit, stripe, {
    async createBillingEvent(event, tenantId) {
      const existing = events.get(event.id);
      if (existing) return existing;
      const row = { eventId: event.id, tenantId, status: "RECEIVED", processedAt: null, type: event.type };
      events.set(event.id, row);
      return row;
    },
    async updateBillingEvent(eventId, data) {
      const existing = events.get(eventId);
      assert.ok(existing, `event ${eventId} should exist before update`);
      events.set(eventId, {
        ...existing,
        tenantId: data.tenantId ?? existing.tenantId,
        status: data.status,
        processedAt: data.processedAt ?? existing.processedAt,
        errorMessage: data.errorMessage
      });
    },
    async findSubscriptionByTenantId(tenantId) {
      return subscriptions.get(tenantId) ?? null;
    },
    async findSubscriptionByStripeSubscriptionId(subscriptionId) {
      const match = [...subscriptions.entries()].find(([, value]) => value.stripeSubscriptionId === subscriptionId);
      return match ? { tenantId: match[0] } : null;
    },
    async findSubscriptionByStripeCustomerId(customerId) {
      const match = [...subscriptions.entries()].find(([, value]) => value.stripeCustomerId === customerId);
      return match ? { tenantId: match[0] } : null;
    },
    async upsertSubscription(input) {
      upserts.push(input);
      const snapshot = snapshotFromInput(input);
      subscriptions.set(input.tenantId, snapshot);
      return snapshot;
    }
  });

  const sign = (event: Record<string, unknown>) => {
    const payload = JSON.stringify(event);
    const signature = stripe.webhooks.generateTestHeaderString({ payload, secret: webhookSecret });
    return { signature, rawBody: Buffer.from(payload), body: event };
  };

  return { audit, events, service, sign, subscriptions, upserts };
};

const baseEvent = (id: string, type: string, object: Record<string, unknown>) => ({
  id,
  object: "event",
  api_version: "2024-06-20",
  created: 1_700_000_000,
  livemode: false,
  pending_webhooks: 1,
  request: null,
  type,
  data: { object }
});

test("billing webhook verifies Stripe signature and persists checkout.session.completed as license update", async () => {
  const { audit, events, service, sign, subscriptions } = makeHarness();
  const event = baseEvent("evt_checkout_completed", "checkout.session.completed", {
    id: "cs_test_1",
    object: "checkout.session",
    client_reference_id: "tenant-1",
    customer: "cus_1",
    metadata: { tenantId: "tenant-1", plan: "PRO", billingCycle: "yearly" }
  });

  const result = await service.handleWebhook(sign(event));

  assert.deepEqual(result, { received: true, ignored: false });
  assert.equal(events.get("evt_checkout_completed")?.status, "PROCESSED");
  assert.equal(subscriptions.get("tenant-1")?.status, "ACTIVE");
  assert.equal(subscriptions.get("tenant-1")?.plan, "PRO");
  assert.equal(subscriptions.get("tenant-1")?.billingCycle, "yearly");
  assert.equal(audit.rows.at(-1)?.action, "PLATFORM_LICENSE_UPDATED");
});

test("billing webhook is idempotent by Stripe event id", async () => {
  const { audit, events, service, sign, upserts } = makeHarness();
  const signed = sign(baseEvent("evt_duplicate", "customer.subscription.updated", {
    id: "sub_duplicate",
    object: "subscription",
    status: "active",
    customer: "cus_dup",
    current_period_end: 1_800_000_000,
    metadata: { tenantId: "tenant-dup", plan: "STARTER", billingCycle: "monthly" }
  }));

  const first = await service.handleWebhook(signed);
  const second = await service.handleWebhook(signed);

  assert.equal(first.received, true);
  assert.deepEqual(second, { received: true, duplicate: true });
  assert.equal(events.get("evt_duplicate")?.status, "PROCESSED");
  assert.equal(upserts.length, 1);
  assert.equal(audit.rows.length, 1);
});

test("invoice.payment_failed resolves tenant from existing subscription and marks license past due", async () => {
  const { service, sign, subscriptions } = makeHarness();
  subscriptions.set("tenant-past-due", {
    plan: "PRO",
    seats: 5,
    status: "ACTIVE",
    expiresAt: null,
    priceMonthly: 149,
    billingCycle: "monthly",
    provider: "stripe",
    stripeCustomerId: "cus_due",
    stripeSubscriptionId: "sub_due"
  });

  await service.handleWebhook(sign(baseEvent("evt_payment_failed", "invoice.payment_failed", {
    id: "in_failed",
    object: "invoice",
    customer: "cus_due",
    subscription: "sub_due",
    lines: { data: [{ period: { end: 1_800_000_000 } }] }
  })));

  assert.equal(subscriptions.get("tenant-past-due")?.status, "PAST_DUE");
});

test("customer.subscription.deleted marks license canceled", async () => {
  const { service, sign, subscriptions } = makeHarness();
  subscriptions.set("tenant-canceled", {
    plan: "ENTERPRISE",
    seats: 10,
    status: "ACTIVE",
    expiresAt: null,
    priceMonthly: 399,
    billingCycle: "yearly",
    provider: "stripe",
    stripeCustomerId: "cus_cancel",
    stripeSubscriptionId: "sub_cancel"
  });

  await service.handleWebhook(sign(baseEvent("evt_subscription_deleted", "customer.subscription.deleted", {
    id: "sub_cancel",
    object: "subscription",
    status: "canceled",
    customer: "cus_cancel",
    metadata: {}
  })));

  assert.equal(subscriptions.get("tenant-canceled")?.status, "CANCELED");
});

test("billing webhook rejects missing or invalid Stripe signature", async () => {
  const { service, sign } = makeHarness();
  const signed = sign(baseEvent("evt_invalid_signature", "customer.subscription.updated", {
    id: "sub_invalid",
    object: "subscription",
    status: "active",
    metadata: { tenantId: "tenant-invalid" }
  }));

  await assert.rejects(
    () => service.handleWebhook({ rawBody: signed.rawBody, body: {} }),
    (error) => error instanceof AppError && error.statusCode === 400 && error.code === "STRIPE_SIGNATURE_MISSING"
  );

  await assert.rejects(
    () => service.handleWebhook({ signature: "t=1,v1=bad", rawBody: signed.rawBody, body: {} }),
    (error) => error instanceof AppError && error.statusCode === 400 && error.code === "STRIPE_SIGNATURE_INVALID"
  );
});
