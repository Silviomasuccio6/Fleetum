import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { prisma } from "../../src/infrastructure/database/prisma/client.js";
import { runReportsCronCycle } from "../../src/infrastructure/cron/reports-cron.js";

const runId = `scheduled-report-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const tenantIds = {
  old: `${runId}-a-old`,
  noisy: `${runId}-b-noisy`,
  failing: `${runId}-c-failing`,
  afterFailure: `${runId}-d-after-failure`,
  inactive: `${runId}-e-inactive`,
  blockedLicense: `${runId}-f-blocked-license`,
  afterPageBoundary: `${runId}-z-after-page-boundary`
};
const fillerTenantIds = Array.from({ length: 100 }, (_, index) => `${runId}-m-filler-${String(index).padStart(3, "0")}`);
const allTenantIds = [...Object.values(tenantIds), ...fillerTenantIds];

const settings = (recipients: string[], hour: number, minute: number, enabled = true) => ({
  enabled,
  frequency: "daily",
  hour,
  minute,
  reportStyle: "BASIC",
  recipients
});

describe("scheduled report tenant enumeration", () => {
  before(async () => {
    await prisma.$connect();
  });

  after(async () => {
    await prisma.auditLog.deleteMany({ where: { tenantId: { in: allTenantIds } } });
    await prisma.tenant.deleteMany({ where: { id: { in: allTenantIds } } });
    await prisma.$disconnect();
  });

  it("keeps an older tenant after 301 updates by another tenant and isolates each active tenant", async () => {
    await prisma.tenant.createMany({
      data: [
        { id: tenantIds.old, name: `${runId} old` },
        { id: tenantIds.noisy, name: `${runId} noisy` },
        { id: tenantIds.failing, name: `${runId} failing` },
        { id: tenantIds.afterFailure, name: `${runId} after failure` },
        { id: tenantIds.inactive, name: `${runId} inactive`, isActive: false },
        { id: tenantIds.blockedLicense, name: `${runId} blocked license` },
        ...fillerTenantIds.map((id) => ({ id, name: `${runId} filler` })),
        { id: tenantIds.afterPageBoundary, name: `${runId} page boundary` }
      ]
    });

    const scheduledAt = new Date();
    const hour = scheduledAt.getHours();
    const minute = scheduledAt.getMinutes();
    const base = new Date("2026-01-01T00:00:00.000Z").getTime();

    await prisma.auditLog.create({
      data: {
        tenantId: tenantIds.old,
        action: "SETTINGS_REPORTS",
        resource: "reports",
        details: settings(["old@example.test"], hour, minute),
        createdAt: new Date(base)
      }
    });

    await prisma.auditLog.createMany({
      data: Array.from({ length: 301 }, (_, index) => ({
        tenantId: tenantIds.noisy,
        action: "SETTINGS_REPORTS",
        resource: "reports",
        details: settings(
          index === 300
            ? ["noisy@example.test", " NOISY@example.test ", "second@example.test"]
            : [],
          hour,
          minute,
          index === 300
        ),
        createdAt: new Date(base + index + 1)
      }))
    });

    await prisma.auditLog.createMany({
      data: [
        {
          tenantId: tenantIds.afterFailure,
          action: "SETTINGS_REPORTS",
          resource: "reports",
          details: settings(["after@example.test"], hour, minute),
          createdAt: new Date(base + 302)
        },
        {
          tenantId: tenantIds.failing,
          action: "SETTINGS_REPORTS",
          resource: "reports",
          details: settings(["failure@example.test"], hour, minute),
          createdAt: new Date(base + 303)
        },
        {
          tenantId: tenantIds.inactive,
          action: "SETTINGS_REPORTS",
          resource: "reports",
          details: settings(["inactive@example.test"], hour, minute),
          createdAt: new Date(base + 304)
        },
        {
          tenantId: tenantIds.blockedLicense,
          action: "SETTINGS_REPORTS",
          resource: "reports",
          details: settings(["blocked@example.test"], hour, minute),
          createdAt: new Date(base + 305)
        },
        {
          tenantId: tenantIds.afterPageBoundary,
          action: "SETTINGS_REPORTS",
          resource: "reports",
          details: settings(["tail@example.test"], hour, minute),
          createdAt: new Date(base + 306)
        }
      ]
    });

    const deliveries: Array<{ tenantId?: string; recipient: string }> = [];
    await runReportsCronCycle(
      {
        enqueueManyOnce: async (inputs: Array<{ tenantId?: string; recipient: string }>) => {
          deliveries.push(...inputs.map((input) => ({ tenantId: input.tenantId, recipient: input.recipient })));
          return { count: inputs.length };
        }
      } as any,
      {
        getTenantEntitlements: async (tenantId: string) => {
          if (tenantId === tenantIds.failing) throw new Error("synthetic tenant failure");
          return {
            plan: "PRO",
            license: { status: tenantId === tenantIds.blockedLicense ? "SUSPENDED" : "ACTIVE" }
          };
        }
      } as any,
      scheduledAt
    );

    const relevant = deliveries.filter((delivery) => Object.values(tenantIds).includes(String(delivery.tenantId)));
    assert.deepEqual(
      relevant.map((delivery) => `${delivery.tenantId}:${delivery.recipient}`),
      [
        `${tenantIds.old}:old@example.test`,
        `${tenantIds.noisy}:noisy@example.test`,
        `${tenantIds.noisy}:second@example.test`,
        `${tenantIds.afterFailure}:after@example.test`,
        `${tenantIds.afterPageBoundary}:tail@example.test`
      ]
    );
  });
});
