import Stripe from "stripe";
import { Prisma } from "@prisma/client";
import { AuditLogRepository } from "../../domain/repositories/audit-log-repository.js";
import {
  BillingCycle,
  COMMERCIAL_PLAN_CATALOG,
  PLAN_LEVELS,
  SaasPlan,
  ensureKnownPlan,
  getPlanMonthlyPrice,
  normalizeBillingCycle
} from "./feature-entitlements-service.js";
import { env } from "../../shared/config/env.js";
import { AppError } from "../../shared/errors/app-error.js";
import { prisma } from "../../infrastructure/database/prisma/client.js";
import {
  StripeTenantSubscriptionGuard,
  StripeTenantSubscriptionMutationResult,
  TenantSubscriptionSnapshot,
  TenantSubscriptionUpsertInput,
  readTenantSubscription,
  upsertStripeTenantSubscriptionIfCurrent,
  upsertTenantSubscription
} from "./tenant-subscription-service.js";
import {
  BillingLifecycleEmailInput,
  BillingLifecycleNotifier,
  BillingLifecycleNotifierLike,
  BillingLifecycleStatus
} from "./billing-lifecycle-notifier.js";
import { logger } from "../../infrastructure/logging/logger.js";
import { privacyHash } from "../../shared/utils/privacy-hash.js";

type BillingLicenseStatus = "PENDING" | "ACTIVE" | "SUSPENDED" | "EXPIRED" | "TRIAL" | "PAST_DUE" | "CANCELED";
type StripeClient = Stripe;

type BillingEventStatus = "RECEIVED" | "PROCESSED" | "IGNORED" | "FAILED";

type BillingEventRecord = {
  eventId: string;
  tenantId: string | null;
  status: string;
  processedAt: Date | null;
};

type CheckoutAnalyticsInput = {
  visitorId?: string;
  sessionId?: string;
  referrer?: string;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  utmContent?: string;
  utmTerm?: string;
};

export type RentalStripeWebhookHandler = {
  handleStripeEvent(event: Stripe.Event): Promise<{
    tenantId?: string | null;
    ignored?: boolean;
    duplicate?: boolean;
    received?: boolean;
  }>;
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

type StripeApplyOptions = {
  expectedSubscriptionId: string;
  expectedCurrent?: TenantSubscriptionSnapshot | null;
  allowSubscriptionReplacement?: boolean;
  eventType?: string;
  notificationSource?: Record<string, unknown>;
};

type StripeApplyResult = {
  tenantId: string;
  previousStatus: BillingLifecycleStatus | null;
  nextStatus: BillingLifecycleStatus;
  applied: boolean;
  reason?: StripeTenantSubscriptionMutationResult["reason"];
};

type BillingServiceDeps = {
  createBillingEvent(event: Stripe.Event, tenantId: string | null): Promise<BillingEventRecord>;
  updateBillingEvent(eventId: string, data: { tenantId?: string | null; status: BillingEventStatus; processedAt?: Date | null; errorMessage?: string | null }): Promise<void>;
  recordWebsiteEvent(data: Prisma.WebsiteEventUncheckedCreateInput): Promise<void>;
  findSubscriptionByTenantId(tenantId: string): Promise<TenantSubscriptionSnapshot | null>;
  findSubscriptionByStripeSubscriptionId(subscriptionId: string): Promise<{ tenantId: string } | null>;
  findSubscriptionByStripeCustomerId(customerId: string): Promise<{ tenantId: string } | null>;
  upsertSubscription(input: TenantSubscriptionUpsertInput): Promise<TenantSubscriptionSnapshot>;
  upsertStripeSubscriptionIfCurrent(
    input: TenantSubscriptionUpsertInput,
    guard: StripeTenantSubscriptionGuard
  ): Promise<StripeTenantSubscriptionMutationResult>;
};

const MANAGED_STRIPE_SUBSCRIPTION_STATUSES = new Set<BillingLicenseStatus>([
  "ACTIVE",
  "TRIAL",
  "PAST_DUE",
  "SUSPENDED"
]);

const PLAN_PRICE_ENV_KEYS: Record<SaasPlan, Record<BillingCycle, keyof typeof env>> = {
  STARTER: { ...COMMERCIAL_PLAN_CATALOG.STARTER.stripePriceEnv },
  PRO: { ...COMMERCIAL_PLAN_CATALOG.PRO.stripePriceEnv },
  ENTERPRISE: { ...COMMERCIAL_PLAN_CATALOG.ENTERPRISE.stripePriceEnv }
};

const resolvePlanAndCycleFromStripePrice = (source: Record<string, unknown>): { plan: SaasPlan; billingCycle: BillingCycle } | null => {
  const priceId = [
    stripeId(getNested(source, "items.data.0.price")),
    stripeId(getNested(source, "lines.data.0.price")),
    stripeId(getNested(source, "lines.data.0.pricing.price_details.price"))
  ].find(Boolean);

  if (!priceId) return null;

  for (const plan of ["STARTER", "PRO", "ENTERPRISE"] as const) {
    for (const billingCycle of ["monthly", "yearly"] as const) {
      if (env[PLAN_PRICE_ENV_KEYS[plan][billingCycle]] === priceId) {
        return { plan, billingCycle };
      }
    }
  }

  return null;
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

const stripeSubscriptionIdFromObject = (source: Record<string, unknown>) => {
  const sourceObject = typeof source.object === "string" ? source.object : null;
  return stripeId(source.subscription)
    ?? stripeId(getNested(source, "parent.subscription_details.subscription"))
    ?? (sourceObject === "subscription" ? stripeId(source.id) : null);
};

const unixToIso = (value: unknown) => {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return new Date(n < 100000000000 ? n * 1000 : n).toISOString();
};

const jsonPayload = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value ?? {}));

const metadataFromObject = (source: unknown): Record<string, string> => {
  if (!source || typeof source !== "object") return {};
  const metadata = (source as { metadata?: unknown }).metadata;
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return {};
  return Object.fromEntries(
    Object.entries(metadata as Record<string, unknown>)
      .filter(([, value]) => typeof value === "string")
      .map(([key, value]) => [key, String(value)])
  );
};

const trimMetadataValue = (value?: string | null, max = 500) => {
  const normalized = value?.trim();
  if (!normalized) return undefined;
  return normalized.slice(0, max);
};

const compactMetadata = (input: Record<string, string | undefined>) =>
  Object.fromEntries(Object.entries(input).filter(([, value]) => typeof value === "string" && value.length > 0)) as Record<string, string>;

const isRentalPaymentEvent = (event: Stripe.Event, dataObject?: Record<string, unknown>) => {
  const metadata = metadataFromObject(dataObject ?? event.data.object);
  if (metadata.domain === "rental_payments") return true;

  const rentalCandidateEvents = new Set([
    "payment_intent.succeeded",
    "payment_intent.payment_failed",
    "payment_intent.amount_capturable_updated",
    "payment_intent.canceled",
    "charge.refunded",
    "charge.dispute.created",
    "charge.dispute.closed"
  ]);

  return rentalCandidateEvents.has(event.type) && Boolean(
    metadata.rentalDepositId ||
    metadata.rentalExtraChargeId ||
    metadata.purpose === "rental_deposit" ||
    metadata.purpose === "rental_extra_charge"
  );
};

const stripeStatusToLicense = (stripeStatus: string): BillingLicenseStatus => {
  if (stripeStatus === "active") return "ACTIVE";
  if (stripeStatus === "trialing") return "TRIAL";
  if (stripeStatus === "incomplete") return "PENDING";
  if (stripeStatus === "past_due") return "PAST_DUE";
  if (stripeStatus === "unpaid") return "SUSPENDED";
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
  async recordWebsiteEvent(data) {
    await prisma.websiteEvent.create({ data });
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
  },
  async upsertStripeSubscriptionIfCurrent(input, guard) {
    return upsertStripeTenantSubscriptionIfCurrent(input, guard);
  }
};

export class BillingService {
  private readonly deps: BillingServiceDeps;

  constructor(
    private readonly auditRepository: AuditLogRepository,
    private readonly stripeClient: StripeClient | null = createStripeClient(),
    deps: Partial<BillingServiceDeps> = {},
    private readonly lifecycleNotifier: BillingLifecycleNotifierLike = new BillingLifecycleNotifier(),
    private readonly rentalStripeWebhookHandler?: RentalStripeWebhookHandler
  ) {
    this.deps = { ...defaultDeps, ...deps };
  }

  async createCheckoutSession(input: {
    tenantId: string;
    userId: string;
    plan: string;
    billingCycle?: string;
    customerEmail?: string | null;
    analytics?: CheckoutAnalyticsInput;
  }) {
    const plan = ensureKnownPlan(input.plan);
    const billingCycle = normalizeBillingCycle(input.billingCycle);
    const priceMonthly = getPlanMonthlyPrice(plan);
    const successUrl = `${env.APP_URL}/activate?checkout=success&plan=${plan}`;
    const cancelUrl = `${env.APP_URL}/activate?checkout=cancelled&plan=${plan}`;

    const existingSubscription = await this.deps.findSubscriptionByTenantId(input.tenantId);
    if (
      existingSubscription?.provider === "stripe" &&
      existingSubscription.stripeSubscriptionId &&
      MANAGED_STRIPE_SUBSCRIPTION_STATUSES.has(existingSubscription.status)
    ) {
      throw new AppError(
        "Esiste gia un abbonamento Stripe per questo tenant. Gestisci piano e carta dal Customer Portal Stripe.",
        409,
        "STRIPE_SUBSCRIPTION_ALREADY_ACTIVE"
      );
    }

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

    const checkoutAnalyticsMetadata = this.checkoutAnalyticsMetadata(input.analytics);
    const baseMetadata = {
      tenantId: input.tenantId,
      userId: input.userId,
      plan,
      billingCycle,
      ...checkoutAnalyticsMetadata
    };

    const session = await this.stripeClient.checkout.sessions.create({
      mode: "subscription",
      success_url: successUrl,
      cancel_url: cancelUrl,
      client_reference_id: input.tenantId,
      customer_email: input.customerEmail ?? undefined,
      payment_method_collection: "always",
      line_items: [{ price: String(priceId), quantity: 1 }],
      metadata: baseMetadata,
      subscription_data: {
        trial_period_days: env.BILLING_TRIAL_DAYS > 0 ? env.BILLING_TRIAL_DAYS : undefined,
        trial_settings: env.BILLING_TRIAL_DAYS > 0
          ? { end_behavior: { missing_payment_method: "cancel" } }
          : undefined,
        metadata: {
          tenantId: input.tenantId,
          plan,
          billingCycle,
          ...checkoutAnalyticsMetadata
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

  async createPaymentMethodUpdateSession(input: { tenantId: string; userId: string }) {
    if (!env.STRIPE_SECRET_KEY || !this.stripeClient) {
      throw new AppError("Stripe non configurato", 500, "STRIPE_NOT_CONFIGURED");
    }

    const subscription = await this.deps.findSubscriptionByTenantId(input.tenantId);
    if (!subscription?.stripeCustomerId) {
      throw new AppError(
        "Completa prima il checkout Stripe per associare un cliente di fatturazione.",
        409,
        "STRIPE_CUSTOMER_MISSING"
      );
    }

    const session = await this.stripeClient.checkout.sessions.create({
      mode: "setup",
      customer: subscription.stripeCustomerId,
      client_reference_id: input.tenantId,
      payment_method_types: ["card"],
      success_url: `${env.APP_URL}/upgrade?payment_method=updated`,
      cancel_url: `${env.APP_URL}/upgrade?payment_method=cancelled`,
      metadata: {
        tenantId: input.tenantId,
        userId: input.userId,
        action: "update_payment_method"
      },
      setup_intent_data: {
        metadata: {
          tenantId: input.tenantId,
          userId: input.userId,
          action: "update_payment_method"
        }
      }
    });

    if (!session.url) {
      throw new AppError("Creazione sessione aggiornamento carta fallita", 502, "STRIPE_PAYMENT_METHOD_SESSION_FAILED");
    }

    await this.auditRepository.create({
      tenantId: input.tenantId,
      userId: input.userId,
      action: "BILLING_PAYMENT_METHOD_SESSION_CREATED",
      resource: "billing",
      resourceId: session.id,
      details: { stripeSessionId: session.id, stripeCustomerId: subscription.stripeCustomerId }
    });

    return { mode: "stripe", checkoutUrl: session.url };
  }

  async createCustomerPortalSession(input: { tenantId: string; userId: string; plan?: string; billingCycle?: string }) {
    if (!env.STRIPE_SECRET_KEY || !this.stripeClient) {
      throw new AppError("Stripe non configurato", 500, "STRIPE_NOT_CONFIGURED");
    }

    const subscription = await this.deps.findSubscriptionByTenantId(input.tenantId);
    if (subscription?.provider !== "stripe" || !subscription.stripeCustomerId) {
      throw new AppError(
        "Completa prima il checkout Stripe per gestire abbonamento e carta.",
        409,
        "STRIPE_CUSTOMER_MISSING"
      );
    }

    const targetPlan = input.plan ? ensureKnownPlan(input.plan) : null;
    const targetBillingCycle = input.billingCycle ? normalizeBillingCycle(input.billingCycle) : null;
    const isPlanUpdateFlow = Boolean(targetPlan && targetBillingCycle);
    const currentPlan = ensureKnownPlan(subscription.plan);
    const returnUrl = env.STRIPE_PORTAL_RETURN_URL || `${env.APP_URL}/upgrade?portal=returned`;
    const sessionParams: Stripe.BillingPortal.SessionCreateParams = {
      customer: subscription.stripeCustomerId,
      return_url: returnUrl,
      configuration: env.STRIPE_BILLING_PORTAL_CONFIGURATION_ID || undefined
    };

    if (isPlanUpdateFlow) {
      if (!subscription.stripeSubscriptionId) {
        throw new AppError(
          "Subscription Stripe mancante. Apri il portale clienti per verificare l'abbonamento.",
          409,
          "STRIPE_SUBSCRIPTION_MISSING"
        );
      }

      if (PLAN_LEVELS[targetPlan!] <= PLAN_LEVELS[currentPlan]) {
        throw new AppError(
          "Da questa schermata puoi solo effettuare upgrade. Downgrade e cambi sullo stesso piano vanno gestiti dalla Platform.",
          409,
          "BILLING_PLAN_CHANGE_NOT_ALLOWED"
        );
      }

      const priceId = env[PLAN_PRICE_ENV_KEYS[targetPlan!][targetBillingCycle!]];
      if (!priceId) {
        throw new AppError(`Price Stripe non configurato per ${targetPlan} ${targetBillingCycle}`, 500, "STRIPE_PRICE_MISSING");
      }

      const stripeSubscription = await this.stripeClient.subscriptions.retrieve(subscription.stripeSubscriptionId);
      const subscriptionItem = stripeSubscription.items.data[0];
      if (!subscriptionItem?.id) {
        throw new AppError(
          "Subscription Stripe senza item aggiornabile. Verifica la configurazione del prodotto su Stripe.",
          409,
          "STRIPE_SUBSCRIPTION_ITEM_MISSING"
        );
      }

      sessionParams.flow_data = {
        type: "subscription_update_confirm",
        subscription_update_confirm: {
          subscription: subscription.stripeSubscriptionId,
          items: [
            {
              id: subscriptionItem.id,
              price: String(priceId),
              quantity: subscriptionItem.quantity ?? 1
            }
          ]
        },
        after_completion: {
          type: "redirect",
          redirect: {
            return_url: `${env.APP_URL}/upgrade?portal=plan-updated`
          }
        }
      };
    }

    const session = await this.stripeClient.billingPortal.sessions.create(sessionParams);

    await this.auditRepository.create({
      tenantId: input.tenantId,
      userId: input.userId,
      action: "BILLING_CUSTOMER_PORTAL_SESSION_CREATED",
      resource: "billing",
      resourceId: session.id,
      details: {
        stripeCustomerId: subscription.stripeCustomerId,
        stripeSubscriptionId: subscription.stripeSubscriptionId ?? null,
        flow: isPlanUpdateFlow ? "subscription_update_confirm" : "portal_home",
        currentPlan,
        targetPlan,
        targetBillingCycle,
        hasConfigurationOverride: Boolean(env.STRIPE_BILLING_PORTAL_CONFIGURATION_ID)
      }
    });

    return { portalUrl: session.url };
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

    if (this.rentalStripeWebhookHandler && isRentalPaymentEvent(event, dataObject)) {
      const result = await this.rentalStripeWebhookHandler.handleStripeEvent(event);
      return {
        ignored: result.ignored ?? false,
        tenantId: result.tenantId ?? await this.resolveTenantId(dataObject)
      };
    }

    if (event.type === "checkout.session.completed") {
      const session = dataObject as unknown as Stripe.Checkout.Session & Record<string, unknown>;
      const metadata = typeof session.metadata === "object" && session.metadata ? session.metadata as Record<string, unknown> : {};
      if (session.mode === "setup" || metadata.action === "update_payment_method") {
        const tenantId = await this.applyPaymentMethodUpdate(session);
        return { tenantId };
      }

      const subscriptionId = stripeSubscriptionIdFromObject(session);
      const tenantId = await this.resolveTenantId(session);
      if (!tenantId || !subscriptionId || !this.stripeClient) return { ignored: true, tenantId };

      const sessionCustomerId = stripeId(session.customer);
      let expectedCurrent = await this.deps.findSubscriptionByTenantId(tenantId);
      let applied: StripeApplyResult | null = null;
      let nextStatus: BillingLicenseStatus = "PENDING";
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const subscription = await this.stripeClient.subscriptions.retrieve(subscriptionId);
        const authoritativeSource = subscription as unknown as Record<string, unknown>;
        const authoritativeCustomerId = stripeId(authoritativeSource.customer);
        if (authoritativeCustomerId && sessionCustomerId && authoritativeCustomerId !== sessionCustomerId) {
          return { ignored: true, tenantId };
        }

        const allowSubscriptionReplacement = await this.canCheckoutReplaceSubscription(
          expectedCurrent,
          authoritativeSource,
          subscriptionId
        );
        nextStatus = stripeStatusToLicense(String(authoritativeSource.status ?? ""));
        applied = await this.applyStripeObject(authoritativeSource, nextStatus, {
          fallbackTenantId: tenantId,
          fallbackCustomerId: sessionCustomerId,
          fallbackSubscriptionId: subscriptionId,
          fallbackMetadata: typeof session.metadata === "object" && session.metadata ? session.metadata as Record<string, unknown> : {}
        }, {
          expectedSubscriptionId: subscriptionId,
          expectedCurrent,
          allowSubscriptionReplacement
        });
        if (applied?.reason !== "STALE_SNAPSHOT") break;
        expectedCurrent = await this.deps.findSubscriptionByTenantId(tenantId);
      }
      if (applied?.reason === "STALE_SNAPSHOT") {
        throw new AppError("Sincronizzazione abbonamento Stripe concorrente", 503, "STRIPE_SUBSCRIPTION_SYNC_CONFLICT");
      }
      if (!applied?.applied) return { ignored: true, tenantId: applied?.tenantId ?? tenantId };

      await this.recordCheckoutFunnelEvent("STRIPE_CHECKOUT_COMPLETED", session, {
        stripeEventId: event.id,
        stripeSessionId: session.id,
        stripeSubscriptionId: subscriptionId,
        status: nextStatus
      });
      if (nextStatus === "TRIAL") {
        await this.recordCheckoutFunnelEvent("TRIAL_ACTIVATED", session, {
          stripeEventId: event.id,
          stripeSessionId: session.id,
          stripeSubscriptionId: subscriptionId,
          status: nextStatus
        });
      }
      return { tenantId: applied.tenantId };
    }

    if (
      event.type === "customer.subscription.created" ||
      event.type === "customer.subscription.updated" ||
      event.type === "customer.subscription.deleted" ||
      event.type === "invoice.payment_failed" ||
      event.type === "invoice.paid" ||
      event.type === "invoice.payment_succeeded"
    ) {
      const applied = await this.syncAuthoritativeStripeSubscription(dataObject, event.type);
      return {
        tenantId: applied?.tenantId ?? await this.resolveTenantId(dataObject),
        ignored: !applied?.applied
      };
    }

    if (event.type === "customer.source.expiring") {
      const tenantId = await this.resolveTenantId(dataObject);
      if (tenantId) {
        await this.safeNotify("BILLING_CARD_EXPIRING", tenantId, () =>
          this.lifecycleNotifier.notifyCardExpiring({
            tenantId,
            expMonth: Number(dataObject.exp_month) || null,
            expYear: Number(dataObject.exp_year) || null
          })
        );
      }
      return { tenantId };
    }

    return { ignored: true, tenantId: await this.resolveTenantId(dataObject) };
  }

  private async applyPaymentMethodUpdate(session: Stripe.Checkout.Session & Record<string, unknown>) {
    if (!this.stripeClient) throw new AppError("STRIPE_SECRET_KEY non configurata", 500, "STRIPE_CLIENT_MISSING");

    const tenantId = await this.resolveTenantId(session);
    if (!tenantId) return null;

    const setupIntentId = stripeId(session.setup_intent);
    const customerId = stripeId(session.customer);
    if (!setupIntentId || !customerId) {
      throw new AppError("Sessione Stripe setup incompleta", 400, "STRIPE_SETUP_SESSION_INCOMPLETE");
    }

    const setupIntent = await this.stripeClient.setupIntents.retrieve(setupIntentId);
    const paymentMethodId = stripeId(setupIntent.payment_method);
    if (!paymentMethodId) {
      throw new AppError("Metodo di pagamento Stripe mancante", 400, "STRIPE_PAYMENT_METHOD_MISSING");
    }

    await this.stripeClient.customers.update(customerId, {
      invoice_settings: { default_payment_method: paymentMethodId }
    });

    const subscription = await this.deps.findSubscriptionByTenantId(tenantId);
    if (subscription?.stripeSubscriptionId) {
      await this.stripeClient.subscriptions.update(subscription.stripeSubscriptionId, {
        default_payment_method: paymentMethodId
      });
    }

    await this.auditRepository.create({
      tenantId,
      userId: typeof session.metadata?.userId === "string" ? session.metadata.userId : null,
      action: "BILLING_PAYMENT_METHOD_UPDATED",
      resource: "billing",
      resourceId: customerId,
      details: {
        stripeCustomerId: customerId,
        stripeSubscriptionId: subscription?.stripeSubscriptionId ?? null,
        paymentMethodSource: "stripe_checkout_setup"
      }
    });

    return tenantId;
  }

  private async resolveTenantId(source: Record<string, unknown>) {
    const metadata = typeof source.metadata === "object" && source.metadata ? source.metadata as Record<string, unknown> : {};
    const direct = metadata.tenantId ?? source.client_reference_id;
    if (typeof direct === "string" && direct.trim()) return direct;

    const subscriptionId = stripeSubscriptionIdFromObject(source);
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

  private async syncAuthoritativeStripeSubscription(source: Record<string, unknown>, eventType: string) {
    if (!this.stripeClient) throw new AppError("STRIPE_SECRET_KEY non configurata", 500, "STRIPE_CLIENT_MISSING");

    const expectedSubscriptionId = stripeSubscriptionIdFromObject(source);
    if (!expectedSubscriptionId) return null;

    const eventCustomerId = stripeId(source.customer);
    const eventTenantId = await this.resolveAuthoritativeTenantId(source, {
      fallbackCustomerId: eventCustomerId,
      fallbackSubscriptionId: expectedSubscriptionId,
      fallbackMetadata: metadataFromObject(source)
    });
    if (!eventTenantId) return null;

    let expectedCurrent = await this.deps.findSubscriptionByTenantId(eventTenantId);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const subscription = await this.stripeClient.subscriptions.retrieve(expectedSubscriptionId);
      const authoritativeSource = subscription as unknown as Record<string, unknown>;
      if (stripeId(authoritativeSource.id) !== expectedSubscriptionId) return null;

      const authoritativeCustomerId = stripeId(authoritativeSource.customer);
      if (eventCustomerId && authoritativeCustomerId && eventCustomerId !== authoritativeCustomerId) return null;

      const applied = await this.applyStripeObject(
        authoritativeSource,
        stripeStatusToLicense(String(authoritativeSource.status ?? "")),
        {
          fallbackTenantId: eventTenantId,
          fallbackCustomerId: eventCustomerId,
          fallbackSubscriptionId: expectedSubscriptionId,
          fallbackMetadata: metadataFromObject(source)
        },
        {
          eventType,
          expectedSubscriptionId,
          expectedCurrent,
          notificationSource: source
        }
      );
      if (applied?.reason !== "STALE_SNAPSHOT") return applied;
      expectedCurrent = await this.deps.findSubscriptionByTenantId(eventTenantId);
    }

    throw new AppError(
      "Sincronizzazione abbonamento Stripe concorrente",
      503,
      "STRIPE_SUBSCRIPTION_SYNC_CONFLICT"
    );
  }

  private async resolveAuthoritativeTenantId(source: Record<string, unknown>, fallback?: {
    fallbackTenantId?: string | null;
    fallbackCustomerId?: string | null;
    fallbackSubscriptionId?: string | null;
    fallbackMetadata?: Record<string, unknown>;
  }) {
    const metadata = {
      ...(fallback?.fallbackMetadata ?? {}),
      ...(typeof source.metadata === "object" && source.metadata ? source.metadata as Record<string, unknown> : {})
    };
    const metadataTenantId = typeof metadata.tenantId === "string" && metadata.tenantId.trim()
      ? metadata.tenantId.trim()
      : null;
    const fallbackTenantId = fallback?.fallbackTenantId?.trim() || null;
    const subscriptionId = stripeSubscriptionIdFromObject(source) ?? fallback?.fallbackSubscriptionId ?? null;
    const customerId = stripeId(source.customer) ?? fallback?.fallbackCustomerId ?? null;
    const [subscriptionBinding, customerBinding] = await Promise.all([
      subscriptionId ? this.deps.findSubscriptionByStripeSubscriptionId(subscriptionId) : Promise.resolve(null),
      customerId ? this.deps.findSubscriptionByStripeCustomerId(customerId) : Promise.resolve(null)
    ]);
    const boundTenantId = subscriptionBinding?.tenantId ?? customerBinding?.tenantId ?? null;

    if (subscriptionBinding && customerBinding && subscriptionBinding.tenantId !== customerBinding.tenantId) return null;
    if (boundTenantId && metadataTenantId && boundTenantId !== metadataTenantId) return null;
    if (boundTenantId && fallbackTenantId && boundTenantId !== fallbackTenantId) return null;
    if (metadataTenantId && fallbackTenantId && metadataTenantId !== fallbackTenantId) return null;

    return boundTenantId ?? metadataTenantId ?? fallbackTenantId;
  }

  private async canCheckoutReplaceSubscription(
    current: TenantSubscriptionSnapshot | null,
    candidate: Record<string, unknown>,
    candidateSubscriptionId: string
  ) {
    if (
      !current ||
      current.provider !== "stripe" ||
      !current.stripeSubscriptionId ||
      current.stripeSubscriptionId === candidateSubscriptionId
    ) {
      return false;
    }

    if (MANAGED_STRIPE_SUBSCRIPTION_STATUSES.has(current.status)) return false;
    if (!this.stripeClient) return false;

    const candidateCreatedAt = Number(candidate.created);
    if (!Number.isFinite(candidateCreatedAt) || candidateCreatedAt <= 0) return false;

    const currentSubscription = await this.stripeClient.subscriptions.retrieve(current.stripeSubscriptionId);
    const currentCreatedAt = Number((currentSubscription as unknown as Record<string, unknown>).created);
    if (!Number.isFinite(currentCreatedAt) || currentCreatedAt <= 0) return false;

    // Stripe timestamps have one-second precision. An equal timestamp is
    // ambiguous, so retain the already persisted identity for manual retry.
    return candidateCreatedAt > currentCreatedAt;
  }

  private checkoutAnalyticsMetadata(input?: CheckoutAnalyticsInput) {
    if (!input) return {};
    return compactMetadata({
      analyticsConsent: input.visitorId || input.sessionId ? "true" : undefined,
      analyticsVisitorIdHash: input.visitorId ? privacyHash(input.visitorId) : undefined,
      analyticsSessionIdHash: input.sessionId ? privacyHash(input.sessionId) : undefined,
      analyticsReferrer: trimMetadataValue(input.referrer),
      utmSource: trimMetadataValue(input.utmSource, 120),
      utmMedium: trimMetadataValue(input.utmMedium, 120),
      utmCampaign: trimMetadataValue(input.utmCampaign, 160),
      utmContent: trimMetadataValue(input.utmContent, 160),
      utmTerm: trimMetadataValue(input.utmTerm, 160)
    });
  }

  private async recordCheckoutFunnelEvent(
    eventType: "STRIPE_CHECKOUT_COMPLETED" | "TRIAL_ACTIVATED",
    session: Stripe.Checkout.Session & Record<string, unknown>,
    details: Record<string, unknown>
  ) {
    const metadata = metadataFromObject(session);
    if (metadata.analyticsConsent !== "true") return;

    await this.deps.recordWebsiteEvent({
      eventType: eventType as Prisma.WebsiteEventUncheckedCreateInput["eventType"],
      path: "/activate",
      referrer: metadata.analyticsReferrer || "https://checkout.stripe.com",
      utmSource: metadata.utmSource || undefined,
      utmMedium: metadata.utmMedium || undefined,
      utmCampaign: metadata.utmCampaign || undefined,
      utmContent: metadata.utmContent || undefined,
      utmTerm: metadata.utmTerm || undefined,
      consentAnalytics: true,
      visitorId: metadata.analyticsVisitorIdHash || undefined,
      sessionId: metadata.analyticsSessionIdHash || undefined,
      metadata: jsonPayload({
        ...details,
        tenantId: metadata.tenantId,
        plan: metadata.plan,
        billingCycle: metadata.billingCycle,
        source: "stripe_webhook"
      })
    });
  }

  private async applyStripeObject(source: Record<string, unknown>, status: BillingLicenseStatus, fallback?: {
    fallbackTenantId?: string | null;
    fallbackCustomerId?: string | null;
    fallbackSubscriptionId?: string | null;
    fallbackMetadata?: Record<string, unknown>;
  }, options?: StripeApplyOptions): Promise<StripeApplyResult | null> {
    const metadata = {
      ...(fallback?.fallbackMetadata ?? {}),
      ...(typeof source.metadata === "object" && source.metadata ? source.metadata as Record<string, unknown> : {})
    };
    const tenantId = await this.resolveAuthoritativeTenantId(source, fallback);
    if (!tenantId) return null;

    const current = options && Object.prototype.hasOwnProperty.call(options, "expectedCurrent")
      ? options.expectedCurrent ?? null
      : await this.deps.findSubscriptionByTenantId(tenantId);
    // Customer Portal can change the subscription price without changing historical metadata.
    const priceSelection = resolvePlanAndCycleFromStripePrice(source);
    const plan = priceSelection?.plan ?? ensureKnownPlan(String(metadata.plan ?? current?.plan ?? "STARTER"));
    const billingCycle = priceSelection?.billingCycle ?? normalizeBillingCycle(String(metadata.billingCycle ?? current?.billingCycle ?? "monthly"));
    const currentPeriodEnd = source.current_period_end ?? getNested(source, "lines.data.0.period.end");
    const expiresAt = unixToIso(currentPeriodEnd) ?? current?.expiresAt ?? null;
    const customerId = stripeId(source.customer) ?? fallback?.fallbackCustomerId ?? current?.stripeCustomerId ?? null;
    const subscriptionId = options?.expectedSubscriptionId
      ?? stripeSubscriptionIdFromObject(source)
      ?? fallback?.fallbackSubscriptionId
      ?? current?.stripeSubscriptionId
      ?? null;
    if (!subscriptionId) return null;

    const nextPayload: LicenseAuditPayload = {
      plan,
      seats: current?.seats ?? 3,
      status,
      expiresAt,
      priceMonthly: priceSelection ? getPlanMonthlyPrice(plan) : current?.priceMonthly ?? getPlanMonthlyPrice(plan),
      billingCycle,
      stripeCustomerId: customerId,
      stripeSubscriptionId: subscriptionId,
      provider: "stripe",
      updatedAt: new Date().toISOString()
    };

    const mutation = await this.writeLicense(tenantId, null, nextPayload, current, {
      stripeSubscriptionId: subscriptionId,
      stripeCustomerId: customerId,
      allowSubscriptionReplacement: options?.allowSubscriptionReplacement,
      expectedCurrent: current
    });
    if (!mutation.applied) {
      return {
        tenantId,
        previousStatus: mutation.previous?.status ?? null,
        nextStatus: status,
        applied: false,
        reason: mutation.reason
      };
    }

    const notificationSource = options?.notificationSource ?? source;
    const notificationSourceObject = typeof notificationSource.object === "string" ? notificationSource.object : null;
    await this.notifyBillingTransition({
      tenantId,
      eventType: options?.eventType,
      previous: mutation.previous,
      next: nextPayload,
      stripeInvoiceId: notificationSourceObject === "invoice" ? stripeId(notificationSource.id) : null,
      hostedInvoiceUrl: notificationSourceObject === "invoice" && typeof notificationSource.hosted_invoice_url === "string"
        ? notificationSource.hosted_invoice_url
        : null
    });

    return { tenantId, previousStatus: mutation.previous?.status ?? null, nextStatus: status, applied: true };
  }

  private async notifyBillingTransition(input: {
    tenantId: string;
    eventType?: string;
    previous: TenantSubscriptionSnapshot | null;
    next: LicenseAuditPayload;
    stripeInvoiceId?: string | null;
    hostedInvoiceUrl?: string | null;
  }) {
    const previousStatus = input.previous?.status ?? null;
    const payload: BillingLifecycleEmailInput = {
      tenantId: input.tenantId,
      plan: input.next.plan,
      billingCycle: input.next.billingCycle,
      previousStatus,
      nextStatus: input.next.status,
      expiresAt: input.next.expiresAt,
      stripeCustomerId: input.next.stripeCustomerId,
      stripeSubscriptionId: input.next.stripeSubscriptionId,
      stripeInvoiceId: input.stripeInvoiceId,
      hostedInvoiceUrl: input.hostedInvoiceUrl,
      graceDays: env.BILLING_PAST_DUE_GRACE_DAYS
    };

    if (input.next.status === "PAST_DUE" && previousStatus !== "PAST_DUE") {
      await this.safeNotify("BILLING_PAYMENT_FAILED", input.tenantId, () =>
        this.lifecycleNotifier.notifyPaymentFailed(payload)
      );
      return;
    }

    if (input.next.status === "SUSPENDED" && previousStatus !== "SUSPENDED") {
      await this.safeNotify("BILLING_SUBSCRIPTION_SUSPENDED", input.tenantId, () =>
        this.lifecycleNotifier.notifySubscriptionSuspended(payload)
      );
      return;
    }

    if (input.next.status === "CANCELED" && previousStatus !== "CANCELED") {
      await this.safeNotify("BILLING_SUBSCRIPTION_CANCELED", input.tenantId, () =>
        this.lifecycleNotifier.notifySubscriptionCanceled(payload)
      );
      return;
    }

    if ((input.next.status === "ACTIVE" || input.next.status === "TRIAL") && previousStatus && ["PAST_DUE", "SUSPENDED", "EXPIRED", "CANCELED"].includes(previousStatus)) {
      await this.safeNotify("BILLING_SUBSCRIPTION_REACTIVATED", input.tenantId, () =>
        this.lifecycleNotifier.notifySubscriptionReactivated(payload)
      );
    }
  }

  private async safeNotify(action: string, tenantId: string, callback: () => Promise<void>) {
    try {
      await callback();
    } catch (error) {
      logger.warn({ error, tenantId, action }, "Billing lifecycle notification failed");
      await this.auditRepository.create({
        tenantId,
        userId: null,
        action: "BILLING_NOTIFICATION_FAILED",
        resource: "billing",
        resourceId: tenantId,
        details: { action }
      }).catch(() => undefined);
    }
  }

  private async writeLicense(
    tenantId: string,
    userId: string | null,
    next: LicenseAuditPayload,
    previous?: TenantSubscriptionSnapshot | null,
    stripeGuard?: StripeTenantSubscriptionGuard
  ): Promise<StripeTenantSubscriptionMutationResult> {
    const input: TenantSubscriptionUpsertInput = {
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
    };
    const mutation = stripeGuard
      ? await this.deps.upsertStripeSubscriptionIfCurrent(input, stripeGuard)
      : {
          applied: true,
          previous: previous ?? null,
          subscription: await this.deps.upsertSubscription(input)
        };
    if (!mutation.applied || !mutation.subscription) return mutation;

    const persistedPrevious = mutation.previous ?? previous ?? null;

    await this.auditRepository.create({
      tenantId,
      userId,
      action: "PLATFORM_LICENSE_UPDATED",
      resource: "tenant",
      resourceId: tenantId,
      details: {
        source: "billing",
        persisted: true,
        before: persistedPrevious
          ? {
              plan: persistedPrevious.plan,
              seats: persistedPrevious.seats,
              status: persistedPrevious.status,
              expiresAt: persistedPrevious.expiresAt,
              priceMonthly: persistedPrevious.priceMonthly,
              billingCycle: persistedPrevious.billingCycle,
              provider: persistedPrevious.provider,
              stripeCustomerId: persistedPrevious.stripeCustomerId,
              stripeSubscriptionId: persistedPrevious.stripeSubscriptionId
            }
          : null,
        after: {
          ...next,
          subscription: mutation.subscription
        }
      }
    });

    return mutation;
  }
}
