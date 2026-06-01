import crypto from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const upsertTenantSubscription = vi.fn(async (input: Record<string, unknown>) => ({
  id: "sub_persisted",
  ...input
}));

vi.mock("../../../src/application/services/tenant-subscription-service.js", () => ({
  upsertTenantSubscription
}));

const webhookSecret = "whsec_unit_test_secret_0000000000000000";

const signedPayload = (event: Record<string, unknown>) => {
  const rawBody = Buffer.from(JSON.stringify(event));
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = crypto.createHmac("sha256", webhookSecret).update(`${timestamp}.${rawBody.toString("utf8")}`).digest("hex");
  return { rawBody, signature: `t=${timestamp},v1=${signature}` };
};

const createService = async (
  envPatch: Record<string, string | undefined> = {},
  options: { webhookSecret?: string | null } = {}
) => {
  process.env.NODE_ENV = "test";
  if (options.webhookSecret === null) {
    delete process.env.STRIPE_WEBHOOK_SECRET;
  } else {
    process.env.STRIPE_WEBHOOK_SECRET = options.webhookSecret ?? webhookSecret;
  }
  for (const key of ["STRIPE_SECRET_KEY", "STRIPE_PRICE_PRO_MONTHLY", "STRIPE_PRICE_STARTER_MONTHLY"] as const) {
    if (envPatch[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = envPatch[key];
    }
  }
  vi.resetModules();
  const { BillingService } = await import("../../../src/application/services/billing-service.js");
  const auditRepository = { create: vi.fn(async () => undefined) };
  return { service: new BillingService(auditRepository as any), auditRepository };
};

describe("Stripe billing webhook", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("creates a local checkout session when Stripe is not configured", async () => {
    const { service, auditRepository } = await createService();

    const result = await service.createCheckoutSession({
      tenantId: "tenant_local",
      userId: "user_local",
      plan: "PRO",
      billingCycle: "monthly"
    });

    expect(result).toEqual({
      mode: "local",
      checkoutUrl: "/api/billing/local-complete?plan=PRO&billingCycle=monthly"
    });
    expect(auditRepository.create).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: "tenant_local",
      action: "BILLING_CHECKOUT_LOCAL_CREATED"
    }));
  });

  it("creates a Stripe checkout session when Stripe is configured", async () => {
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const body = init.body as URLSearchParams;
      expect(body.get("metadata[tenantId]")).toBe("tenant_stripe");
      expect(body.get("metadata[plan]")).toBe("PRO");
      expect(body.get("line_items[0][price]")).toBe("price_pro_monthly");
      expect(body.get("customer_email")).toBe("admin@example.test");
      return {
        ok: true,
        json: async () => ({ id: "cs_123", url: "https://checkout.stripe.test/session" })
      } as Response;
    });
    vi.stubGlobal("fetch", fetchMock);
    const { service, auditRepository } = await createService({
      STRIPE_SECRET_KEY: "sk_test_unit",
      STRIPE_PRICE_PRO_MONTHLY: "price_pro_monthly"
    });

    const result = await service.createCheckoutSession({
      tenantId: "tenant_stripe",
      userId: "user_stripe",
      plan: "PRO",
      billingCycle: "monthly",
      customerEmail: "admin@example.test"
    });

    expect(result).toEqual({ mode: "stripe", checkoutUrl: "https://checkout.stripe.test/session" });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(auditRepository.create).toHaveBeenCalledWith(expect.objectContaining({
      action: "BILLING_CHECKOUT_CREATED",
      resourceId: "cs_123"
    }));
  });

  it("surfaces Stripe checkout API failures", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: false,
      json: async () => ({ error: { message: "Stripe says no" } })
    } as Response)));
    const { service } = await createService({
      STRIPE_SECRET_KEY: "sk_test_unit",
      STRIPE_PRICE_PRO_MONTHLY: "price_pro_monthly"
    });

    await expect(service.createCheckoutSession({
      tenantId: "tenant_stripe_fail",
      userId: "user_stripe_fail",
      plan: "PRO",
      billingCycle: "monthly"
    })).rejects.toMatchObject({ statusCode: 502, code: "STRIPE_CHECKOUT_FAILED" });
  });

  it("fails Stripe checkout when the configured price id is missing", async () => {
    const { service } = await createService({ STRIPE_SECRET_KEY: "sk_test_unit" });

    await expect(service.createCheckoutSession({
      tenantId: "tenant_missing_price",
      userId: "user_missing_price",
      plan: "PRO",
      billingCycle: "monthly"
    })).rejects.toMatchObject({ statusCode: 500, code: "STRIPE_PRICE_MISSING" });
  });

  it("persists a local checkout completion outside production", async () => {
    const { service } = await createService();

    await service.completeLocalCheckout({
      tenantId: "tenant_local_complete",
      userId: "user_local_complete",
      plan: "STARTER",
      billingCycle: "monthly"
    });

    expect(upsertTenantSubscription).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: "tenant_local_complete",
      plan: "STARTER",
      status: "ACTIVE",
      provider: "local"
    }));
  });

  it("activates the subscription on checkout.session.completed", async () => {
    const { service, auditRepository } = await createService();
    const event = {
      id: "evt_checkout_completed",
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_test_123",
          customer: "cus_123",
          subscription: "sub_123",
          client_reference_id: "tenant_checkout",
          metadata: {
            tenantId: "tenant_checkout",
            plan: "PRO",
            billingCycle: "monthly"
          }
        }
      }
    };
    const { rawBody, signature } = signedPayload(event);

    const result = await service.handleWebhook({ signature, rawBody, body: {} });

    expect(result).toEqual({ received: true });
    expect(upsertTenantSubscription).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: "tenant_checkout",
      plan: "PRO",
      status: "ACTIVE",
      provider: "stripe",
      stripeCustomerId: "cus_123",
      stripeSubscriptionId: "sub_123"
    }));
    expect(auditRepository.create).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: "tenant_checkout",
      action: "PLATFORM_LICENSE_UPDATED"
    }));
  });

  it("marks the tenant past due on invoice.payment_failed", async () => {
    const { service } = await createService();
    const event = {
      id: "evt_invoice_failed",
      type: "invoice.payment_failed",
      data: {
        object: {
          id: "in_123",
          customer: "cus_failed",
          subscription: "sub_failed",
          metadata: {
            tenantId: "tenant_failed",
            plan: "STARTER",
            billingCycle: "monthly"
          },
          lines: {
            data: [{ period: { end: 1798761600 } }]
          }
        }
      }
    };
    const { rawBody, signature } = signedPayload(event);

    await service.handleWebhook({ signature, rawBody, body: {} });

    expect(upsertTenantSubscription).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: "tenant_failed",
      plan: "STARTER",
      status: "PAST_DUE",
      stripeCustomerId: "cus_failed",
      stripeSubscriptionId: "sub_failed"
    }));
  });

  it.each([
    ["customer.subscription.created", "active", "ACTIVE"],
    ["customer.subscription.created", "trialing", "ACTIVE"],
    ["customer.subscription.updated", "past_due", "PAST_DUE"],
    ["customer.subscription.updated", "unpaid", "PAST_DUE"],
    ["customer.subscription.updated", "canceled", "CANCELED"],
    ["customer.subscription.updated", "incomplete", "SUSPENDED"]
  ])("maps %s/%s to %s", async (eventType, stripeStatus, expectedStatus) => {
    const { service } = await createService();
    const event = {
      id: `evt_${stripeStatus}`,
      type: eventType,
      data: {
        object: {
          id: `sub_${stripeStatus}`,
          status: stripeStatus,
          customer: `cus_${stripeStatus}`,
          metadata: {
            tenantId: `tenant_${stripeStatus}`,
            plan: "ENTERPRISE",
            billingCycle: "yearly"
          },
          current_period_end: 1798761600
        }
      }
    };
    const { rawBody, signature } = signedPayload(event);

    await service.handleWebhook({ signature, rawBody, body: {} });

    expect(upsertTenantSubscription).toHaveBeenLastCalledWith(expect.objectContaining({
      tenantId: `tenant_${stripeStatus}`,
      status: expectedStatus,
      stripeSubscriptionId: `sub_${stripeStatus}`
    }));
  });

  it("cancels the tenant on customer.subscription.deleted", async () => {
    const { service } = await createService();
    const event = {
      id: "evt_deleted",
      type: "customer.subscription.deleted",
      data: {
        object: {
          id: "sub_deleted",
          metadata: { tenantId: "tenant_deleted", plan: "PRO", billingCycle: "monthly" }
        }
      }
    };
    const { rawBody, signature } = signedPayload(event);

    await service.handleWebhook({ signature, rawBody, body: {} });

    expect(upsertTenantSubscription).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: "tenant_deleted",
      status: "CANCELED"
    }));
  });

  it("falls back to client_reference_id, default plan and object id when metadata is partial", async () => {
    const { service } = await createService();
    const event = {
      id: "evt_partial",
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_partial",
          client_reference_id: "tenant_partial",
          current_period_end: 1798761600000
        }
      }
    };
    const { rawBody, signature } = signedPayload(event);

    await service.handleWebhook({ signature, rawBody, body: {} });

    expect(upsertTenantSubscription).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: "tenant_partial",
      plan: "STARTER",
      billingCycle: "monthly",
      status: "ACTIVE",
      stripeCustomerId: null,
      stripeSubscriptionId: "cs_partial",
      expiresAt: "2027-01-01T00:00:00.000Z"
    }));
  });

  it("ignores events without data object or tenant metadata", async () => {
    const { service } = await createService();
    const withoutObject = signedPayload({ id: "evt_no_object", type: "checkout.session.completed", data: {} });
    const withoutTenant = signedPayload({ id: "evt_no_tenant", type: "checkout.session.completed", data: { object: { id: "cs_no_tenant", metadata: {} } } });

    await expect(service.handleWebhook({ ...withoutObject, body: {} })).resolves.toEqual({ received: true, ignored: true });
    await expect(service.handleWebhook({ ...withoutTenant, body: {} })).resolves.toEqual({ received: true });
    expect(upsertTenantSubscription).not.toHaveBeenCalled();
  });

  it("rejects missing and expired webhook signatures with 400", async () => {
    const { service } = await createService();
    const rawBody = Buffer.from(JSON.stringify({ type: "customer.created", data: { object: {} } }));
    const oldTimestamp = Math.floor(Date.now() / 1000) - 1000;
    const expiredSignature = crypto.createHmac("sha256", webhookSecret).update(`${oldTimestamp}.${rawBody.toString("utf8")}`).digest("hex");

    await expect(service.handleWebhook({ rawBody, body: {} })).rejects.toMatchObject({
      statusCode: 400,
      code: "STRIPE_SIGNATURE_MISSING"
    });
    await expect(service.handleWebhook({
      signature: `t=${oldTimestamp},v1=${expiredSignature}`,
      rawBody,
      body: {}
    })).rejects.toMatchObject({ statusCode: 400, code: "STRIPE_SIGNATURE_EXPIRED" });
  });

  it("rejects malformed webhook signatures with 400", async () => {
    const { service } = await createService();
    const rawBody = Buffer.from(JSON.stringify({ type: "customer.created", data: { object: {} } }));

    await expect(service.handleWebhook({
      signature: "v1=missing_timestamp",
      rawBody,
      body: {}
    })).rejects.toMatchObject({ statusCode: 400, code: "STRIPE_SIGNATURE_INVALID" });
  });

  it("uses parsed body directly when webhook secret is not configured", async () => {
    const { service } = await createService({}, { webhookSecret: null });

    const result = await service.handleWebhook({
      body: {
        type: "customer.created",
        data: { object: { id: "cus_no_secret" } }
      }
    });

    expect(result).toEqual({ received: true, ignored: true });
  });

  it("rejects invalid webhook signatures with 400 and does not process the event", async () => {
    const { service, auditRepository } = await createService();
    const rawBody = Buffer.from(JSON.stringify({
      type: "checkout.session.completed",
      data: { object: { metadata: { tenantId: "tenant_invalid" } } }
    }));
    const timestamp = Math.floor(Date.now() / 1000);

    await expect(service.handleWebhook({
      signature: `t=${timestamp},v1=badbadbad`,
      rawBody,
      body: {}
    })).rejects.toMatchObject({ statusCode: 400, code: "STRIPE_SIGNATURE_INVALID" });

    expect(upsertTenantSubscription).not.toHaveBeenCalled();
    expect(auditRepository.create).not.toHaveBeenCalled();
  });

  it("ignores unknown events gracefully", async () => {
    const { service, auditRepository } = await createService();
    const event = {
      id: "evt_unknown",
      type: "customer.created",
      data: { object: { id: "cus_unknown", metadata: { tenantId: "tenant_unknown" } } }
    };
    const { rawBody, signature } = signedPayload(event);

    const result = await service.handleWebhook({ signature, rawBody, body: {} });

    expect(result).toEqual({ received: true, ignored: true });
    expect(upsertTenantSubscription).not.toHaveBeenCalled();
    expect(auditRepository.create).not.toHaveBeenCalled();
  });
});
