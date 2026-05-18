import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import {
  PLAN_MONTHLY_PRICING_EUR,
  SAAS_PLANS,
  ensureKnownPlan,
  estimateLicenseMonthlyRevenue,
  getFeatureListForPlan,
  getPlanMonthlyPrice
} from "./feature-entitlements-service.js";
import {
  PlatformAdminRepository,
  PlatformLicense,
  PlatformLicenseStatus
} from "../../domain/repositories/platform-admin-repository.js";
import { emailSender } from "../../infrastructure/email/email-sender.js";
import { env } from "../../shared/config/env.js";
import { AppError } from "../../shared/errors/app-error.js";
import { PlatformAlertService } from "./platform-alert-service.js";
import { PlatformLoginGuardService } from "./platform-login-guard-service.js";

type QuickAction =
  | "ACTIVATE_LICENSE"
  | "SUSPEND_LICENSE"
  | "TRIAL_14_DAYS"
  | "RENEW_30_DAYS"
  | "RENEW_365_DAYS"
  | "DEACTIVATE_TENANT"
  | "REACTIVATE_TENANT";

type SaasPlan = (typeof SAAS_PLANS)[number];

type BreakdownRow = {
  plan: SaasPlan;
  basePrice: number;
  activeTenants: number;
  totalTenants: number;
  seatsTotal: number;
  estimatedRevenue: number;
};

type Snapshot = {
  month: string;
  mrrTotal: number;
  mrrLost: number;
  mrrByPlan: Record<SaasPlan, number>;
  tenantsByPlan: Record<SaasPlan, number>;
  breakdown: BreakdownRow[];
};

const defaultLicense: PlatformLicense = {
  plan: "STARTER",
  seats: 3,
  status: "ACTIVE",
  expiresAt: null,
  updatedAt: undefined,
  priceMonthly: null,
  billingCycle: "monthly"
};

const addDaysIso = (base: Date, days: number) => {
  const next = new Date(base.getTime() + days * 24 * 60 * 60 * 1000);
  return next.toISOString();
};

const toMonthStart = (month?: string) => {
  if (month && /^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
    const [year, m] = month.split("-").map(Number);
    return new Date(Date.UTC(year, (m ?? 1) - 1, 1, 0, 0, 0, 0));
  }
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0));
};

const toMonthEnd = (start: Date) =>
  new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0, 23, 59, 59, 999));

const shiftMonth = (start: Date, diff: number) =>
  new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + diff, 1, 0, 0, 0, 0));

const toMonthKey = (value: Date) => `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, "0")}`;

const money = (value: number) => Number(value.toFixed(2));

const csvEscape = (value: unknown) => {
  const raw = String(value ?? "");
  const formulaSafe = /^[\s]*[=+\-@]/.test(raw) ? `'${raw}` : raw;
  return `"${formulaSafe.replace(/"/g, '""')}"`;
};

const hashForSafeCompare = (value: string) => crypto.createHash("sha256").update(value).digest();

const constantTimeEqual = (left: string, right: string) => {
  const leftHash = hashForSafeCompare(left);
  const rightHash = hashForSafeCompare(right);
  return crypto.timingSafeEqual(leftHash, rightHash);
};

const PLATFORM_OTP_TTL_MS = 8 * 60 * 1000;
const platformOtpChallenges = new Map<string, { codeHash: string; expiresAt: number; attempts: number }>();

const maskEmail = (email: string) => email.replace(/^(.{2}).*(@.*)$/, "$1***$2");

const createOtpCode = () => crypto.randomInt(100_000, 1_000_000).toString();

const createOtpKey = (email: string) => email;

const platformOtpEmailHtml = (code: string) => `
  <div style="margin:0;padding:0;background:#07111f;font-family:Inter,Manrope,Arial,sans-serif;color:#e6ecf2;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:radial-gradient(circle at 20% 0%,rgba(37,99,255,.35),transparent 34rem),radial-gradient(circle at 80% 8%,rgba(0,184,169,.22),transparent 30rem),#07111f;padding:40px 16px;">
      <tr><td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:620px;border:1px solid rgba(230,236,242,.14);border-radius:28px;overflow:hidden;background:linear-gradient(180deg,rgba(255,255,255,.08),rgba(255,255,255,.035));box-shadow:0 28px 90px rgba(0,0,0,.38);">
          <tr><td style="padding:30px 32px 12px;">
            <div style="display:inline-block;border:1px solid rgba(75,140,255,.38);border-radius:999px;background:rgba(37,99,255,.16);padding:8px 12px;font-size:12px;letter-spacing:.20em;text-transform:uppercase;color:#ffffff;font-weight:900;">Fleetum Platform Console</div>
            <h1 style="margin:16px 0 10px;font-size:30px;line-height:1.1;letter-spacing:-.04em;color:#fff;">Codice di verifica amministratore</h1>
            <p style="margin:0;color:#a7b3c7;font-size:15px;line-height:1.65;">Usa questo codice per completare l'accesso alla Platform Console founder-only. Il codice scade tra 8 minuti.</p>
          </td></tr>
          <tr><td style="padding:18px 32px 28px;">
            <div style="border:1px solid rgba(50,221,209,.28);border-radius:22px;background:rgba(5,12,24,.72);padding:24px;text-align:center;">
              <div style="font-size:13px;text-transform:uppercase;letter-spacing:.22em;color:#8ea3c4;font-weight:800;">OTP</div>
              <div style="margin-top:10px;font-size:42px;letter-spacing:.20em;color:#fff;font-weight:900;font-family:Menlo,Consolas,monospace;">${code}</div>
            </div>
          </td></tr>
          <tr><td style="padding:0 32px 32px;">
            <p style="margin:0;color:#7f8da6;font-size:13px;line-height:1.6;">Se non sei stato tu, cambia subito la password platform e verifica i log di accesso. Non inoltrare questo codice.</p>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </div>
`;

export class PlatformAdminService {
  constructor(
    private readonly repository: PlatformAdminRepository,
    private readonly alerts: PlatformAlertService,
    private readonly loginGuard: PlatformLoginGuardService
  ) {}

  async login(input: { email: string; password: string; ip: string; otp?: string }) {
    const normalizedEmail = input.email.trim().toLowerCase();
    await this.loginGuard.assertAllowed(input.ip, normalizedEmail);

    const emailOk = constantTimeEqual(normalizedEmail, env.PLATFORM_ADMIN_EMAIL.trim().toLowerCase());
    const passwordOk = constantTimeEqual(input.password, env.PLATFORM_ADMIN_PASSWORD);

    if (!emailOk || !passwordOk) {
      const failure = await this.loginGuard.registerFailure(input.ip, normalizedEmail);

      if (failure.locked) {
        await this.alerts.notify({
          type: "PLATFORM_LOGIN_LOCKED",
          actor: normalizedEmail,
          sourceIp: input.ip,
          details: `Login locked after ${failure.failures} failures. blockedUntil=${failure.blockedUntil ?? "n/a"}`
        });
      } else if (failure.failures >= Math.max(3, env.PLATFORM_LOGIN_MAX_ATTEMPTS - 1)) {
        await this.alerts.notify({
          type: "PLATFORM_LOGIN_FAILURES",
          actor: normalizedEmail,
          sourceIp: input.ip,
          details: `Repeated failed login attempts: ${failure.failures}`
        });
      }

      throw new AppError("Credenziali platform admin non valide", 401, "UNAUTHORIZED");
    }

    const challengeKey = createOtpKey(normalizedEmail);
    const challenge = platformOtpChallenges.get(challengeKey);

    if (!input.otp) {
      const code = createOtpCode();
      platformOtpChallenges.set(challengeKey, {
        codeHash: crypto.createHash("sha256").update(code).digest("hex"),
        expiresAt: Date.now() + PLATFORM_OTP_TTL_MS,
        attempts: 0
      });

      await emailSender.send({
        to: env.PLATFORM_ADMIN_EMAIL,
        subject: "Codice accesso Platform Console Fleetum",
        text: [
          "Fleetum Platform Console",
          `Codice OTP: ${code}`,
          "Scadenza: 8 minuti.",
          "Se non sei stato tu, verifica subito la sicurezza dell'account platform."
        ].join("\n"),
        html: platformOtpEmailHtml(code),
        fromName: "Fleetum Security"
      });

      return {
        requiresOtp: true,
        message: `Codice di verifica inviato a ${maskEmail(env.PLATFORM_ADMIN_EMAIL)}`
      };
    }

    if (!challenge || challenge.expiresAt < Date.now()) {
      platformOtpChallenges.delete(challengeKey);
      throw new AppError("Codice OTP scaduto. Richiedi un nuovo codice.", 401, "PLATFORM_OTP_EXPIRED");
    }

    if (challenge.attempts >= 5) {
      platformOtpChallenges.delete(challengeKey);
      await this.loginGuard.registerFailure(input.ip, normalizedEmail);
      throw new AppError("Troppi tentativi OTP. Richiedi un nuovo codice.", 401, "PLATFORM_OTP_LOCKED");
    }

    const otpHash = crypto.createHash("sha256").update(input.otp).digest("hex");
    const otpOk = constantTimeEqual(otpHash, challenge.codeHash);

    if (!otpOk) {
      challenge.attempts += 1;
      platformOtpChallenges.set(challengeKey, challenge);
      throw new AppError("Codice OTP non valido", 401, "PLATFORM_OTP_INVALID");
    }

    platformOtpChallenges.delete(challengeKey);

    await this.loginGuard.registerSuccess(input.ip, normalizedEmail);

    const token = jwt.sign(
      {
        userId: "platform-admin",
        tenantId: "platform",
        roles: ["PLATFORM_ADMIN"],
        permissions: ["platform:manage"],
        platformAdmin: true,
        tokenType: "platform"
      },
      env.PLATFORM_JWT_SECRET,
      { expiresIn: env.PLATFORM_JWT_EXPIRES_IN as jwt.SignOptions["expiresIn"] }
    );

    return {
      token,
      user: { id: "platform-admin", email: env.PLATFORM_ADMIN_EMAIL, firstName: "Platform", lastName: "Admin", roles: ["PLATFORM_ADMIN"] }
    };
  }

  async listTenantsWithLicenses() {
    const tenants = await this.repository.listTenants();
    const data = await Promise.all(
      tenants.map(async (tenant) => {
        const owners = tenant.users.filter((u) => u.roles.some((r) => r.role.key === "ADMIN"));
        const latestLicense = (await this.repository.getLatestLicense(tenant.id)) ?? defaultLicense;
        const plan = ensureKnownPlan(latestLicense.plan);
        const license = {
          ...latestLicense,
          plan,
          priceMonthly: latestLicense.priceMonthly ?? getPlanMonthlyPrice(plan),
          billingCycle: latestLicense.billingCycle ?? "monthly"
        };

        return {
          id: tenant.id,
          name: tenant.name,
          company: tenant.tenantProfile
            ? {
                legalName: tenant.tenantProfile.legalName,
                tradeName: tenant.tenantProfile.tradeName,
                vatNumber: tenant.tenantProfile.vatNumber,
                email: tenant.tenantProfile.email,
                phone: tenant.tenantProfile.phone,
                hasLogo: Boolean(tenant.tenantBranding?.logoFilePath),
                profileCompleted: Boolean(tenant.tenantProfile.profileCompletedAt),
                onboardingStatus: tenant.tenantProfile.profileCompletedAt ? "COMPLETE" : "INCOMPLETE"
              }
            : {
                legalName: tenant.name,
                tradeName: tenant.name,
                vatNumber: null,
                email: null,
                phone: null,
                hasLogo: false,
                profileCompleted: false,
                onboardingStatus: "MISSING"
              },
          isActive: tenant.isActive,
          createdAt: tenant.createdAt,
          updatedAt: tenant.updatedAt,
          owner: owners[0]
            ? {
                id: owners[0].id,
                firstName: owners[0].firstName,
                lastName: owners[0].lastName,
                email: owners[0].email,
                status: owners[0].status
              }
            : null,
          usersCount: tenant._count.users,
          vehiclesCount: tenant._count.vehicles,
          stoppagesCount: tenant._count.stoppages,
          license,
          features: getFeatureListForPlan(plan)
        };
      })
    );
    return { data };
  }

  async listRecentEvents(limit: number) {
    const data = await this.repository.listRecentPlatformEvents(limit);
    return { data };
  }

  async listUsersGlobal() {
    const data = await this.repository.listUsersGlobal();
    return { data };
  }

  async tenantCompanyProfile(tenantId: string) {
    const data = await this.repository.getTenantCompanyProfile(tenantId);
    if (!data) throw new AppError("Tenant non trovato", 404, "NOT_FOUND");
    return { data };
  }

  async tenantOnboardingStatus(tenantId: string) {
    const data = (await this.repository.getTenantCompanyProfile(tenantId)) as any;
    if (!data) throw new AppError("Tenant non trovato", 404, "NOT_FOUND");
    const profile = data.tenantProfile;
    const branding = data.tenantBranding;
    const required = ["legalName", "vatNumber", "legalAddress", "city", "province", "postalCode", "email", "phone"];
    const missing = profile ? required.filter((key) => !String(profile[key] ?? "").trim()) : required;
    if (!branding?.logoFilePath) missing.push("logo");
    return {
      data: {
        tenantId,
        status: missing.length === 0 ? "COMPLETE" : "INCOMPLETE",
        profileCompletedAt: profile?.profileCompletedAt ?? null,
        missing,
        percentage: Math.round(((required.length + 1 - missing.length) / (required.length + 1)) * 100)
      }
    };
  }

  async updateLicense(input: {
    tenantId: string;
    actorUserId: string;
    sourceIp: string;
    plan: string;
    seats: number;
    status: PlatformLicenseStatus;
    expiresAt?: string | null;
    priceMonthly?: number | null;
    billingCycle?: "monthly" | "yearly";
  }) {
    const tenant = await this.repository.getTenantById(input.tenantId);
    if (!tenant) throw new AppError("Tenant non trovato", 404, "NOT_FOUND");

    const before = (await this.repository.getLatestLicense(input.tenantId)) ?? defaultLicense;
    const after: PlatformLicense = {
      plan: ensureKnownPlan(input.plan),
      seats: input.seats,
      status: input.status,
      expiresAt: input.expiresAt ?? null,
      updatedAt: new Date().toISOString(),
      priceMonthly: input.priceMonthly === undefined ? (before.priceMonthly ?? null) : input.priceMonthly,
      billingCycle: input.billingCycle ?? before.billingCycle ?? "monthly"
    };

    await this.repository.setLicense(input.tenantId, input.actorUserId, after);
    await this.repository.appendPlatformAudit({
      tenantId: input.tenantId,
      actorUserId: input.actorUserId,
      action: "PLATFORM_LICENSE_UPDATED",
      resource: "tenant",
      resourceId: input.tenantId,
      details: {
        actor: input.actorUserId,
        sourceIp: input.sourceIp,
        happenedAt: new Date().toISOString(),
        before,
        after
      }
    });

    await this.alerts.notify({
      type: "PLATFORM_LICENSE_CHANGED",
      tenant,
      actor: input.actorUserId,
      sourceIp: input.sourceIp,
      before,
      after
    });

    return { updated: true, before, after };
  }

  async updateTenantStatus(input: { tenantId: string; actorUserId: string; sourceIp: string; isActive: boolean }) {
    const tenant = await this.repository.getTenantById(input.tenantId);
    if (!tenant) throw new AppError("Tenant non trovato", 404, "NOT_FOUND");

    const before = { isActive: tenant.isActive };
    const after = { isActive: input.isActive };

    await this.repository.setTenantActive(input.tenantId, input.isActive);
    await this.repository.appendPlatformAudit({
      tenantId: input.tenantId,
      actorUserId: input.actorUserId,
      action: "PLATFORM_TENANT_STATUS_CHANGED",
      resource: "tenant",
      resourceId: input.tenantId,
      details: {
        actor: input.actorUserId,
        sourceIp: input.sourceIp,
        happenedAt: new Date().toISOString(),
        before,
        after
      }
    });

    await this.alerts.notify({
      type: "PLATFORM_TENANT_STATUS_CHANGED",
      tenant,
      actor: input.actorUserId,
      sourceIp: input.sourceIp,
      before,
      after
    });

    return { updated: true, before, after };
  }

  async executeQuickAction(input: {
    tenantId: string;
    actorUserId: string;
    sourceIp: string;
    action: QuickAction;
  }) {
    const tenant = await this.repository.getTenantById(input.tenantId);
    if (!tenant) throw new AppError("Tenant non trovato", 404, "NOT_FOUND");

    const currentLicense = (await this.repository.getLatestLicense(input.tenantId)) ?? defaultLicense;
    const now = new Date();

    if (input.action === "DEACTIVATE_TENANT" || input.action === "REACTIVATE_TENANT") {
      const isActive = input.action === "REACTIVATE_TENANT";
      const tenantStatusResult = await this.updateTenantStatus({
        tenantId: input.tenantId,
        actorUserId: input.actorUserId,
        sourceIp: input.sourceIp,
        isActive
      });

      let nextStatus: PlatformLicenseStatus | null = null;
      if (input.action === "DEACTIVATE_TENANT" && (currentLicense.status === "ACTIVE" || currentLicense.status === "TRIAL")) {
        nextStatus = "SUSPENDED";
      }
      if (input.action === "REACTIVATE_TENANT" && currentLicense.status === "SUSPENDED") {
        nextStatus = "ACTIVE";
      }

      if (!nextStatus) {
        return { ...tenantStatusResult, action: input.action, before: currentLicense, after: currentLicense };
      }

      const after: PlatformLicense = {
        ...currentLicense,
        status: nextStatus,
        updatedAt: new Date().toISOString()
      };

      await this.repository.setLicense(input.tenantId, input.actorUserId, after);
      await this.repository.appendPlatformAudit({
        tenantId: input.tenantId,
        actorUserId: input.actorUserId,
        action: "PLATFORM_LICENSE_QUICK_ACTION",
        resource: "tenant",
        resourceId: input.tenantId,
        details: {
          quickAction: input.action,
          actor: input.actorUserId,
          sourceIp: input.sourceIp,
          happenedAt: new Date().toISOString(),
          before: currentLicense,
          after
        }
      });

      await this.alerts.notify({
        type: "PLATFORM_LICENSE_CHANGED",
        tenant,
        actor: input.actorUserId,
        sourceIp: input.sourceIp,
        before: currentLicense,
        after
      });

      return { ...tenantStatusResult, action: input.action, before: currentLicense, after };
    }

    let nextLicense = { ...currentLicense };

    if (input.action === "ACTIVATE_LICENSE") {
      nextLicense = { ...nextLicense, status: "ACTIVE" };
    }
    if (input.action === "SUSPEND_LICENSE") {
      nextLicense = { ...nextLicense, status: "SUSPENDED" };
    }
    if (input.action === "TRIAL_14_DAYS") {
      nextLicense = {
        ...nextLicense,
        status: "TRIAL",
        expiresAt: addDaysIso(now, 14)
      };
    }
    if (input.action === "RENEW_30_DAYS" || input.action === "RENEW_365_DAYS") {
      const days = input.action === "RENEW_30_DAYS" ? 30 : 365;
      const base = nextLicense.expiresAt ? new Date(nextLicense.expiresAt) : now;
      const safeBase = base.getTime() > now.getTime() ? base : now;
      nextLicense = {
        ...nextLicense,
        status: "ACTIVE",
        expiresAt: addDaysIso(safeBase, days)
      };
    }

    const after: PlatformLicense = { ...nextLicense, updatedAt: new Date().toISOString() };

    await this.repository.setLicense(input.tenantId, input.actorUserId, after);
    await this.repository.appendPlatformAudit({
      tenantId: input.tenantId,
      actorUserId: input.actorUserId,
      action: "PLATFORM_LICENSE_QUICK_ACTION",
      resource: "tenant",
      resourceId: input.tenantId,
      details: {
        quickAction: input.action,
        actor: input.actorUserId,
        sourceIp: input.sourceIp,
        happenedAt: new Date().toISOString(),
        before: currentLicense,
        after
      }
    });

    await this.alerts.notify({
      type: "PLATFORM_LICENSE_CHANGED",
      tenant,
      actor: input.actorUserId,
      sourceIp: input.sourceIp,
      before: currentLicense,
      after
    });

    return { updated: true, action: input.action, before: currentLicense, after };
  }

  private async buildSnapshot(
    tenants: Array<{ id: string; isActive: boolean }>,
    at: Date,
    licenseCache: Map<string, PlatformLicense | null>
  ): Promise<Snapshot> {
    const month = toMonthKey(at);
    const mrrByPlan = Object.fromEntries(SAAS_PLANS.map((plan) => [plan, 0])) as Record<SaasPlan, number>;
    const tenantsByPlan = Object.fromEntries(SAAS_PLANS.map((plan) => [plan, 0])) as Record<SaasPlan, number>;
    const breakdownMap = Object.fromEntries(
      SAAS_PLANS.map((plan) => [
        plan,
        {
          plan,
          basePrice: getPlanMonthlyPrice(plan),
          activeTenants: 0,
          totalTenants: 0,
          seatsTotal: 0,
          estimatedRevenue: 0
        }
      ])
    ) as Record<SaasPlan, BreakdownRow>;

    let mrrTotal = 0;
    let mrrLost = 0;

    const getLicenseAt = async (tenantId: string) => {
      const cacheKey = `${tenantId}:${month}`;
      if (!licenseCache.has(cacheKey)) {
        const license = await this.repository.getLatestLicenseAtOrBefore(tenantId, at);
        licenseCache.set(cacheKey, license);
      }
      return licenseCache.get(cacheKey) ?? null;
    };

    for (const tenant of tenants) {
      const snapshot = (await getLicenseAt(tenant.id)) ?? defaultLicense;
      const plan = ensureKnownPlan(snapshot.plan);
      const revenue = estimateLicenseMonthlyRevenue({
        plan,
        seats: snapshot.seats,
        priceMonthly: snapshot.priceMonthly,
        billingCycle: snapshot.billingCycle
      });

      const row = breakdownMap[plan];
      row.totalTenants += 1;
      row.seatsTotal += revenue.seatsFactor;
      tenantsByPlan[plan] += 1;

      if (snapshot.status === "ACTIVE") {
        row.activeTenants += 1;
        row.estimatedRevenue += revenue.estimatedMrr;
        mrrTotal += revenue.estimatedMrr;
        mrrByPlan[plan] += revenue.estimatedMrr;
      }

      if (snapshot.status === "SUSPENDED" || snapshot.status === "EXPIRED" || snapshot.status === "PAST_DUE" || snapshot.status === "CANCELED") {
        mrrLost += revenue.estimatedMrr;
      }
    }

    const breakdown = SAAS_PLANS.map((plan) => {
      const row = breakdownMap[plan];
      return {
        ...row,
        estimatedRevenue: money(row.estimatedRevenue)
      };
    });

    return {
      month,
      mrrTotal: money(mrrTotal),
      mrrLost: money(mrrLost),
      mrrByPlan: SAAS_PLANS.reduce(
        (acc, plan) => ({ ...acc, [plan]: money(mrrByPlan[plan]) }),
        {} as Record<SaasPlan, number>
      ),
      tenantsByPlan,
      breakdown
    };
  }

  async revenueReport(input: { month?: string; months: number }) {
    const selectedMonthStart = toMonthStart(input.month);
    const previousMonthStart = shiftMonth(selectedMonthStart, -1);
    const trendSize = Math.max(2, Math.min(12, input.months));

    const trendMonthStarts = Array.from({ length: trendSize }, (_, idx) =>
      shiftMonth(selectedMonthStart, idx - (trendSize - 1))
    );

    const tenants = await this.repository.listTenants();
    const licenseCache = new Map<string, PlatformLicense | null>();

    const selectedSnapshot = await this.buildSnapshot(
      tenants,
      toMonthEnd(selectedMonthStart),
      licenseCache
    );
    const previousSnapshot = await this.buildSnapshot(
      tenants,
      toMonthEnd(previousMonthStart),
      licenseCache
    );

    const trend = await Promise.all(
      trendMonthStarts.map(async (monthStart) => {
        const snapshot = await this.buildSnapshot(tenants, toMonthEnd(monthStart), licenseCache);
        return {
          month: snapshot.month,
          mrrTotal: snapshot.mrrTotal,
          mrrLost: snapshot.mrrLost
        };
      })
    );

    return {
      selectedMonth: selectedSnapshot.month,
      previousMonth: previousSnapshot.month,
      planPricing: PLAN_MONTHLY_PRICING_EUR,
      assumptions: {
        formula: "MRR tenant = prezzo mensile (override o piano) x seatsFactor",
        seatsFactorRule: "seatsFactor = max(1, seats)",
        billingCycleRule: "Se billingCycle=yearly, il prezzo viene normalizzato in quota mensile (prezzo/12)."
      },
      kpis: {
        mrrTotal: selectedSnapshot.mrrTotal,
        mrrLost: selectedSnapshot.mrrLost,
        deltaFromPrevious: money(selectedSnapshot.mrrTotal - previousSnapshot.mrrTotal),
        tenantsByPlan: selectedSnapshot.tenantsByPlan,
        mrrByPlan: selectedSnapshot.mrrByPlan
      },
      breakdown: selectedSnapshot.breakdown,
      trend
    };
  }

  async revenueReportCsv(input: { month?: string; months: number }) {
    const report = await this.revenueReport(input);

    const rows: Array<Record<string, unknown>> = [
      ...report.breakdown.map((row) => ({
        section: "BREAKDOWN",
        month: report.selectedMonth,
        plan: row.plan,
        basePrice: row.basePrice,
        activeTenants: row.activeTenants,
        totalTenants: row.totalTenants,
        seatsTotal: row.seatsTotal,
        estimatedRevenue: row.estimatedRevenue,
        mrrTotal: report.kpis.mrrTotal,
        mrrLost: report.kpis.mrrLost,
        deltaFromPrevious: report.kpis.deltaFromPrevious
      })),
      ...report.trend.map((row) => ({
        section: "TREND",
        month: row.month,
        plan: "ALL",
        basePrice: "",
        activeTenants: "",
        totalTenants: "",
        seatsTotal: "",
        estimatedRevenue: row.mrrTotal,
        mrrTotal: row.mrrTotal,
        mrrLost: row.mrrLost,
        deltaFromPrevious: ""
      }))
    ];

    const headers = [
      "section",
      "month",
      "plan",
      "basePrice",
      "activeTenants",
      "totalTenants",
      "seatsTotal",
      "estimatedRevenue",
      "mrrTotal",
      "mrrLost",
      "deltaFromPrevious"
    ];

    const csv = [headers.join(","), ...rows.map((row) => headers.map((h) => csvEscape(row[h])).join(","))].join("\n");

    return {
      fileName: `platform-revenue-${report.selectedMonth}.csv`,
      csv
    };
  }
}
