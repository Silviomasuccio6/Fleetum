import Stripe from "stripe";
import { Prisma } from "@prisma/client";
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
import { prisma } from "../../infrastructure/database/prisma/client.js";
import { TenantSubscriptionSnapshot, TenantSubscriptionUpsertInput, readTenantSubscription, upsertTenantSubscription } from "./tenant-subscription-service.js";

type BillingLicenseStatus = "PENDING" | "ACTIVE" | "SUSPENDED" | "EXPIRED" | "TRIAL" | "PAST_DUE" | "CANCELED";
type StripeClient = Stripe;

type BillingEventStatus = "RECEIVED" | "PROCESSED" | "IGNORED" | "FAILED";

type BillingEventRecord = {
  eventId: string;
  tenantId: string | null;
  status: string;
  processedAt: Date | null;
};

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

type BillingServiceDeps = {
  createBillingEvent(event: Stripe.Event, tenantId: string | null): Promise<BillingEventRecord>;
  updateBillingEvent(eventId: string, data: { tenantId?: string | null; status: BillingEventStatus; processedAt?: Date | null; errorMessage?: string | null }): Promise<void>;
  findSubscriptionByTenantId(tenantId: string): Promise<TenantSubscriptionSnapshot | null>;
  findSubscriptionByStripeSubscriptionId(subscriptionId: string): Promise<{ tenantId: string } | null>;
  findSubscriptionByStripeCustomerId(customerId: string): Promise<{ tenantId: string } | null>;
  upsertSubscription(input: TenantSubscriptionUpsertInput): Promise<TenantSubscriptionSnapshot>;
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

const getNested = (source: unknown, path: string): unknown => {
  let current = source;
  for (const key of path.split(".")) {
    if (!current || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
};

const stripeId = (value: unknown) => {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && typeof (value as { id?: unknown }).id === "string") return (value as { id: string }).id;
  return null;
};

const unixToIso = (value: unknown) => {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return new Date(n < 100000000000 ? n * 1000 : n).toISOString();
};

const jsonPayload = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value ?? {}));

const stripeStatusToLicense = (stripeStatus: string): BillingLicenseStatus => {
  if (stripeStatus === "active") return "ACTIVE";
  if (stripeStatus === "trialing") return "TRIAL";
  if (stripeStatus === "incomplete") return "PENDING";
  if (stripeStatus === "past_due" || stripeStatus === "unpaid") return "PAST_DUE";
  if (stripeStatus === "canceled") return "CANCELED";
  if (stripeStatus === "incomplete_expired") return "EXPIRED";
  return "SUSPENDED";
};

const createStripeClient = () => {
  if (!env.STRIPE_SECRET_KEY) return null;
  return new Stripe(env.STRIPE_SECRET_KEY);
};

const defaultDeps: BillingServiceDeps = {
  async createBillingEvent(event, tenantId) {
    try {
      return await prisma.billingEvent.create({
        data: {
          eventId: event.id,
          provider: "stripe",
          type: event.type,
          tenantId,
          status: "RECEIVED",
          payload: jsonPayload(event)
        },
        select: { eventId: true, tenantId: true, status: true, processedAt: true }
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        const existing = await prisma.billingEvent.findUnique({
          where: { eventId: event.id },
          select: { eventId: true, tenantId: true, status: true, processedAt: true }
        });
        if (existing) return existing;
      }
      throw error;
    }
  },
  async updateBillingEvent(eventId, data) {
    await prisma.billingEvent.update({
      where: { eventId },
      data: {
        tenantId: data.tenantId,
        processedAt: data.processedAt,
        status: data.status,
        errorMessage: data.errorMessage
      }
    });
  },
  async findSubscriptionByTenantId(tenantId) {
    return readTenantSubscription(tenantId);
  },
  async findSubscriptionByStripeSubscriptionId(subscriptionId) {
    return prisma.tenantSubscription.findFirst({
      where: { provider: "stripe", stripeSubscriptionId: subscriptionId },
      select: { tenantId: true }
    });
  },
  async findSubscriptionByStripeCustomerId(customerId) {
    return prisma.tenantSubscription.findFirst({
      where: { provider: "stripe", stripeCustomerId: customerId },
      select: { tenantId: true }
    });
  },
  async upsertSubscription(input) {
    return upsertTenantSubscription(input);
  }
};

export class BillingService {
  private readonly deps: BillingServiceDeps;

  constructor(
    private readonly auditRepository: AuditLogRepository,
    private readonly stripeClient: StripeClient | null = createStripeClient(),
    deps: Partial<BillingServiceDeps> = {}
  ) {
    this.deps = { ...defaultDeps, ...deps };
  }

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

    if (!env.STRIPE_SECRET_KEY || !this.stripeClient) {
      if (env.NODE_ENV === "production") {
        throw new AppError("Stripe non configurato in produzione", 500, "STRIPE_NOT_CONFIGURED");
      }

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

    const session = await this.stripeClient.checkout.sessions.create({
      mode: "subscription",
      success_url: successUrl,
      cancel_url: cancelUrl,
      client_reference_id: input.tenantId,
      customer_email: input.customerEmail ?? undefined,
      line_items: [{ price: String(priceId), quantity: 1 }],
      metadata: {
        tenantId: input.tenantId,
        userId: input.userId,
        plan,
        billingCycle
      },
      subscription_data: {
        trial_period_days: env.BILLING_TRIAL_DAYS > 0 ? env.BILLING_TRIAL_DAYS : undefined,
        metadata: {
          tenantId: input.tenantId,
          plan,
          billingCycle
        }
      }
    });

    if (!session.url) {
      throw new AppError("Creazione checkout Stripe fallita", 502, "STRIPE_CHECKOUT_FAILED");
    }

    await this.auditRepository.create({
      tenantId: input.tenantId,
      userId: input.userId,
      action: "BILLING_CHECKOUT_CREATED",
      resource: "billing",
      resourceId: session.id,
      details: { plan, billingCycle, priceMonthly, stripeSessionId: session.id }
    });

    return {
      mode: "stripe",
      checkoutUrl: session.url
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
    const dataObject = event.data.object as unknown as Record<string, unknown> | undefined;
    const tenantId = dataObject ? await this.resolveTenantId(dataObject) : null;
    const billingEvent = await this.deps.createBillingEvent(event, tenantId);

    if (billingEvent.processedAt && billingEvent.status === "PROCESSED") {
      return { received: true, duplicate: true };
    }

    try {
      const result = await this.processStripeEvent(event, dataObject);
      await this.deps.updateBillingEvent(event.id, {
        tenantId: result.tenantId ?? tenantId,
        processedAt: new Date(),
        status: result.ignored ? "IGNORED" : "PROCESSED",
        errorMessage: null
      });
      return { received: true, ignored: result.ignored ?? false };
    } catch (error) {
      await this.deps.updateBillingEvent(event.id, {
        tenantId,
        status: "FAILED",
        errorMessage: error instanceof Error ? error.message.slice(0, 1000) : "Webhook processing failed"
      });
      throw error;
    }
  }

  private verifyWebhook(input: { signature?: string; rawBody?: Buffer; body: unknown }): Stripe.Event {
    if (!env.STRIPE_WEBHOOK_SECRET) {
      throw new AppError("STRIPE_WEBHOOK_SECRET non configurato", 500, "STRIPE_WEBHOOK_SECRET_MISSING");
    }
    if (!this.stripeClient) {
      throw new AppError("STRIPE_SECRET_KEY non configurata", 500, "STRIPE_CLIENT_MISSING");
    }
    if (!input.signature || !input.rawBody) throw new AppError("Firma webhook Stripe mancante", 400, "STRIPE_SIGNATURE_MISSING");

    try {
      return this.stripeClient.webhooks.constructEvent(input.rawBody, input.signature, env.STRIPE_WEBHOOK_SECRET);
    } catch {
      throw new AppError("Firma webhook Stripe non valida", 400, "STRIPE_SIGNATURE_INVALID");
    }
  }

  private async processStripeEvent(event: Stripe.Event, dataObject?: Record<string, unknown>) {
    if (!dataObject) return { ignored: true, tenantId: null };

    if (event.type === "checkout.session.completed") {
      const session = dataObject as unknown as Stripe.Checkout.Session & Record<string, unknown>;
      const subscriptionId = stripeId(session.subscription);
      const tenantId = await this.resolveTenantId(session);
      if (!tenantId) return { ignored: true, tenantId: null };

      if (subscriptionId && this.stripeClient) {
        const subscription = await this.stripeClient.subscriptions.retrieve(subscriptionId);
        await this.applyStripeObject(subscription as unknown as Record<string, unknown>, stripeStatusToLicense(subscription.status), {
          fallbackTenantId: tenantId,
          fallbackCustomerId: stripeId(session.customer),
          fallbackSubscriptionId: subscriptionId,
          fallbackMetadata: typeof session.metadata === "object" && session.metadata ? session.metadata as Record<string, unknown> : {}
        });
      } else {
        await this.applyStripeObject(session, "ACTIVE", { fallbackTenantId: tenantId });
      }
      return { tenantId };
    }

    if (event.type === "customer.subscription.created" || event.type === "customer.subscription.updated") {
      const status = stripeStatusToLicense(String(dataObject.status ?? ""));
      const tenantId = await this.applyStripeObject(dataObject, status);
      return { tenantId };
    }

    if (event.type === "customer.subscription.deleted") {
      const tenantId = await this.applyStripeObject(dataObject, "CANCELED");
      return { tenantId };
    }

    if (event.type === "invoice.payment_failed") {
      const tenantId = await this.applyStripeObject(dataObject, "PAST_DUE");
      return { tenantId };
    }

    if (event.type === "invoice.paid" || event.type === "invoice.payment_succeeded") {
      const tenantId = await this.applyStripeObject(dataObject, "ACTIVE");
      return { tenantId };
    }

    return { ignored: true, tenantId: await this.resolveTenantId(dataObject) };
  }

  private async resolveTenantId(source: Record<string, unknown>) {
    const metadata = typeof source.metadata === "object" && source.metadata ? source.metadata as Record<string, unknown> : {};
    const direct = metadata.tenantId ?? source.client_reference_id;
    if (typeof direct === "string" && direct.trim()) return direct;

    const subscriptionId = stripeId(source.subscription) ?? stripeId(source.id);
    if (subscriptionId) {
      const row = await this.deps.findSubscriptionByStripeSubscriptionId(subscriptionId);
      if (row) return row.tenantId;
    }

    const customerId = stripeId(source.customer);
    if (customerId) {
      const row = await this.deps.findSubscriptionByStripeCustomerId(customerId);
      if (row) return row.tenantId;
    }

    return null;
  }

  private async applyStripeObject(source: Record<string, unknown>, status: BillingLicenseStatus, fallback?: {
    fallbackTenantId?: string | null;
    fallbackCustomerId?: string | null;
    fallbackSubscriptionId?: string | null;
    fallbackMetadata?: Record<string, unknown>;
  }) {
    const metadata = {
      ...(fallback?.fallbackMetadata ?? {}),
      ...(typeof source.metadata === "object" && source.metadata ? source.metadata as Record<string, unknown> : {})
    };
    const tenantId = String(metadata.tenantId ?? fallback?.fallbackTenantId ?? await this.resolveTenantId(source) ?? "");
    if (!tenantId) return null;

    const current = await this.deps.findSubscriptionByTenantId(tenantId);
    const plan = ensureKnownPlan(String(metadata.plan ?? current?.plan ?? "STARTER"));
    const billingCycle = normalizeBillingCycle(String(metadata.billingCycle ?? current?.billingCycle ?? "monthly"));
    const currentPeriodEnd = source.current_period_end ?? getNested(source, "lines.data.0.period.end");
    const expiresAt = unixToIso(currentPeriodEnd) ?? current?.expiresAt ?? null;
    const customerId = stripeId(source.customer) ?? fallback?.fallbackCustomerId ?? current?.stripeCustomerId ?? null;
    const subscriptionId = stripeId(source.subscription) ?? stripeId(source.id) ?? fallback?.fallbackSubscriptionId ?? current?.stripeSubscriptionId ?? null;

    await this.writeLicense(tenantId, null, {
      plan,
      seats: current?.seats ?? 3,
      status,
      expiresAt,
      priceMonthly: current?.priceMonthly ?? getPlanMonthlyPrice(plan),
      billingCycle,
      stripeCustomerId: customerId,
      stripeSubscriptionId: subscriptionId,
      provider: "stripe",
      updatedAt: new Date().toISOString()
    });

    return tenantId;
  }

  private async writeLicense(tenantId: string, userId: string | null, next: LicenseAuditPayload) {
    const subscription = await this.deps.upsertSubscription({
      tenantId,
      plan: next.plan,
      seats: next.seats,
      status: next.status,
      expiresAt: next.expiresAt,
      priceMonthly: next.priceMonthly,
      billingCycle: next.billingCycle,
      provider: next.provider,
      stripeCustomerId: next.stripeCustomerId,
      stripeSubscriptionId: next.stripeSubscriptionId
    });

    await this.auditRepository.create({
      tenantId,
      userId,
      action: "PLATFORM_LICENSE_UPDATED",
      resource: "tenant",
      resourceId: tenantId,
      details: {
        source: "billing",
        persisted: true,
        after: {
          ...next,
          subscription
        }
      }
    });
  }
}
