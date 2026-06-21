import { prisma } from "../../infrastructure/database/prisma/client.js";
import { env } from "../../shared/config/env.js";
import { AppError } from "../../shared/errors/app-error.js";
import { estimateLicenseMonthlyRevenue, getPlanMonthlyPrice, SAAS_PLANS } from "./feature-entitlements-service.js";

type LicenseSnapshot = {
  plan: string;
  seats: number;
  status: "PENDING" | "ACTIVE" | "SUSPENDED" | "EXPIRED" | "TRIAL" | "PAST_DUE" | "CANCELED";
  expiresAt: string | null;
  priceMonthly?: number | null;
  billingCycle?: "monthly" | "yearly";
};

const defaultLicense: LicenseSnapshot = {
  plan: "STARTER",
  seats: 3,
  status: "PENDING",
  expiresAt: null,
  priceMonthly: null,
  billingCycle: "monthly"
};

const daysAgo = (days: number) => new Date(Date.now() - days * 24 * 60 * 60 * 1000);

const toDayKey = (date: Date) => date.toISOString().slice(0, 10);

const money = (value: number) => Number(value.toFixed(2));

const pct = (part: number, total: number) => (total > 0 ? Number(((part / total) * 100).toFixed(1)) : 0);

const parseLicense = (details: unknown): LicenseSnapshot | null => {
  if (!details || typeof details !== "object") return null;
  const payload = details as Record<string, unknown>;
  const source = payload.after && typeof payload.after === "object" ? (payload.after as Record<string, unknown>) : payload;
  const status = String(source.status ?? "PENDING") as LicenseSnapshot["status"];
  return {
    plan: String(source.plan ?? "STARTER"),
    seats: Number(source.seats ?? 3),
    status,
    expiresAt: source.expiresAt ? String(source.expiresAt) : null,
    priceMonthly:
      Number.isFinite(Number(source.priceMonthly)) && Number(source.priceMonthly) > 0
        ? Number(source.priceMonthly)
        : null,
    billingCycle: source.billingCycle === "yearly" ? "yearly" : "monthly"
  };
};

const compactEmail = (value?: string | null) => {
  if (!value) return null;
  const [name, domain] = value.split("@");
  if (!domain) return value;
  return `${name.slice(0, 2)}***@${domain}`;
};

export class PlatformConsoleService {
  private async latestLicenses() {
    const subscriptions = await prisma.tenantSubscription.findMany({
      select: {
        tenantId: true,
        plan: true,
        seats: true,
        status: true,
        currentPeriodEnd: true,
        trialEndsAt: true,
        priceMonthly: true,
        billingCycle: true
      }
    });

    const map = new Map<string, LicenseSnapshot>();
    subscriptions.forEach((subscription) => {
      map.set(subscription.tenantId, {
        plan: subscription.plan,
        seats: subscription.seats,
        status: String(subscription.status ?? "ACTIVE") as LicenseSnapshot["status"],
        expiresAt: (subscription.currentPeriodEnd ?? subscription.trialEndsAt)?.toISOString() ?? null,
        priceMonthly:
          Number.isFinite(Number(subscription.priceMonthly)) && Number(subscription.priceMonthly) > 0
            ? Number(subscription.priceMonthly)
            : null,
        billingCycle: subscription.billingCycle === "yearly" ? "yearly" : "monthly"
      });
    });

    const rows = await prisma.auditLog.findMany({
      where: { action: "PLATFORM_LICENSE_UPDATED", resource: "tenant", resourceId: { not: null } },
      orderBy: { createdAt: "desc" },
      select: { resourceId: true, details: true }
    });

    rows.forEach((row) => {
      if (!row.resourceId || map.has(row.resourceId)) return;
      map.set(row.resourceId, parseLicense(row.details) ?? defaultLicense);
    });
    return map;
  }

  private async revenueSnapshot() {
    const tenants = await prisma.tenant.findMany({
      where: { deletedAt: null },
      select: { id: true, isActive: true }
    });
    const licenses = await this.latestLicenses();
    const byPlan = Object.fromEntries(SAAS_PLANS.map((plan) => [plan, { tenants: 0, mrr: 0 }])) as Record<
      (typeof SAAS_PLANS)[number],
      { tenants: number; mrr: number }
    >;

    let mrrTotal = 0;
    let suspended = 0;
    let trial = 0;
    let expiringSoon = 0;
    const now = Date.now();

    tenants.forEach((tenant) => {
      const license = licenses.get(tenant.id) ?? defaultLicense;
      const plan = SAAS_PLANS.includes(license.plan as any) ? (license.plan as (typeof SAAS_PLANS)[number]) : "STARTER";
      if (license.status === "PENDING" || license.status === "SUSPENDED" || license.status === "EXPIRED" || license.status === "PAST_DUE" || license.status === "CANCELED") {
        suspended += 1;
      }
      if (license.status === "TRIAL") trial += 1;
      if (license.expiresAt) {
        const delta = new Date(license.expiresAt).getTime() - now;
        if (delta >= 0 && delta <= 7 * 24 * 60 * 60 * 1000) expiringSoon += 1;
      }
      const estimated = estimateLicenseMonthlyRevenue({
        plan,
        seats: license.seats,
        priceMonthly: license.priceMonthly ?? getPlanMonthlyPrice(plan),
        billingCycle: license.billingCycle ?? "monthly"
      });
      byPlan[plan].tenants += 1;
      if (tenant.isActive && license.status === "ACTIVE") {
        byPlan[plan].mrr += estimated.estimatedMrr;
        mrrTotal += estimated.estimatedMrr;
      }
    });

    return {
      mrrTotal: money(mrrTotal),
      suspended,
      trial,
      expiringSoon,
      byPlan: Object.fromEntries(
        Object.entries(byPlan).map(([plan, row]) => [plan, { tenants: row.tenants, mrr: money(row.mrr) }])
      )
    };
  }

  async overview(days = 30) {
    const since = daysAgo(days);
    const [tenantsTotal, activeTenants, demoRequests, signups, pageViews, invoicesToSend, invoiceErrors, emailErrors, recentAudit, revenue] =
      await Promise.all([
        prisma.tenant.count({ where: { deletedAt: null } }),
        prisma.tenant.count({ where: { deletedAt: null, isActive: true } }),
        prisma.demoLead.count({ where: { createdAt: { gte: since } } }),
        prisma.user.count({ where: { deletedAt: null, createdAt: { gte: since } } }),
        prisma.websiteEvent.count({ where: { eventType: "PAGE_VIEW", createdAt: { gte: since } } }),
        prisma.invoice.count({ where: { deletedAt: null, status: "GENERATED" } }),
        prisma.invoice.count({ where: { deletedAt: null, status: "ERROR" } }),
        prisma.emailQueue.count({ where: { status: "FAILED", updatedAt: { gte: since } } }),
        prisma.auditLog.findMany({
          orderBy: { createdAt: "desc" },
          take: 8,
          include: { tenant: { select: { name: true } } }
        }),
        this.revenueSnapshot()
      ]);

    return {
      data: {
        generatedAt: new Date().toISOString(),
        windowDays: days,
        kpis: {
          tenantsTotal,
          activeTenants,
          trialActive: revenue.trial,
          trialExpiring: revenue.expiringSoon,
          suspendedLicenses: revenue.suspended,
          mrrEstimated: revenue.mrrTotal,
          demoRequests,
          signups,
          websiteVisits: pageViews,
          visitToDemoRate: pct(demoRequests, pageViews),
          invoicesToSend,
          invoiceErrors,
          emailErrors
        },
        revenueByPlan: revenue.byPlan,
        alerts: [
          ...(invoiceErrors > 0 ? [{ type: "INVOICE_ERRORS", severity: "HIGH", label: `${invoiceErrors} fatture in errore` }] : []),
          ...(emailErrors > 0 ? [{ type: "EMAIL_ERRORS", severity: "HIGH", label: `${emailErrors} email fallite negli ultimi ${days} giorni` }] : []),
          ...(revenue.expiringSoon > 0 ? [{ type: "TRIAL_EXPIRING", severity: "MEDIUM", label: `${revenue.expiringSoon} licenze/trial in scadenza` }] : [])
        ],
        recentAudit: recentAudit.map((event) => ({
          id: event.id,
          tenantId: event.tenantId,
          tenantName: event.tenant.name,
          action: event.action,
          resource: event.resource,
          resourceId: event.resourceId,
          createdAt: event.createdAt.toISOString()
        }))
      }
    };
  }

  async dashboardLiveMetrics(windowMinutes = 15) {
    const now = new Date();
    const since = new Date(now.getTime() - windowMinutes * 60 * 1000);
    const previousSince = new Date(since.getTime() - windowMinutes * 60 * 1000);
    const [activeSessions, previousSessions, revenue] = await Promise.all([
      prisma.refreshSession.findMany({
        where: { revokedAt: null, expiresAt: { gt: now }, updatedAt: { gte: since } },
        select: { tenantId: true }
      }),
      prisma.refreshSession.count({
        where: { revokedAt: null, expiresAt: { gt: now }, updatedAt: { gte: previousSince, lt: since } }
      }),
      this.revenueSnapshot()
    ]);
    const byTenant = new Map<string, number>();
    activeSessions.forEach((session) => byTenant.set(session.tenantId, (byTenant.get(session.tenantId) ?? 0) + 1));
    const topTenants = await prisma.tenant.findMany({
      where: { id: { in: [...byTenant.keys()] } },
      select: { id: true, name: true }
    });

    return {
      generatedAt: now.toISOString(),
      liveWindowMinutes: windowMinutes,
      activeUsersLive: activeSessions.length,
      previousWindowActiveUsers: previousSessions,
      deltaFromPreviousWindow: activeSessions.length - previousSessions,
      activeTenantsLive: byTenant.size,
      topTenants: topTenants
        .map((tenant) => ({ tenantId: tenant.id, tenantName: tenant.name, activeUsers: byTenant.get(tenant.id) ?? 0 }))
        .sort((a, b) => b.activeUsers - a.activeUsers)
        .slice(0, 6),
      mrrMonthly: revenue.mrrTotal,
      mrrLost: 0,
      mrrDeltaFromPrevious: 0,
      month: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`
    };
  }

  async websiteAnalytics(days = 30) {
    const since = daysAgo(days);
    const events = await prisma.websiteEvent.findMany({
      where: { createdAt: { gte: since } },
      orderBy: { createdAt: "asc" },
      take: 15_000,
      select: {
        eventType: true,
        path: true,
        referrer: true,
        deviceType: true,
        browser: true,
        sessionId: true,
        ipHash: true,
        createdAt: true
      }
    });

    const byDay = new Map<string, { date: string; pageViews: number; ctaClicks: number; demoSubmits: number; signups: number }>();
    const eventCounts = new Map<string, number>();
    const pathCounts = new Map<string, number>();
    const referrerCounts = new Map<string, number>();
    const deviceCounts = new Map<string, number>();
    const browserCounts = new Map<string, number>();
    const uniqueKeys = new Set<string>();

    events.forEach((event) => {
      const key = toDayKey(event.createdAt);
      const day = byDay.get(key) ?? { date: key, pageViews: 0, ctaClicks: 0, demoSubmits: 0, signups: 0 };
      if (event.eventType === "PAGE_VIEW") day.pageViews += 1;
      if (event.eventType === "CTA_CLICK") day.ctaClicks += 1;
      if (event.eventType === "DEMO_FORM_SUBMIT") day.demoSubmits += 1;
      if (event.eventType === "SIGNUP_COMPLETED") day.signups += 1;
      byDay.set(key, day);
      eventCounts.set(event.eventType, (eventCounts.get(event.eventType) ?? 0) + 1);
      if (event.eventType === "PAGE_VIEW") pathCounts.set(event.path, (pathCounts.get(event.path) ?? 0) + 1);
      if (event.referrer) referrerCounts.set(event.referrer, (referrerCounts.get(event.referrer) ?? 0) + 1);
      if (event.deviceType) deviceCounts.set(event.deviceType, (deviceCounts.get(event.deviceType) ?? 0) + 1);
      if (event.browser) browserCounts.set(event.browser, (browserCounts.get(event.browser) ?? 0) + 1);
      uniqueKeys.add(event.sessionId ?? event.ipHash ?? `${event.path}:${event.createdAt.toISOString()}`);
    });

    const top = (map: Map<string, number>, limit = 8) =>
      [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([label, value]) => ({ label, value }));

    const pageViews = eventCounts.get("PAGE_VIEW") ?? 0;
    const demoSubmits = eventCounts.get("DEMO_FORM_SUBMIT") ?? 0;
    const signupStarted = eventCounts.get("SIGNUP_STARTED") ?? 0;
    const signupCompleted = eventCounts.get("SIGNUP_COMPLETED") ?? 0;

    return {
      data: {
        generatedAt: new Date().toISOString(),
        windowDays: days,
        totals: {
          events: events.length,
          pageViews,
          uniqueVisitors: uniqueKeys.size,
          ctaClicks: eventCounts.get("CTA_CLICK") ?? 0,
          demoSubmits,
          signupStarted,
          signupCompleted,
          visitToDemoRate: pct(demoSubmits, pageViews),
          demoToSignupRate: pct(signupCompleted, demoSubmits),
          visitToSignupRate: pct(signupCompleted, pageViews),
          signupStartToCompletionRate: pct(signupCompleted, signupStarted)
        },
        trend: [...byDay.values()],
        topPages: top(pathCounts),
        topReferrers: top(referrerCounts),
        deviceBreakdown: top(deviceCounts),
        browserBreakdown: top(browserCounts),
        eventCounts: Object.fromEntries(eventCounts)
      }
    };
  }

  async listDemoLeads() {
    const leads = await prisma.demoLead.findMany({
      orderBy: { createdAt: "desc" },
      take: 100
    });
    return {
      data: leads.map((lead) => ({
        ...lead,
        createdAt: lead.createdAt.toISOString(),
        updatedAt: lead.updatedAt.toISOString(),
        contactedAt: lead.contactedAt?.toISOString() ?? null,
        archivedAt: lead.archivedAt?.toISOString() ?? null,
        emailMasked: compactEmail(lead.email)
      }))
    };
  }

  async updateDemoLead(input: { id: string; status: "NEW" | "CONTACTED" | "QUALIFIED" | "WON" | "LOST" | "SPAM" }) {
    const existing = await prisma.demoLead.findUnique({ where: { id: input.id } });
    if (!existing) throw new AppError("Lead demo non trovato", 404, "NOT_FOUND");
    const data = {
      status: input.status,
      contactedAt: ["CONTACTED", "QUALIFIED", "WON"].includes(input.status) && !existing.contactedAt ? new Date() : existing.contactedAt,
      archivedAt: ["LOST", "SPAM"].includes(input.status) && !existing.archivedAt ? new Date() : existing.archivedAt
    };
    const lead = await prisma.demoLead.update({ where: { id: input.id }, data });
    return { data: { ...lead, createdAt: lead.createdAt.toISOString(), updatedAt: lead.updatedAt.toISOString() } };
  }

  async systemHealth() {
    const started = Date.now();
    let dbStatus: "UP" | "DOWN" = "UP";
    try {
      await prisma.$queryRaw`SELECT 1`;
    } catch {
      dbStatus = "DOWN";
    }

    const [pendingEmail, failedEmail, invoiceErrors] = await Promise.all([
      prisma.emailQueue.count({ where: { status: "PENDING" } }),
      prisma.emailQueue.count({ where: { status: "FAILED" } }),
      prisma.invoice.count({ where: { status: "ERROR" } })
    ]);

    return {
      data: {
        generatedAt: new Date().toISOString(),
        api: { status: "UP", responseTimeMs: Date.now() - started },
        db: { status: dbStatus },
        email: {
          status: env.EMAIL_PROVIDER === "resend" ? (env.RESEND_API_KEY ? "CONFIGURED" : "MISSING_KEY") : "SMTP",
          provider: env.EMAIL_PROVIDER,
          pending: pendingEmail,
          failed: failedEmail
        },
        stripe: {
          status: env.STRIPE_SECRET_KEY ? "CONFIGURED" : "NOT_CONFIGURED"
        },
        storage: {
          status: "LOCAL",
          uploadDir: env.UPLOAD_DIR
        },
        invoices: {
          errors: invoiceErrors
        }
      }
    };
  }

  async securityOverview() {
    const [blockedLoginStates, recentPlatformEvents] = await Promise.all([
      prisma.loginRateLimitState.count({ where: { scope: { contains: "platform" }, blockedUntil: { gt: new Date() } } }).catch(() => 0),
      prisma.auditLog.findMany({
        where: {
          OR: [
            { action: { startsWith: "PLATFORM_" } },
            { action: { contains: "INVOICE" } }
          ]
        },
        orderBy: { createdAt: "desc" },
        take: 25,
        include: { tenant: { select: { name: true } } }
      })
    ]);

    return {
      data: {
        generatedAt: new Date().toISOString(),
        auth: {
          otpEmail: compactEmail(env.PLATFORM_ADMIN_EMAIL),
          tokenTtl: env.PLATFORM_JWT_EXPIRES_IN,
          blockedLoginStates
        },
        controls: {
          ipAllowlist: env.PLATFORM_ALLOWED_IPS_CSV ? "CONFIGURED" : "NOT_CONFIGURED",
          corsOrigin: env.PLATFORM_CORS_ORIGIN
        },
        recentEvents: recentPlatformEvents.map((event) => ({
          id: event.id,
          action: event.action,
          tenantName: event.tenant.name,
          createdAt: event.createdAt.toISOString(),
          resource: event.resource,
          resourceId: event.resourceId
        }))
      }
    };
  }
}
