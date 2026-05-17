import { prisma } from "../../infrastructure/database/prisma/client.js";
import { AuditLogRepository } from "../../domain/repositories/audit-log-repository.js";
import {
  BillingCycle,
  FeatureKey,
  SaasPlan,
  ensureKnownPlan,
  getFeatureListForPlan,
  getPlanMonthlyPrice,
  normalizeBillingCycle
} from "./feature-entitlements-service.js";

type LicenseStatus = "ACTIVE" | "SUSPENDED" | "EXPIRED" | "TRIAL" | "PAST_DUE" | "CANCELED";

export type LicenseInfo = {
  plan: SaasPlan;
  seats: number;
  status: LicenseStatus;
  expiresAt: string | null;
  daysRemaining: number | null;
  expiringSoon: boolean;
  priceMonthly: number | null;
  billingCycle: BillingCycle;
};

const defaultLicense: LicenseInfo = {
  plan: "STARTER",
  seats: 3,
  status: "ACTIVE",
  expiresAt: null,
  daysRemaining: null,
  expiringSoon: false,
  priceMonthly: null,
  billingCycle: "monthly"
};

const toValidStatus = (value: unknown): LicenseStatus => {
  if (value === "ACTIVE" || value === "SUSPENDED" || value === "EXPIRED" || value === "TRIAL" || value === "PAST_DUE" || value === "CANCELED") return value;
  return "ACTIVE";
};

const toPositiveNumberOrNull = (value: unknown): number | null => {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Number(n.toFixed(2));
};

const pickLicenseSource = (details: unknown): Record<string, unknown> => {
  if (!details || typeof details !== "object") return {};
  const payload = details as Record<string, unknown>;

  if (payload.after && typeof payload.after === "object") {
    return payload.after as Record<string, unknown>;
  }

  if (payload.value && typeof payload.value === "object") {
    const valuePayload = payload.value as Record<string, unknown>;
    if (valuePayload.after && typeof valuePayload.after === "object") {
      return valuePayload.after as Record<string, unknown>;
    }
    return valuePayload;
  }

  return payload;
};

export class LicensePolicyService {
  constructor(private readonly auditRepository: AuditLogRepository) {}

  async getTenantLicense(tenantId: string): Promise<LicenseInfo> {
    const row = await this.auditRepository.getLatestByAction(tenantId, "tenant", "PLATFORM_LICENSE_UPDATED");
    const raw = pickLicenseSource(row?.details ?? {});

    const expiresAt = typeof raw.expiresAt === "string" && raw.expiresAt ? raw.expiresAt : null;
    const now = Date.now();
    const expiresMs = expiresAt ? new Date(expiresAt).getTime() : null;
    const daysRemaining = expiresMs ? Math.ceil((expiresMs - now) / 86400000) : null;

    let status = toValidStatus(raw.status);
    if (expiresMs && expiresMs < now) status = "EXPIRED";

    const plan = ensureKnownPlan(typeof raw.plan === "string" ? raw.plan : defaultLicense.plan);

    return {
      plan,
      seats: Number(raw.seats) > 0 ? Number(raw.seats) : defaultLicense.seats,
      status,
      expiresAt,
      daysRemaining,
      expiringSoon: daysRemaining !== null && daysRemaining >= 0 && daysRemaining <= 7,
      priceMonthly: toPositiveNumberOrNull(raw.priceMonthly),
      billingCycle: normalizeBillingCycle(typeof raw.billingCycle === "string" ? raw.billingCycle : "monthly")
    };
  }

  async evaluateAccess(tenantId: string) {
    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { isActive: true } });
    const license = await this.getTenantLicense(tenantId);

    const blocked = !tenant?.isActive || license.status === "SUSPENDED" || license.status === "EXPIRED" || license.status === "CANCELED";
    return {
      blocked,
      reason: !tenant?.isActive
        ? "TENANT_INACTIVE"
        : license.status === "SUSPENDED"
          ? "LICENSE_SUSPENDED"
          : license.status === "EXPIRED"
            ? "LICENSE_EXPIRED"
            : license.status === "CANCELED"
              ? "LICENSE_CANCELED"
              : null,
      license
    };
  }

  async getTenantEntitlements(tenantId: string): Promise<{
    plan: SaasPlan;
    priceMonthly: number;
    features: FeatureKey[];
    license: LicenseInfo;
  }> {
    const license = await this.getTenantLicense(tenantId);
    return {
      plan: license.plan,
      priceMonthly: license.priceMonthly ?? getPlanMonthlyPrice(license.plan),
      features: getFeatureListForPlan(license.plan),
      license
    };
  }
}
