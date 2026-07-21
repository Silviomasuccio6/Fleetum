import { PlatformAdminRepository, PlatformAuditEvent, PlatformLicense, PlatformTenantRow } from "../../domain/repositories/platform-admin-repository.js";
import { preservePlatformLicenseBillingLink } from "../../application/services/platform-license-billing-link.js";
import { readTenantSubscription, upsertTenantSubscription } from "../../application/services/tenant-subscription-service.js";
import { prisma } from "../database/prisma/client.js";

const PLATFORM_ACTIONS = [
  "PLATFORM_LICENSE_UPDATED",
  "PLATFORM_LICENSE_QUICK_ACTION",
  "PLATFORM_TENANT_STATUS_CHANGED"
] as const;

const parseLicenseFromDetails = (details: unknown): PlatformLicense | null => {
  if (!details || typeof details !== "object") return null;
  const payload = details as Record<string, unknown>;
  const source = payload.after && typeof payload.after === "object" ? (payload.after as Record<string, unknown>) : payload;

  return {
    plan: String(source.plan ?? "STARTER"),
    seats: Number(source.seats ?? 3),
    status: String(source.status ?? "PENDING") as PlatformLicense["status"],
    expiresAt: source.expiresAt ? String(source.expiresAt) : null,
    updatedAt: source.updatedAt ? String(source.updatedAt) : undefined,
    priceMonthly:
      Number.isFinite(Number(source.priceMonthly)) && Number(source.priceMonthly) > 0
        ? Number(source.priceMonthly)
        : null,
    billingCycle: source.billingCycle === "yearly" ? "yearly" : "monthly"
  };
};

export class PrismaPlatformAdminRepository implements PlatformAdminRepository {
  async listTenants(): Promise<PlatformTenantRow[]> {
    return prisma.tenant.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        users: {
          where: { deletedAt: null },
          include: { roles: { include: { role: { select: { key: true } } } } }
        },
        tenantProfile: {
          select: {
            legalName: true,
            tradeName: true,
            vatNumber: true,
            email: true,
            phone: true,
            profileCompletedAt: true
          }
        },
        tenantBranding: { select: { logoFilePath: true } },
        _count: { select: { users: true, vehicles: true, stoppages: true } }
      }
    }) as unknown as PlatformTenantRow[];
  }

  async getTenantById(tenantId: string): Promise<{ id: string; name: string; isActive: boolean } | null> {
    return prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { id: true, name: true, isActive: true }
    });
  }

  async getTenantCompanyProfile(tenantId: string): Promise<unknown | null> {
    return prisma.tenant.findUnique({
      where: { id: tenantId },
      select: {
        id: true,
        name: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
        tenantProfile: true,
        tenantBranding: true,
        tenantLegalSettings: true
      }
    });
  }

  async setTenantActive(tenantId: string, isActive: boolean): Promise<void> {
    await prisma.tenant.update({ where: { id: tenantId }, data: { isActive } });
  }

  async getLatestLicense(tenantId: string): Promise<PlatformLicense | null> {
    const persisted = await readTenantSubscription(tenantId);
    if (persisted) {
      return {
        plan: persisted.plan,
        seats: persisted.seats,
        status: persisted.status,
        expiresAt: persisted.expiresAt,
        updatedAt: persisted.updatedAt,
        priceMonthly: persisted.priceMonthly,
        billingCycle: persisted.billingCycle
      };
    }
    return this.getLatestLicenseAtOrBefore(tenantId, new Date());
  }

  async getLatestLicenseAtOrBefore(tenantId: string, at: Date): Promise<PlatformLicense | null> {
    const row = await prisma.auditLog.findFirst({
      where: {
        resource: "tenant",
        resourceId: tenantId,
        action: "PLATFORM_LICENSE_UPDATED",
        createdAt: { lte: at }
      },
      orderBy: { createdAt: "desc" }
    });

    return parseLicenseFromDetails(row?.details ?? null);
  }

  async setLicense(tenantId: string, userId: string, details: PlatformLicense): Promise<void> {
    const currentSubscription = await readTenantSubscription(tenantId);
    const billingLink = preservePlatformLicenseBillingLink(currentSubscription);
    const subscription = await upsertTenantSubscription({
      tenantId,
      plan: details.plan,
      seats: details.seats,
      status: details.status,
      expiresAt: details.expiresAt,
      priceMonthly: details.priceMonthly,
      billingCycle: details.billingCycle,
      ...billingLink
    });

    await prisma.auditLog.create({
      data: {
        tenantId,
        userId,
        action: "PLATFORM_LICENSE_UPDATED",
        resource: "tenant",
        resourceId: tenantId,
        details: {
          ...details,
          persisted: true,
          subscription
        } as any
      }
    });
  }

  async appendPlatformAudit(input: {
    tenantId: string;
    actorUserId: string;
    action: string;
    resource: string;
    resourceId?: string | null;
    details: Record<string, unknown>;
  }): Promise<void> {
    await prisma.auditLog.create({
      data: {
        tenantId: input.tenantId,
        userId: input.actorUserId,
        action: input.action,
        resource: input.resource,
        resourceId: input.resourceId ?? input.tenantId,
        details: input.details as any
      }
    });
  }

  async listRecentPlatformEvents(limit: number): Promise<PlatformAuditEvent[]> {
    const rows = await prisma.auditLog.findMany({
      where: { action: { in: [...PLATFORM_ACTIONS] } },
      orderBy: { createdAt: "desc" },
      take: limit,
      include: {
        tenant: {
          select: {
            name: true
          }
        }
      }
    });

    return rows.map((row) => ({
      id: row.id,
      tenantId: row.tenantId,
      tenantName: row.tenant.name,
      action: row.action,
      resource: row.resource,
      resourceId: row.resourceId,
      userId: row.userId,
      details: row.details,
      createdAt: row.createdAt.toISOString()
    }));
  }

  async listUsersGlobal(): Promise<Array<{ id: string; email: string; firstName: string; lastName: string; status: string; tenant: { id: string; name: string } }>> {
    return prisma.user.findMany({
      where: { deletedAt: null },
      orderBy: { createdAt: "desc" },
      include: { tenant: { select: { id: true, name: true } } }
    }) as unknown as Array<{ id: string; email: string; firstName: string; lastName: string; status: string; tenant: { id: string; name: string } }>;
  }
}
