import assert from "node:assert/strict";
import test from "node:test";
import Stripe from "stripe";
import { BillingService, RentalStripeWebhookHandler } from "../src/application/services/billing-service.js";
import { BillingLifecycleEmailInput, BillingLifecycleNotifierLike } from "../src/application/services/billing-lifecycle-notifier.js";
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

const makeHarness = (stripeClient?: Stripe, rentalStripeWebhookHandler?: RentalStripeWebhookHandler) => {
  (env as Record<string, unknown>).STRIPE_SECRET_KEY = "sk_test_unit_billing";
  (env as Record<string, unknown>).STRIPE_WEBHOOK_SECRET = webhookSecret;

  const stripe = new Stripe("sk_test_unit_billing");
  const audit = new FakeAuditRepo();
  const events = new Map<string, StoredBillingEvent>();
  const websiteEvents: Array<Record<string, unknown>> = [];
  const subscriptions = new Map<string, TenantSubscriptionSnapshot>();
  const authoritativeSubscriptions = new Map<string, Record<string, unknown>>();
  const upserts: TenantSubscriptionUpsertInput[] = [];
  const notifications: Array<{ type: string; input: Record<string, unknown> }> = [];
  const notificationInput = (input: object): Record<string, unknown> => ({ ...input }) as Record<string, unknown>;
  const notifier: BillingLifecycleNotifierLike = {
    async notifyPaymentFailed(input: BillingLifecycleEmailInput) {
      notifications.push({ type: "BILLING_PAYMENT_FAILED", input: notificationInput(input) });
    },
    async notifySubscriptionSuspended(input: BillingLifecycleEmailInput) {
      notifications.push({ type: "BILLING_SUBSCRIPTION_SUSPENDED", input: notificationInput(input) });
    },
    async notifySubscriptionReactivated(input: BillingLifecycleEmailInput) {
      notifications.push({ type: "BILLING_SUBSCRIPTION_REACTIVATED", input: notificationInput(input) });
    },
    async notifySubscriptionCanceled(input: BillingLifecycleEmailInput) {
      notifications.push({ type: "BILLING_SUBSCRIPTION_CANCELED", input: notificationInput(input) });
    },
    async notifyCardExpiring(input) {
      notifications.push({ type: "BILLING_CARD_EXPIRING", input: notificationInput(input) });
    }
  };

  const defaultStripeClient = {
    webhooks: stripe.webhooks,
    subscriptions: {
      retrieve: async (subscriptionId: string) => {
        const subscription = authoritativeSubscriptions.get(subscriptionId);
        assert.ok(subscription, `authoritative Stripe subscription ${subscriptionId} must be registered by the test`);
        return subscription;
      }
    }
  } as unknown as Stripe;

  const service = new BillingService(audit, stripeClient ?? defaultStripeClient, {
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
    async recordWebsiteEvent(data) {
      websiteEvents.push(data as Record<string, unknown>);
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
    },
    async upsertStripeSubscriptionIfCurrent(input, guard) {
      const previous = subscriptions.get(input.tenantId) ?? null;
      if (guard.expectedCurrent !== undefined && previous !== guard.expectedCurrent) {
        return { applied: false, previous, subscription: previous, reason: "STALE_SNAPSHOT" };
      }
      if (
        previous?.provider === "stripe" &&
        previous.stripeSubscriptionId &&
        previous.stripeSubscriptionId !== guard.stripeSubscriptionId &&
        !guard.allowSubscriptionReplacement
      ) {
        return { applied: false, previous, subscription: previous, reason: "SUBSCRIPTION_REPLACED" };
      }
      if (
        previous?.provider === "stripe" &&
        previous.stripeCustomerId &&
        guard.stripeCustomerId &&
        previous.stripeCustomerId !== guard.stripeCustomerId &&
        !guard.allowSubscriptionReplacement
      ) {
        return { applied: false, previous, subscription: previous, reason: "CUSTOMER_MISMATCH" };
      }

      const guardedInput = {
        ...input,
        provider: "stripe" as const,
        stripeCustomerId: guard.stripeCustomerId ?? input.stripeCustomerId ?? null,
        stripeSubscriptionId: guard.stripeSubscriptionId
      };
      upserts.push(guardedInput);
      const snapshot = snapshotFromInput(guardedInput);
      subscriptions.set(input.tenantId, snapshot);
      return { applied: true, previous, subscription: snapshot };
    }
  }, notifier, rentalStripeWebhookHandler);

  const sign = (event: Record<string, unknown>) => {
    const eventType = typeof event.type === "string" ? event.type : "";
    const dataObject = event.data && typeof event.data === "object"
      ? (event.data as { object?: unknown }).object
      : null;
    if (dataObject && typeof dataObject === "object") {
      const source = dataObject as Record<string, unknown>;
      const sourceObject = typeof source.object === "string" ? source.object : null;
      const subscriptionId = typeof source.subscription === "string"
        ? source.subscription
        : sourceObject === "subscription" && typeof source.id === "string"
          ? source.id
          : null;
      if (subscriptionId && !authoritativeSubscriptions.has(subscriptionId)) {
        const customerId = typeof source.customer === "string" ? source.customer : null;
        const existingEntry = [...subscriptions.entries()].find(([, value]) =>
          value.stripeSubscriptionId === subscriptionId || (customerId && value.stripeCustomerId === customerId)
        );
        const existingTenantId = existingEntry?.[0] ?? null;
        const existing = existingEntry?.[1] ?? null;
        const sourceMetadata = source.metadata && typeof source.metadata === "object"
          ? source.metadata as Record<string, unknown>
          : {};
        const status = eventType === "invoice.payment_failed"
          ? "past_due"
          : eventType === "invoice.paid" || eventType === "invoice.payment_succeeded" || eventType === "checkout.session.completed"
            ? "active"
            : String(source.status ?? "active");
        authoritativeSubscriptions.set(subscriptionId, sourceObject === "subscription"
          ? { ...source }
          : {
              id: subscriptionId,
              object: "subscription",
              status,
              customer: customerId,
              current_period_end: existing?.expiresAt
                ? Math.floor(new Date(existing.expiresAt).getTime() / 1000)
                : 1_800_000_000,
              metadata: {
                ...(existingTenantId ? { tenantId: existingTenantId } : {}),
                ...(existing?.plan ? { plan: existing.plan } : {}),
                ...(existing?.billingCycle ? { billingCycle: existing.billingCycle } : {}),
                ...sourceMetadata
              }
            });
      }
    }

    const payload = JSON.stringify(event);
    const signature = stripe.webhooks.generateTestHeaderString({ payload, secret: webhookSecret });
    return { signature, rawBody: Buffer.from(payload), body: event };
  };

  return { audit, authoritativeSubscriptions, events, notifications, service, sign, subscriptions, upserts, websiteEvents };
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

test("checkout sessions always collect a card before starting the Stripe trial", async () => {
  (env as Record<string, unknown>).STRIPE_SECRET_KEY = "sk_test_unit_billing";
  (env as Record<string, unknown>).STRIPE_PRICE_STARTER_MONTHLY = "price_starter_monthly_test";
  (env as Record<string, unknown>).BILLING_TRIAL_DAYS = 14;

  const audit = new FakeAuditRepo();
  const createdSessions: Array<Record<string, unknown>> = [];
  const stripeClient = {
    checkout: {
      sessions: {
        create: async (params: Record<string, unknown>) => {
          createdSessions.push(params);
          return { id: "cs_trial_card_required", url: "https://checkout.stripe.test/session" };
        }
      }
    }
  } as unknown as Stripe;

  const service = new BillingService(audit, stripeClient, {
    async findSubscriptionByTenantId() {
      return null;
    }
  });
  const result = await service.createCheckoutSession({
    tenantId: "tenant-card-required",
    userId: "user-card-required",
    plan: "STARTER",
    billingCycle: "monthly"
  });

  assert.equal(result.mode, "stripe");
  assert.equal(createdSessions.length, 1);
  assert.equal(createdSessions[0].mode, "subscription");
  assert.equal(createdSessions[0].payment_method_collection, "always");
  assert.deepEqual(createdSessions[0].line_items, [{ price: "price_starter_monthly_test", quantity: 1 }]);
  assert.deepEqual(createdSessions[0].subscription_data, {
    trial_period_days: 14,
    trial_settings: { end_behavior: { missing_payment_method: "cancel" } },
    metadata: { tenantId: "tenant-card-required", plan: "STARTER", billingCycle: "monthly" }
  });
  assert.equal(audit.rows.at(-1)?.action, "BILLING_CHECKOUT_CREATED");
});

test("checkout sessions reject duplicate Stripe subscriptions for managed statuses", async () => {
  (env as Record<string, unknown>).STRIPE_SECRET_KEY = "sk_test_unit_billing";
  const managedStatuses: TenantSubscriptionSnapshot["status"][] = ["ACTIVE", "TRIAL", "PAST_DUE", "SUSPENDED"];

  for (const status of managedStatuses) {
    const audit = new FakeAuditRepo();
    let checkoutCreated = false;
    const stripeClient = {
      checkout: {
        sessions: {
          create: async () => {
            checkoutCreated = true;
            return { id: "cs_should_not_exist", url: "https://checkout.stripe.test/duplicate" };
          }
        }
      }
    } as unknown as Stripe;

    const service = new BillingService(audit, stripeClient, {
      async findSubscriptionByTenantId() {
        return {
          plan: "PRO",
          seats: 5,
          status,
          expiresAt: null,
          priceMonthly: 199,
          billingCycle: "monthly",
          provider: "stripe",
          stripeCustomerId: "cus_existing",
          stripeSubscriptionId: "sub_existing"
        };
      }
    });

    await assert.rejects(
      () => service.createCheckoutSession({
        tenantId: `tenant-duplicate-${status}`,
        userId: "user-duplicate",
        plan: "ENTERPRISE",
        billingCycle: "monthly"
      }),
      (error) => error instanceof AppError && error.statusCode === 409 && error.code === "STRIPE_SUBSCRIPTION_ALREADY_ACTIVE"
    );

    assert.equal(checkoutCreated, false);
  }
});

test("payment method update creates a setup Checkout session for the Stripe customer", async () => {
  (env as Record<string, unknown>).STRIPE_SECRET_KEY = "sk_test_unit_billing";
  const audit = new FakeAuditRepo();
  const createdSessions: Array<Record<string, unknown>> = [];
  const stripeClient = {
    checkout: {
      sessions: {
        create: async (params: Record<string, unknown>) => {
          createdSessions.push(params);
          return { id: "cs_update_card", url: "https://checkout.stripe.test/update-card" };
        }
      }
    }
  } as unknown as Stripe;

  const service = new BillingService(audit, stripeClient, {
    async findSubscriptionByTenantId() {
      return {
        plan: "STARTER",
        seats: 3,
        status: "TRIAL",
        expiresAt: null,
        priceMonthly: 149,
        billingCycle: "monthly",
        provider: "stripe",
        stripeCustomerId: "cus_update_card",
        stripeSubscriptionId: "sub_update_card"
      };
    }
  });

  const result = await service.createPaymentMethodUpdateSession({ tenantId: "tenant-card", userId: "user-card" });

  assert.equal(result.mode, "stripe");
  assert.equal(createdSessions.length, 1);
  assert.equal(createdSessions[0].mode, "setup");
  assert.equal(createdSessions[0].customer, "cus_update_card");
  assert.deepEqual(createdSessions[0].payment_method_types, ["card"]);
  assert.deepEqual(createdSessions[0].metadata, {
    tenantId: "tenant-card",
    userId: "user-card",
    action: "update_payment_method"
  });
  assert.equal(audit.rows.at(-1)?.action, "BILLING_PAYMENT_METHOD_SESSION_CREATED");
});

test("customer portal creates a tenant-scoped Stripe session and records an audit event", async () => {
  (env as Record<string, unknown>).STRIPE_SECRET_KEY = "sk_test_unit_billing";
  (env as Record<string, unknown>).STRIPE_PORTAL_RETURN_URL = "https://fleetum.test/upgrade?portal=returned";
  (env as Record<string, unknown>).STRIPE_BILLING_PORTAL_CONFIGURATION_ID = "bpc_test_configuration";
  const audit = new FakeAuditRepo();
  const createdSessions: Array<Record<string, unknown>> = [];
  const stripeClient = {
    billingPortal: {
      sessions: {
        create: async (params: Record<string, unknown>) => {
          createdSessions.push(params);
          return { id: "bps_test_customer_portal", url: "https://billing.stripe.test/session" };
        }
      }
    }
  } as unknown as Stripe;
  const service = new BillingService(audit, stripeClient, {
    async findSubscriptionByTenantId() {
      return {
        plan: "PRO",
        seats: 5,
        status: "ACTIVE",
        expiresAt: null,
        priceMonthly: 199,
        billingCycle: "monthly",
        provider: "stripe",
        stripeCustomerId: "cus_customer_portal",
        stripeSubscriptionId: "sub_customer_portal"
      };
    }
  });

  const result = await service.createCustomerPortalSession({ tenantId: "tenant-portal", userId: "user-portal" });

  assert.equal(result.portalUrl, "https://billing.stripe.test/session");
  assert.deepEqual(createdSessions, [{
    customer: "cus_customer_portal",
    return_url: "https://fleetum.test/upgrade?portal=returned",
    configuration: "bpc_test_configuration"
  }]);
  assert.equal(audit.rows.at(-1)?.action, "BILLING_CUSTOMER_PORTAL_SESSION_CREATED");
  assert.equal(audit.rows.at(-1)?.details?.stripeCustomerId, "cus_customer_portal");
});

test("customer portal session rejects tenants without a Stripe customer", async () => {
  (env as Record<string, unknown>).STRIPE_SECRET_KEY = "sk_test_unit_billing";
  const service = new BillingService(new FakeAuditRepo(), {} as Stripe, {
    async findSubscriptionByTenantId() {
      return null;
    }
  });

  await assert.rejects(
    () => service.createCustomerPortalSession({ tenantId: "tenant-missing-customer", userId: "user-portal" }),
    (error) => error instanceof AppError && error.statusCode === 409 && error.code === "STRIPE_CUSTOMER_MISSING"
  );
});

test("billing webhook verifies Stripe signature and persists checkout.session.completed as license update", async () => {
  const { audit, events, service, sign, subscriptions, websiteEvents } = makeHarness();
  const event = baseEvent("evt_checkout_completed", "checkout.session.completed", {
    id: "cs_test_1",
    object: "checkout.session",
    client_reference_id: "tenant-1",
    customer: "cus_1",
    subscription: "sub_1",
    metadata: {
      tenantId: "tenant-1",
      plan: "PRO",
      billingCycle: "yearly",
      analyticsConsent: "true",
      analyticsVisitorIdHash: "visitor_hash",
      analyticsSessionIdHash: "session_hash",
      analyticsReferrer: "https://fleetum.it",
      utmSource: "google",
      utmCampaign: "demo"
    }
  });

  const result = await service.handleWebhook(sign(event));

  assert.deepEqual(result, { received: true, ignored: false });
  assert.equal(events.get("evt_checkout_completed")?.status, "PROCESSED");
  assert.equal(subscriptions.get("tenant-1")?.status, "ACTIVE");
  assert.equal(subscriptions.get("tenant-1")?.plan, "PRO");
  assert.equal(subscriptions.get("tenant-1")?.billingCycle, "yearly");
  assert.equal(audit.rows.at(-1)?.action, "PLATFORM_LICENSE_UPDATED");
  assert.equal(websiteEvents.length, 1);
  assert.equal(websiteEvents[0]?.eventType, "STRIPE_CHECKOUT_COMPLETED");
  assert.equal(websiteEvents[0]?.visitorId, "visitor_hash");
  assert.equal(websiteEvents[0]?.utmSource, "google");
});

test("a delayed checkout completion cannot replace a newer canceled subscription", async () => {
  const signer = new Stripe("sk_test_unit_billing");
  const authoritative = new Map<string, Record<string, unknown>>([
    ["sub_checkout_old", {
      id: "sub_checkout_old",
      object: "subscription",
      created: 100,
      status: "active",
      customer: "cus_checkout_old",
      current_period_end: 1_900_000_000,
      metadata: { tenantId: "tenant-checkout-order", plan: "PRO", billingCycle: "monthly" }
    }],
    ["sub_checkout_new", {
      id: "sub_checkout_new",
      object: "subscription",
      created: 200,
      status: "canceled",
      customer: "cus_checkout_new",
      current_period_end: 1_900_000_000,
      metadata: { tenantId: "tenant-checkout-order", plan: "PRO", billingCycle: "monthly" }
    }]
  ]);
  const stripeClient = {
    webhooks: signer.webhooks,
    subscriptions: {
      retrieve: async (subscriptionId: string) => {
        const subscription = authoritative.get(subscriptionId);
        assert.ok(subscription);
        return subscription;
      }
    }
  } as unknown as Stripe;
  const { events, notifications, service, sign, subscriptions, upserts } = makeHarness(stripeClient);
  subscriptions.set("tenant-checkout-order", {
    plan: "PRO",
    seats: 5,
    status: "CANCELED",
    expiresAt: new Date(1_900_000_000 * 1000).toISOString(),
    priceMonthly: 199,
    billingCycle: "monthly",
    provider: "stripe",
    stripeCustomerId: "cus_checkout_new",
    stripeSubscriptionId: "sub_checkout_new"
  });

  const result = await service.handleWebhook(sign(baseEvent("evt_checkout_old_delayed", "checkout.session.completed", {
    id: "cs_checkout_old",
    object: "checkout.session",
    client_reference_id: "tenant-checkout-order",
    customer: "cus_checkout_old",
    subscription: "sub_checkout_old",
    metadata: { tenantId: "tenant-checkout-order", plan: "PRO", billingCycle: "monthly" }
  })));

  assert.deepEqual(result, { received: true, ignored: true });
  assert.equal(events.get("evt_checkout_old_delayed")?.status, "IGNORED");
  assert.equal(subscriptions.get("tenant-checkout-order")?.stripeSubscriptionId, "sub_checkout_new");
  assert.equal(subscriptions.get("tenant-checkout-order")?.status, "CANCELED");
  assert.equal(upserts.length, 0);
  assert.equal(notifications.length, 0);
});

test("a newer checkout can replace a terminal Stripe subscription", async () => {
  const signer = new Stripe("sk_test_unit_billing");
  const authoritative = new Map<string, Record<string, unknown>>([
    ["sub_checkout_previous", {
      id: "sub_checkout_previous",
      object: "subscription",
      created: 100,
      status: "canceled",
      customer: "cus_checkout_previous",
      current_period_end: 1_800_000_000,
      metadata: { tenantId: "tenant-checkout-renew", plan: "STARTER", billingCycle: "monthly" }
    }],
    ["sub_checkout_latest", {
      id: "sub_checkout_latest",
      object: "subscription",
      created: 200,
      status: "active",
      customer: "cus_checkout_latest",
      current_period_end: 1_900_000_000,
      metadata: { tenantId: "tenant-checkout-renew", plan: "PRO", billingCycle: "yearly" }
    }]
  ]);
  const stripeClient = {
    webhooks: signer.webhooks,
    subscriptions: {
      retrieve: async (subscriptionId: string) => {
        const subscription = authoritative.get(subscriptionId);
        assert.ok(subscription);
        return subscription;
      }
    }
  } as unknown as Stripe;
  const { notifications, service, sign, subscriptions } = makeHarness(stripeClient);
  subscriptions.set("tenant-checkout-renew", {
    plan: "STARTER",
    seats: 3,
    status: "CANCELED",
    expiresAt: new Date(1_800_000_000 * 1000).toISOString(),
    priceMonthly: 99,
    billingCycle: "monthly",
    provider: "stripe",
    stripeCustomerId: "cus_checkout_previous",
    stripeSubscriptionId: "sub_checkout_previous"
  });

  const result = await service.handleWebhook(sign(baseEvent("evt_checkout_latest", "checkout.session.completed", {
    id: "cs_checkout_latest",
    object: "checkout.session",
    client_reference_id: "tenant-checkout-renew",
    customer: "cus_checkout_latest",
    subscription: "sub_checkout_latest",
    metadata: { tenantId: "tenant-checkout-renew", plan: "PRO", billingCycle: "yearly" }
  })));

  assert.deepEqual(result, { received: true, ignored: false });
  assert.equal(subscriptions.get("tenant-checkout-renew")?.stripeSubscriptionId, "sub_checkout_latest");
  assert.equal(subscriptions.get("tenant-checkout-renew")?.status, "ACTIVE");
  assert.equal(notifications.filter((notification) => notification.type === "BILLING_SUBSCRIPTION_REACTIVATED").length, 1);
});

test("billing webhook records trial activation funnel event from verified Stripe subscription", async () => {
  const signer = new Stripe("sk_test_unit_billing");
  const stripeClient = {
    webhooks: signer.webhooks,
    subscriptions: {
      retrieve: async (subscriptionId: string) => ({
        id: subscriptionId,
        object: "subscription",
        status: "trialing",
        customer: "cus_trial",
        current_period_end: 1_800_000_000,
        metadata: { tenantId: "tenant-trial", plan: "STARTER", billingCycle: "monthly" }
      })
    }
  } as unknown as Stripe;
  const { service, sign, subscriptions, websiteEvents } = makeHarness(stripeClient);

  const result = await service.handleWebhook(sign(baseEvent("evt_trial_completed", "checkout.session.completed", {
    id: "cs_trial",
    object: "checkout.session",
    client_reference_id: "tenant-trial",
    customer: "cus_trial",
    subscription: "sub_trial",
    metadata: {
      tenantId: "tenant-trial",
      plan: "STARTER",
      billingCycle: "monthly",
      analyticsConsent: "true",
      analyticsVisitorIdHash: "visitor_hash_trial",
      analyticsSessionIdHash: "session_hash_trial",
      utmSource: "linkedin"
    }
  })));

  assert.deepEqual(result, { received: true, ignored: false });
  assert.equal(subscriptions.get("tenant-trial")?.status, "TRIAL");
  assert.deepEqual(websiteEvents.map((event) => event.eventType), ["STRIPE_CHECKOUT_COMPLETED", "TRIAL_ACTIVATED"]);
  assert.equal(websiteEvents[1]?.visitorId, "visitor_hash_trial");
  assert.equal(websiteEvents[1]?.utmSource, "linkedin");
});

test("setup checkout completion stores the new card as default payment method", async () => {
  const signer = new Stripe("sk_test_unit_billing");
  const customerUpdates: Array<{ customerId: string; params: Record<string, unknown> }> = [];
  const subscriptionUpdates: Array<{ subscriptionId: string; params: Record<string, unknown> }> = [];
  const stripeClient = {
    webhooks: signer.webhooks,
    setupIntents: {
      retrieve: async (setupIntentId: string) => ({ id: setupIntentId, payment_method: "pm_new_default" })
    },
    customers: {
      update: async (customerId: string, params: Record<string, unknown>) => {
        customerUpdates.push({ customerId, params });
        return { id: customerId };
      }
    },
    subscriptions: {
      update: async (subscriptionId: string, params: Record<string, unknown>) => {
        subscriptionUpdates.push({ subscriptionId, params });
        return { id: subscriptionId };
      }
    }
  } as unknown as Stripe;
  const { audit, service, sign, subscriptions } = makeHarness(stripeClient);
  subscriptions.set("tenant-card", {
    plan: "STARTER",
    seats: 3,
    status: "TRIAL",
    expiresAt: null,
    priceMonthly: 149,
    billingCycle: "monthly",
    provider: "stripe",
    stripeCustomerId: "cus_card",
    stripeSubscriptionId: "sub_card"
  });

  const result = await service.handleWebhook(sign(baseEvent("evt_setup_checkout_completed", "checkout.session.completed", {
    id: "cs_setup_card",
    object: "checkout.session",
    mode: "setup",
    client_reference_id: "tenant-card",
    customer: "cus_card",
    setup_intent: "seti_card",
    metadata: { tenantId: "tenant-card", userId: "user-card", action: "update_payment_method" }
  })));

  assert.deepEqual(result, { received: true, ignored: false });
  assert.deepEqual(customerUpdates, [{
    customerId: "cus_card",
    params: { invoice_settings: { default_payment_method: "pm_new_default" } }
  }]);
  assert.deepEqual(subscriptionUpdates, [{ subscriptionId: "sub_card", params: { default_payment_method: "pm_new_default" } }]);
  assert.equal(audit.rows.at(-1)?.action, "BILLING_PAYMENT_METHOD_UPDATED");
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

test("subscription update resolves plan and billing cycle from the Stripe Price ID selected in Customer Portal", async () => {
  (env as Record<string, unknown>).STRIPE_PRICE_PRO_YEARLY = "price_portal_pro_yearly";
  const { service, sign, subscriptions } = makeHarness();
  subscriptions.set("tenant-portal-price", {
    plan: "STARTER",
    seats: 3,
    status: "ACTIVE",
    expiresAt: null,
    priceMonthly: 149,
    billingCycle: "monthly",
    provider: "stripe",
    stripeCustomerId: "cus_portal_price",
    stripeSubscriptionId: "sub_portal_price"
  });

  const result = await service.handleWebhook(sign(baseEvent("evt_portal_price_change", "customer.subscription.updated", {
    id: "sub_portal_price",
    object: "subscription",
    status: "active",
    customer: "cus_portal_price",
    current_period_end: 1_800_000_000,
    // Metadata can be historical after a Portal change; Price ID is the source of truth.
    metadata: { tenantId: "tenant-portal-price", plan: "STARTER", billingCycle: "monthly" },
    items: { data: [{ price: { id: "price_portal_pro_yearly" } }] }
  })));

  assert.deepEqual(result, { received: true, ignored: false });
  assert.equal(subscriptions.get("tenant-portal-price")?.plan, "PRO");
  assert.equal(subscriptions.get("tenant-portal-price")?.billingCycle, "yearly");
  assert.equal(subscriptions.get("tenant-portal-price")?.priceMonthly, 199);
});

test("invoice.payment_failed resolves tenant from existing subscription and marks license past due", async () => {
  const { notifications, service, sign, subscriptions } = makeHarness();
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
  assert.equal(notifications.at(-1)?.type, "BILLING_PAYMENT_FAILED");
  assert.equal(notifications.at(-1)?.input.tenantId, "tenant-past-due");
  assert.equal(notifications.at(-1)?.input.nextStatus, "PAST_DUE");
});

test("customer.subscription.created with trialing status activates Stripe trial", async () => {
  const { service, sign, subscriptions } = makeHarness();

  await service.handleWebhook(sign(baseEvent("evt_subscription_trialing", "customer.subscription.created", {
    id: "sub_trial",
    object: "subscription",
    status: "trialing",
    customer: "cus_trial",
    current_period_end: 1_800_000_000,
    metadata: { tenantId: "tenant-trial", plan: "STARTER", billingCycle: "monthly" }
  })));

  assert.equal(subscriptions.get("tenant-trial")?.status, "TRIAL");
  assert.equal(subscriptions.get("tenant-trial")?.provider, "stripe");
});

test("invoice.paid reactivates tenant after successful payment", async () => {
  const { notifications, service, sign, subscriptions } = makeHarness();
  subscriptions.set("tenant-recovered", {
    plan: "PRO",
    seats: 5,
    status: "PAST_DUE",
    expiresAt: null,
    priceMonthly: 149,
    billingCycle: "monthly",
    provider: "stripe",
    stripeCustomerId: "cus_recovered",
    stripeSubscriptionId: "sub_recovered"
  });

  await service.handleWebhook(sign(baseEvent("evt_invoice_paid", "invoice.paid", {
    id: "in_paid",
    object: "invoice",
    customer: "cus_recovered",
    subscription: "sub_recovered",
    lines: { data: [{ period: { end: 1_800_000_000 } }] }
  })));

  assert.equal(subscriptions.get("tenant-recovered")?.status, "ACTIVE");
  assert.equal(notifications.at(-1)?.type, "BILLING_SUBSCRIPTION_REACTIVATED");
  assert.equal(notifications.at(-1)?.input.previousStatus, "PAST_DUE");
});

test("customer.subscription.deleted marks license canceled", async () => {
  const { notifications, service, sign, subscriptions } = makeHarness();
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
  assert.equal(notifications.at(-1)?.type, "BILLING_SUBSCRIPTION_CANCELED");
});

test("customer.subscription.updated with unpaid status suspends the tenant after dunning", async () => {
  const { notifications, service, sign, subscriptions } = makeHarness();
  subscriptions.set("tenant-suspended", {
    plan: "PRO",
    seats: 4,
    status: "PAST_DUE",
    expiresAt: null,
    priceMonthly: 199,
    billingCycle: "monthly",
    provider: "stripe",
    stripeCustomerId: "cus_suspended",
    stripeSubscriptionId: "sub_suspended"
  });

  await service.handleWebhook(sign(baseEvent("evt_subscription_unpaid", "customer.subscription.updated", {
    id: "sub_suspended",
    object: "subscription",
    status: "unpaid",
    customer: "cus_suspended",
    current_period_end: 1_800_000_000,
    metadata: {}
  })));

  assert.equal(subscriptions.get("tenant-suspended")?.status, "SUSPENDED");
  assert.equal(notifications.at(-1)?.type, "BILLING_SUBSCRIPTION_SUSPENDED");
  assert.equal(notifications.at(-1)?.input.previousStatus, "PAST_DUE");
});

test("an out-of-order paid invoice uses the authoritative Stripe subscription state", async () => {
  const signer = new Stripe("sk_test_unit_billing");
  let retrieveCalls = 0;
  const stripeClient = {
    webhooks: signer.webhooks,
    subscriptions: {
      retrieve: async (subscriptionId: string) => {
        retrieveCalls += 1;
        return {
          id: subscriptionId,
          object: "subscription",
          status: "past_due",
          customer: "cus_out_of_order",
          current_period_end: 1_800_000_000,
          metadata: { tenantId: "tenant-out-of-order", plan: "PRO", billingCycle: "monthly" }
        };
      }
    }
  } as unknown as Stripe;
  const { notifications, service, sign, subscriptions } = makeHarness(stripeClient);
  subscriptions.set("tenant-out-of-order", {
    plan: "PRO",
    seats: 5,
    status: "PAST_DUE",
    expiresAt: new Date(1_800_000_000 * 1000).toISOString(),
    priceMonthly: 199,
    billingCycle: "monthly",
    provider: "stripe",
    stripeCustomerId: "cus_out_of_order",
    stripeSubscriptionId: "sub_out_of_order"
  });

  await service.handleWebhook(sign(baseEvent("evt_old_paid_invoice", "invoice.paid", {
    id: "in_old_paid",
    object: "invoice",
    customer: "cus_out_of_order",
    subscription: "sub_out_of_order"
  })));

  assert.equal(retrieveCalls, 1, "the event payload must not be treated as the current subscription state");
  assert.equal(subscriptions.get("tenant-out-of-order")?.status, "PAST_DUE");
  assert.equal(notifications.some((notification) => notification.type === "BILLING_SUBSCRIPTION_REACTIVATED"), false);
});

test("a webhook for a replaced Stripe subscription cannot mutate the tenant license", async () => {
  const signer = new Stripe("sk_test_unit_billing");
  const stripeClient = {
    webhooks: signer.webhooks,
    subscriptions: {
      retrieve: async (subscriptionId: string) => ({
        id: subscriptionId,
        object: "subscription",
        status: "canceled",
        customer: "cus_replaced",
        current_period_end: 1_700_000_000,
        metadata: { tenantId: "tenant-replaced", plan: "STARTER", billingCycle: "monthly" }
      })
    }
  } as unknown as Stripe;
  const { events, notifications, service, sign, subscriptions, upserts } = makeHarness(stripeClient);
  subscriptions.set("tenant-replaced", {
    plan: "PRO",
    seats: 5,
    status: "ACTIVE",
    expiresAt: new Date(1_900_000_000 * 1000).toISOString(),
    priceMonthly: 199,
    billingCycle: "monthly",
    provider: "stripe",
    stripeCustomerId: "cus_replaced",
    stripeSubscriptionId: "sub_current"
  });

  const result = await service.handleWebhook(sign(baseEvent("evt_replaced_subscription_deleted", "customer.subscription.deleted", {
    id: "sub_previous",
    object: "subscription",
    status: "canceled",
    customer: "cus_replaced",
    metadata: { tenantId: "tenant-replaced" }
  })));

  assert.deepEqual(result, { received: true, ignored: true });
  assert.equal(events.get("evt_replaced_subscription_deleted")?.status, "IGNORED");
  assert.equal(subscriptions.get("tenant-replaced")?.stripeSubscriptionId, "sub_current");
  assert.equal(subscriptions.get("tenant-replaced")?.status, "ACTIVE");
  assert.equal(upserts.length, 0);
  assert.equal(notifications.length, 0);
});

test("concurrent billing webhooks converge on the authoritative Stripe state", async () => {
  const signer = new Stripe("sk_test_unit_billing");
  let releaseFirstRetrieve: (() => void) | undefined;
  const firstRetrieveBlocked = new Promise<void>((resolve) => {
    releaseFirstRetrieve = resolve;
  });
  let retrieveCalls = 0;
  const stripeClient = {
    webhooks: signer.webhooks,
    subscriptions: {
      retrieve: async (subscriptionId: string) => {
        retrieveCalls += 1;
        if (retrieveCalls === 1) await firstRetrieveBlocked;
        return {
          id: subscriptionId,
          object: "subscription",
          status: "active",
          customer: "cus_concurrent",
          current_period_end: 1_900_000_000,
          metadata: { tenantId: "tenant-concurrent", plan: "PRO", billingCycle: "monthly" }
        };
      }
    }
  } as unknown as Stripe;
  const { notifications, service, sign, subscriptions, upserts } = makeHarness(stripeClient);
  subscriptions.set("tenant-concurrent", {
    plan: "PRO",
    seats: 5,
    status: "PAST_DUE",
    expiresAt: new Date(1_800_000_000 * 1000).toISOString(),
    priceMonthly: 199,
    billingCycle: "monthly",
    provider: "stripe",
    stripeCustomerId: "cus_concurrent",
    stripeSubscriptionId: "sub_concurrent"
  });

  const staleFailure = service.handleWebhook(sign(baseEvent("evt_concurrent_failure", "invoice.payment_failed", {
    id: "in_concurrent_failure",
    object: "invoice",
    customer: "cus_concurrent",
    subscription: "sub_concurrent"
  })));
  const currentSuccess = service.handleWebhook(sign(baseEvent("evt_concurrent_success", "invoice.paid", {
    id: "in_concurrent_success",
    object: "invoice",
    customer: "cus_concurrent",
    subscription: "sub_concurrent"
  })));
  releaseFirstRetrieve?.();

  await Promise.all([staleFailure, currentSuccess]);

  assert.equal(retrieveCalls, 3);
  assert.equal(subscriptions.get("tenant-concurrent")?.status, "ACTIVE");
  assert.equal(upserts.every((input) => input.status === "ACTIVE"), true);
  assert.equal(notifications.filter((notification) => notification.type === "BILLING_SUBSCRIPTION_REACTIVATED").length, 1);
  assert.equal(notifications.some((notification) => notification.type === "BILLING_PAYMENT_FAILED"), false);
});

test("a delayed stale Stripe response cannot overwrite a newer authoritative response", async () => {
  const signer = new Stripe("sk_test_unit_billing");
  let markStaleRetrieveReady: (() => void) | undefined;
  const staleRetrieveReady = new Promise<void>((resolve) => {
    markStaleRetrieveReady = resolve;
  });
  let releaseStaleRetrieve: (() => void) | undefined;
  const staleRetrieveBlocked = new Promise<void>((resolve) => {
    releaseStaleRetrieve = resolve;
  });
  let retrieveCalls = 0;
  const stripeClient = {
    webhooks: signer.webhooks,
    subscriptions: {
      retrieve: async (subscriptionId: string) => {
        retrieveCalls += 1;
        const selectedStatus = retrieveCalls === 1 ? "active" : "past_due";
        if (retrieveCalls === 1) {
          markStaleRetrieveReady?.();
          await staleRetrieveBlocked;
        }
        return {
          id: subscriptionId,
          object: "subscription",
          status: selectedStatus,
          customer: "cus_stale_response",
          current_period_end: selectedStatus === "active" ? 1_850_000_000 : 1_900_000_000,
          metadata: { tenantId: "tenant-stale-response", plan: "PRO", billingCycle: "monthly" }
        };
      }
    }
  } as unknown as Stripe;
  const { notifications, service, sign, subscriptions, upserts } = makeHarness(stripeClient);
  subscriptions.set("tenant-stale-response", {
    plan: "PRO",
    seats: 5,
    status: "ACTIVE",
    expiresAt: new Date(1_800_000_000 * 1000).toISOString(),
    priceMonthly: 199,
    billingCycle: "monthly",
    provider: "stripe",
    stripeCustomerId: "cus_stale_response",
    stripeSubscriptionId: "sub_stale_response"
  });

  const delayedOldSuccess = service.handleWebhook(sign(baseEvent("evt_delayed_old_success", "invoice.paid", {
    id: "in_delayed_old_success",
    object: "invoice",
    customer: "cus_stale_response",
    subscription: "sub_stale_response"
  })));
  await staleRetrieveReady;

  const currentFailure = service.handleWebhook(sign(baseEvent("evt_current_failure", "invoice.payment_failed", {
    id: "in_current_failure",
    object: "invoice",
    customer: "cus_stale_response",
    subscription: "sub_stale_response"
  })));
  await currentFailure;
  releaseStaleRetrieve?.();
  await delayedOldSuccess;

  assert.equal(retrieveCalls, 3, "the rejected stale write must re-read Stripe before retrying");
  assert.equal(subscriptions.get("tenant-stale-response")?.status, "PAST_DUE");
  assert.equal(upserts.every((input) => input.status === "PAST_DUE"), true);
  assert.equal(notifications.filter((notification) => notification.type === "BILLING_PAYMENT_FAILED").length, 1);
  assert.equal(notifications.some((notification) => notification.type === "BILLING_SUBSCRIPTION_REACTIVATED"), false);
});

test("customer.source.expiring notifies tenant to replace expiring card", async () => {
  const { notifications, service, sign, subscriptions } = makeHarness();
  subscriptions.set("tenant-card-expiring", {
    plan: "STARTER",
    seats: 3,
    status: "ACTIVE",
    expiresAt: null,
    priceMonthly: 149,
    billingCycle: "monthly",
    provider: "stripe",
    stripeCustomerId: "cus_expiring",
    stripeSubscriptionId: "sub_expiring"
  });

  await service.handleWebhook(sign(baseEvent("evt_card_expiring", "customer.source.expiring", {
    id: "card_expiring",
    object: "card",
    customer: "cus_expiring",
    exp_month: 8,
    exp_year: 2026
  })));

  assert.equal(notifications.at(-1)?.type, "BILLING_CARD_EXPIRING");
  assert.equal(notifications.at(-1)?.input.tenantId, "tenant-card-expiring");
  assert.equal(notifications.at(-1)?.input.expMonth, 8);
  assert.equal(notifications.at(-1)?.input.expYear, 2026);
});

test("rental payment checkout setup webhook is delegated and does not update SaaS billing card", async () => {
  let delegated = false;
  const rentalHandler: RentalStripeWebhookHandler = {
    async handleStripeEvent(event) {
      delegated = true;
      assert.equal(event.type, "checkout.session.completed");
      return { tenantId: "tenant-rental", received: true };
    }
  };
  const { audit, service, sign, upserts } = makeHarness(undefined, rentalHandler);

  await service.handleWebhook(sign(baseEvent("evt_rental_setup_completed", "checkout.session.completed", {
    id: "cs_rental_setup",
    object: "checkout.session",
    mode: "setup",
    customer: "cus_rental_customer",
    setup_intent: "seti_rental",
    client_reference_id: "booking-rental",
    metadata: {
      domain: "rental_payments",
      purpose: "rental_guarantee_card",
      tenantId: "tenant-rental",
      bookingId: "booking-rental",
      rentalCustomerId: "customer-rental"
    }
  })));

  assert.equal(delegated, true);
  assert.equal(upserts.length, 0, "rental setup must not mutate TenantSubscription");
  assert.equal(audit.rows.some((row) => row.action === "BILLING_PAYMENT_METHOD_UPDATED"), false);
});

const rentalChargeDispatchCases = [
  { type: "charge.refunded", object: "charge", id: "ch_rental_refund_dispatch" },
  { type: "charge.dispute.created", object: "dispute", id: "dp_rental_created_dispatch" },
  { type: "charge.dispute.closed", object: "dispute", id: "dp_rental_closed_dispatch" }
] as const;

for (const dispatchCase of rentalChargeDispatchCases) {
  test(`rental refund/dispute webhook dispatch delegates ${dispatchCase.type} without metadata`, async () => {
    const eventId = `evt_rental_dispatch_${dispatchCase.type.replaceAll(".", "_")}`;
    const delegated: Stripe.Event[] = [];
    const rentalHandler: RentalStripeWebhookHandler = {
      async handleStripeEvent(event) {
        delegated.push(event);
        assert.equal(event.id, eventId);
        assert.equal(event.type, dispatchCase.type);
        assert.deepEqual((event.data.object as { metadata?: unknown }).metadata, {});
        return { tenantId: "tenant-rental-dispatch", received: true };
      }
    };
    const { audit, events, notifications, service, sign, subscriptions, upserts, websiteEvents } = makeHarness(undefined, rentalHandler);
    const existingLicense = snapshotFromInput({
      tenantId: "tenant-saas-dispatch", plan: "PRO", seats: 5, status: "ACTIVE",
      provider: "stripe", stripeCustomerId: "cus_dispatch_shared", stripeSubscriptionId: "sub_dispatch_existing"
    });
    subscriptions.set("tenant-saas-dispatch", existingLicense);
    const licensesBefore = structuredClone([...subscriptions.entries()]);
    const event = baseEvent(eventId, dispatchCase.type, {
      id: dispatchCase.id,
      object: dispatchCase.object,
      metadata: {},
      payment_intent: "pi_rental_dispatch",
      ...(dispatchCase.object === "charge"
        ? { customer: "cus_dispatch_shared", amount: 1200, amount_refunded: 1200, refunded: true }
        : { charge: "ch_rental_dispatch", amount: 1200, status: dispatchCase.type.endsWith("closed") ? "won" : "needs_response" })
    });

    const result = await service.handleWebhook(sign(event));

    assert.deepEqual(result, { received: true, ignored: false });
    assert.equal(delegated.length, 1);
    assert.equal(events.get(eventId)?.status, "PROCESSED");
    assert.equal(events.get(eventId)?.tenantId, "tenant-rental-dispatch", "journal ownership comes from the verified rental handler");
    assert.equal(events.get(eventId)?.type, dispatchCase.type);
    assert.ok(events.get(eventId)?.processedAt instanceof Date);
    assert.equal(upserts.length, 0, "rental refund/dispute must not mutate TenantSubscription");
    assert.deepEqual([...subscriptions.entries()], licensesBefore);
    assert.equal(notifications.length, 0);
    assert.equal(websiteEvents.length, 0);
    assert.equal(audit.rows.some((row) => row.action === "PLATFORM_LICENSE_UPDATED" || row.action === "BILLING_PAYMENT_METHOD_UPDATED"), false);
  });
}

test("non-rental refund/dispute webhook dispatch remains ignored without SaaS mutations", async () => {
  for (const dispatchCase of rentalChargeDispatchCases) {
    const eventId = `evt_nonrental_dispatch_${dispatchCase.type.replaceAll(".", "_")}`;
    let delegated = 0;
    const rentalHandler: RentalStripeWebhookHandler = {
      async handleStripeEvent(event) {
        delegated += 1;
        assert.equal(event.id, eventId);
        assert.equal(event.type, dispatchCase.type);
        assert.deepEqual((event.data.object as { metadata?: unknown }).metadata, {});
        return { received: true, ignored: true };
      }
    };
    const { audit, events, notifications, service, sign, subscriptions, upserts, websiteEvents } = makeHarness(undefined, rentalHandler);
    subscriptions.set("tenant-nonrental-saas", snapshotFromInput({
      tenantId: "tenant-nonrental-saas", plan: "PRO", seats: 5, status: "ACTIVE",
      provider: "stripe", stripeCustomerId: "cus_nonrental_saas", stripeSubscriptionId: "sub_nonrental_saas"
    }));
    const licensesBefore = structuredClone([...subscriptions.entries()]);
    const result = await service.handleWebhook(sign(baseEvent(eventId, dispatchCase.type, {
      id: `nonrental_${dispatchCase.id}`,
      object: dispatchCase.object,
      metadata: {},
      payment_intent: "pi_nonrental_dispatch",
      ...(dispatchCase.object === "charge"
        ? { customer: "cus_nonrental_saas", amount: 1200, amount_refunded: 1200, refunded: true }
        : { charge: "ch_nonrental_dispatch", amount: 1200, status: dispatchCase.type.endsWith("closed") ? "won" : "needs_response" })
    })));

    assert.deepEqual(result, { received: true, ignored: true });
    assert.equal(delegated, 1, "the rental handler authoritatively classifies an event without rental metadata");
    assert.equal(events.get(eventId)?.status, "IGNORED");
    assert.ok(events.get(eventId)?.processedAt instanceof Date);
    assert.equal(upserts.length, 0);
    assert.deepEqual([...subscriptions.entries()], licensesBefore);
    assert.equal(notifications.length, 0);
    assert.equal(websiteEvents.length, 0);
    assert.equal(audit.rows.some((row) => row.action === "PLATFORM_LICENSE_UPDATED" || row.action === "BILLING_PAYMENT_METHOD_UPDATED"), false);
  }
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
