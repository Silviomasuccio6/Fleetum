import crypto from "node:crypto";
import { AuditLogRepository } from "../../domain/repositories/audit-log-repository.js";
import {
  BillingCycle,
  SaasPlan,
  ensureKnownPlan,
  getPlanMonthlyPrice,
  normalizeBillingCycle
} from "./feature-entitlements-service.js";
import { env } from "../../shared/config/env.js";
import { AppError } from "../../shared/errors/app-error.js";

type BillingLicenseStatus = "ACTIVE" | "SUSPENDED" | "EXPIRED" | "TRIAL" | "PAST_DUE" | "CANCELED";

type LicenseAuditPayload = {
  plan: SaasPlan;
  seats: number;
  status: BillingLicenseStatus;
  expiresAt: string | null;
  priceMonthly: number;
  billingCycle: BillingCycle;
  stripeCustomerId?: string | null;
  stripeSubscriptionId?: string | null;
  provider?: "stripe" | "local";
  updatedAt: string;
};

const PLAN_PRICE_ENV_KEYS: Record<SaasPlan, Record<BillingCycle, keyof typeof env>> = {
  STARTER: {
    monthly: "STRIPE_PRICE_STARTER_MONTHLY",
    yearly: "STRIPE_PRICE_STARTER_YEARLY"
  },
  PRO: {
    monthly: "STRIPE_PRICE_PRO_MONTHLY",
    yearly: "STRIPE_PRICE_PRO_YEARLY"
  },
  ENTERPRISE: {
    monthly: "STRIPE_PRICE_ENTERPRISE_MONTHLY",
    yearly: "STRIPE_PRICE_ENTERPRISE_YEARLY"
  }
};

const STRIPE_API_BASE = "https://api.stripe.com/v1";

const getNested = (source: unknown, path: string): unknown => {
  let current = source;
  for (const key of path.split(".")) {
    if (!current || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
};

export class BillingService {
  constructor(private readonly auditRepository: AuditLogRepository) {}

  async createCheckoutSession(input: {
    tenantId: string;
    userId: string;
    plan: string;
    billingCycle?: string;
    customerEmail?: string | null;
  }) {
    const plan = ensureKnownPlan(input.plan);
    const billingCycle = normalizeBillingCycle(input.billingCycle);
    const priceMonthly = getPlanMonthlyPrice(plan);
    const successUrl = `${env.APP_URL}/upgrade?checkout=success&plan=${plan}`;
    const cancelUrl = `${env.APP_URL}/upgrade?checkout=cancelled&plan=${plan}`;

    if (!env.STRIPE_SECRET_KEY) {
      const localCompleteUrl = new URL("/api/billing/local-complete", "http://local-checkout");
      localCompleteUrl.searchParams.set("plan", plan);
      localCompleteUrl.searchParams.set("billingCycle", billingCycle);

      await this.auditRepository.create({
        tenantId: input.tenantId,
        userId: input.userId,
        action: "BILLING_CHECKOUT_LOCAL_CREATED",
        resource: "billing",
        details: { plan, billingCycle, priceMonthly }
      });

      return {
        mode: "local",
        checkoutUrl: `${localCompleteUrl.pathname}${localCompleteUrl.search}`
      };
    }

    const priceId = env[PLAN_PRICE_ENV_KEYS[plan][billingCycle]];
    if (!priceId) {
      throw new AppError(`Price Stripe non configurato per ${plan} ${billingCycle}`, 500, "STRIPE_PRICE_MISSING");
    }

    const body = new URLSearchParams();
    body.set("mode", "subscription");
    body.set("success_url", successUrl);
    body.set("cancel_url", cancelUrl);
    body.set("client_reference_id", input.tenantId);
    body.set("line_items[0][price]", String(priceId));
    body.set("line_items[0][quantity]", "1");
    body.set("metadata[tenantId]", input.tenantId);
    body.set("metadata[userId]", input.userId);
    body.set("metadata[plan]", plan);
    body.set("metadata[billingCycle]", billingCycle);
    body.set("subscription_data[metadata][tenantId]", input.tenantId);
    body.set("subscription_data[metadata][plan]", plan);
    body.set("subscription_data[metadata][billingCycle]", billingCycle);
    if (input.customerEmail) body.set("customer_email", input.customerEmail);
    if (env.BILLING_TRIAL_DAYS > 0) body.set("subscription_data[trial_period_days]", String(env.BILLING_TRIAL_DAYS));

    const response = await fetch(`${STRIPE_API_BASE}/checkout/sessions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body
    });

    const payload = await response.json() as { id?: string; url?: string; error?: { message?: string } };
    if (!response.ok || !payload.url) {
      throw new AppError(payload.error?.message ?? "Creazione checkout Stripe fallita", 502, "STRIPE_CHECKOUT_FAILED");
    }

    await this.auditRepository.create({
      tenantId: input.tenantId,
      userId: input.userId,
      action: "BILLING_CHECKOUT_CREATED",
      resource: "billing",
      resourceId: payload.id ?? null,
      details: { plan, billingCycle, priceMonthly, stripeSessionId: payload.id ?? null }
    });

    return {
      mode: "stripe",
      checkoutUrl: payload.url
    };
  }

  async completeLocalCheckout(input: { tenantId: string; userId: string; plan: string; billingCycle?: string }) {
    if (env.NODE_ENV === "production") throw new AppError("Checkout locale non disponibile in produzione", 403, "LOCAL_CHECKOUT_DISABLED");

    const plan = ensureKnownPlan(input.plan);
    const billingCycle = normalizeBillingCycle(input.billingCycle);
    await this.writeLicense(input.tenantId, input.userId, {
      plan,
      seats: 3,
      status: "ACTIVE",
      expiresAt: null,
      priceMonthly: getPlanMonthlyPrice(plan),
      billingCycle,
      provider: "local",
      updatedAt: new Date().toISOString()
    });
  }

  async handleWebhook(input: { signature?: string; rawBody?: Buffer; body: unknown }) {
    const event = this.verifyWebhook(input);
    const type = String((event as Record<string, unknown>).type ?? "");
    const dataObject = getNested(event, "data.object") as Record<string, unknown> | undefined;
    if (!dataObject) return { received: true, ignored: true };

    if (type === "checkout.session.completed") {
      await this.applyStripeObject(dataObject, "ACTIVE");
      return { received: true };
    }

    if (type === "customer.subscription.updated" || type === "customer.subscription.created") {
      const stripeStatus = String(dataObject.status ?? "");
      const nextStatus: BillingLicenseStatus =
        stripeStatus === "active" || stripeStatus === "trialing"
          ? "ACTIVE"
          : stripeStatus === "past_due" || stripeStatus === "unpaid"
            ? "PAST_DUE"
            : stripeStatus === "canceled"
              ? "CANCELED"
              : "SUSPENDED";
      await this.applyStripeObject(dataObject, nextStatus);
      return { received: true };
    }

    if (type === "customer.subscription.deleted") {
      await this.applyStripeObject(dataObject, "CANCELED");
      return { received: true };
    }

    if (type === "invoice.payment_failed") {
      await this.applyStripeObject(dataObject, "PAST_DUE");
      return { received: true };
    }

    return { received: true, ignored: true };
  }

  private verifyWebhook(input: { signature?: string; rawBody?: Buffer; body: unknown }) {
    if (!env.STRIPE_WEBHOOK_SECRET) return input.body;
    if (!input.signature || !input.rawBody) throw new AppError("Firma webhook Stripe mancante", 400, "STRIPE_SIGNATURE_MISSING");

    const parts = Object.fromEntries(
      input.signature.split(",").map((item) => {
        const [key, value] = item.split("=");
        return [key, value];
      })
    );
    const timestamp = parts.t;
    const signature = parts.v1;
    if (!timestamp || !signature) throw new AppError("Firma webhook Stripe non valida", 400, "STRIPE_SIGNATURE_INVALID");

    const tolerance = 5 * 60;
    if (Math.abs(Date.now() / 1000 - Number(timestamp)) > tolerance) {
      throw new AppError("Webhook Stripe scaduto", 400, "STRIPE_SIGNATURE_EXPIRED");
    }

    const signedPayload = `${timestamp}.${input.rawBody.toString("utf8")}`;
    const expected = crypto.createHmac("sha256", env.STRIPE_WEBHOOK_SECRET).update(signedPayload).digest("hex");
    const expectedBuffer = Buffer.from(expected, "hex");
    const signatureBuffer = Buffer.from(signature, "hex");
    if (expectedBuffer.length !== signatureBuffer.length || !crypto.timingSafeEqual(expectedBuffer, signatureBuffer)) {
      throw new AppError("Firma webhook Stripe non valida", 400, "STRIPE_SIGNATURE_INVALID");
    }

    return JSON.parse(input.rawBody.toString("utf8"));
  }

  private async applyStripeObject(source: Record<string, unknown>, status: BillingLicenseStatus) {
    const metadata = typeof source.metadata === "object" && source.metadata ? source.metadata as Record<string, unknown> : {};
    const tenantId = String(metadata.tenantId ?? source.client_reference_id ?? "");
    if (!tenantId) return;

    const plan = ensureKnownPlan(String(metadata.plan ?? "STARTER"));
    const billingCycle = normalizeBillingCycle(String(metadata.billingCycle ?? "monthly"));
    const currentPeriodEnd = Number(source.current_period_end ?? getNested(source, "lines.data.0.period.end"));
    const expiresAt = Number.isFinite(currentPeriodEnd) && currentPeriodEnd > 0
      ? new Date(currentPeriodEnd < 100000000000 ? currentPeriodEnd * 1000 : currentPeriodEnd).toISOString()
      : null;

    await this.writeLicense(tenantId, null, {
      plan,
      seats: 3,
      status,
      expiresAt,
      priceMonthly: getPlanMonthlyPrice(plan),
      billingCycle,
      stripeCustomerId: typeof source.customer === "string" ? source.customer : null,
      stripeSubscriptionId: typeof source.subscription === "string" ? source.subscription : typeof source.id === "string" ? source.id : null,
      provider: "stripe",
      updatedAt: new Date().toISOString()
    });
  }

  private async writeLicense(tenantId: string, userId: string | null, next: LicenseAuditPayload) {
    await this.auditRepository.create({
      tenantId,
      userId,
      action: "PLATFORM_LICENSE_UPDATED",
      resource: "tenant",
      resourceId: tenantId,
      details: {
        source: "billing",
        after: next
      }
    });
  }
}
