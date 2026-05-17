import assert from "node:assert/strict";
import test from "node:test";
import { PlatformAdminService } from "../src/application/services/platform-admin-service.js";
import {
  FeatureKey,
  getRequiredPlanForFeature,
  hasFeature
} from "../src/application/services/feature-entitlements-service.js";
import { createRequireFeature } from "../src/interfaces/http/middlewares/feature-entitlements.js";
import {
  PlatformAdminRepository,
  PlatformAuditEvent,
  PlatformLicense,
  PlatformTenantRow
} from "../src/domain/repositories/platform-admin-repository.js";

test("hasFeature applies cumulative matrix correctly", () => {
  assert.equal(hasFeature("STARTER", "reports_basic"), true);
  assert.equal(hasFeature("STARTER", "reports_advanced"), false);
  assert.equal(hasFeature("PRO", "reports_advanced"), true);
  assert.equal(hasFeature("PRO", "security_insights"), false);
  assert.equal(hasFeature("ENTERPRISE", "security_insights"), true);
  assert.equal(getRequiredPlanForFeature("security_insights"), "ENTERPRISE");
});

test("requireFeature denies non-entitled plan and writes audit", async () => {
  const auditWrites: any[] = [];
  const requireFeature = createRequireFeature(
    {
      getTenantEntitlements: async () => ({
        plan: "STARTER",
        priceMonthly: 49,
        features: ["reports_basic" as FeatureKey],
        license: {} as any
      })
    } as any,
    {
      create: async (input: Record<string, unknown>) => {
        auditWrites.push(input);
      }
    } as any
  );

  const middleware = requireFeature("reports_advanced");

  const req = {
    auth: { tenantId: "tenant-1", userId: "user-1" },
    method: "GET",
    originalUrl: "/api/stats/analytics",
    headers: {},
    ip: "127.0.0.1",
    socket: { remoteAddress: "127.0.0.1" }
  } as any;

  const nextErr = await new Promise<any>((resolve) => {
    middleware(req, {} as any, (err?: unknown) => {
      resolve(err);
    });
  });

  assert.equal(nextErr?.code, "PLAN_LIMIT");
  assert.equal(nextErr?.statusCode, 403);
  assert.equal(nextErr?.details?.feature, "reports_advanced");
  assert.equal(nextErr?.details?.requiredPlan, "PRO");
  assert.equal(auditWrites.length, 1);
});

test("requireFeature allows entitled plan", async () => {
  const requireFeature = createRequireFeature(
    {
      getTenantEntitlements: async () => ({
        plan: "PRO",
        priceMonthly: 149,
        features: ["reports_basic", "reports_advanced"] as FeatureKey[],
        license: {} as any
      })
    } as any,
    {
      create: async () => {
        throw new Error("audit should not be written");
      }
    } as any
  );

  const middleware = requireFeature("reports_advanced");

  const nextErr = await new Promise<unknown>((resolve) => {
    middleware(
      {
        auth: { tenantId: "tenant-1", userId: "user-1" },
        method: "GET",
        originalUrl: "/api/stats/analytics",
        headers: {},
        ip: "127.0.0.1",
        socket: { remoteAddress: "127.0.0.1" }
      } as any,
      {} as any,
      (err?: unknown) => {
        resolve(err);
      }
    );
  });

  assert.equal(nextErr, undefined);
});

class RevenueRepo implements PlatformAdminRepository {
  public tenants: PlatformTenantRow[] = [
    {
      id: "tenant-pro",
      name: "Tenant Pro",
      isActive: true,
      createdAt: new Date("2025-01-01T00:00:00.000Z"),
      updatedAt: new Date("2026-03-01T00:00:00.000Z"),
      users: [],
      _count: { users: 1, vehicles: 1, stoppages: 1 }
    },
    {
      id: "tenant-starter",
      name: "Tenant Starter",
      isActive: true,
      createdAt: new Date("2025-01-01T00:00:00.000Z"),
      updatedAt: new Date("2026-03-01T00:00:00.000Z"),
      users: [],
      _count: { users: 1, vehicles: 1, stoppages: 1 }
    }
  ];

  private timeline: Record<string, Array<{ at: Date; license: PlatformLicense }>> = {
    "tenant-pro": [
      {
        at: new Date("2025-12-01T00:00:00.000Z"),
        license: { plan: "PRO", seats: 2, status: "ACTIVE", expiresAt: null, billingCycle: "monthly" }
      }
    ],
    "tenant-starter": [
      {
        at: new Date("2025-12-01T00:00:00.000Z"),
        license: { plan: "STARTER", seats: 1, status: "SUSPENDED", expiresAt: null, billingCycle: "monthly" }
      }
    ]
  };

  async listTenants(): Promise<PlatformTenantRow[]> {
    return this.tenants;
  }

  async getTenantById(tenantId: string): Promise<{ id: string; name: string; isActive: boolean } | null> {
    const tenant = this.tenants.find((item) => item.id === tenantId);
    return tenant ? { id: tenant.id, name: tenant.name, isActive: tenant.isActive } : null;
  }

  async setTenantActive(_tenantId: string, _isActive: boolean): Promise<void> {}

  async getLatestLicense(tenantId: string): Promise<PlatformLicense | null> {
    return this.getLatestLicenseAtOrBefore(tenantId, new Date("2030-01-01T00:00:00.000Z"));
  }

  async getLatestLicenseAtOrBefore(tenantId: string, at: Date): Promise<PlatformLicense | null> {
    const entries = (this.timeline[tenantId] ?? []).filter((entry) => entry.at.getTime() <= at.getTime());
    if (!entries.length) return null;
    const latest = entries.sort((a, b) => b.at.getTime() - a.at.getTime())[0];
    return latest?.license ?? null;
  }

  async setLicense(_tenantId: string, _userId: string, _details: PlatformLicense): Promise<void> {}

  async listUsersGlobal(): Promise<Array<{ id: string; email: string; firstName: string; lastName: string; status: string; tenant: { id: string; name: string } }>> {
    return [];
  }

  async appendPlatformAudit(_input: {
    tenantId: string;
    actorUserId: string;
    action: string;
    resource: string;
    resourceId?: string | null;
    details: Record<string, unknown>;
  }): Promise<void> {}

  async listRecentPlatformEvents(_limit: number): Promise<PlatformAuditEvent[]> {
    return [];
  }
}

test("platform revenue report aggregates MRR and lost revenue by plan", async () => {
  const repo = new RevenueRepo();
  const service = new PlatformAdminService(
    repo,
    {
      notify: async () => {
        // no-op
      }
    } as any,
    {
      assertAllowed: () => {},
      registerFailure: () => ({ failures: 0, locked: false }),
      registerSuccess: () => {}
    } as any
  );

  const report = await service.revenueReport({ month: "2026-03", months: 6 });

  assert.equal(report.selectedMonth, "2026-03");
  assert.equal(report.kpis.mrrTotal, 398);
  assert.equal(report.kpis.mrrLost, 129);
  assert.equal(report.kpis.mrrByPlan.PRO, 398);
  assert.equal(report.kpis.tenantsByPlan.STARTER, 1);
  assert.equal(report.breakdown.find((row) => row.plan === "PRO")?.activeTenants, 1);
});
