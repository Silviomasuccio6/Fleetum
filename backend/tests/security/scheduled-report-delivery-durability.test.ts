import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { prisma } from "../../src/infrastructure/database/prisma/client.js";
import { EmailQueueService } from "../../src/infrastructure/email/email-queue-service.js";
import { runReportsCronCycle } from "../../src/infrastructure/cron/reports-cron.js";

const runId = `scheduled-report-delivery-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const tenantIds = {
  concurrent: `${runId}-concurrent`,
  catchUp: `${runId}-catch-up`,
  retroactive: `${runId}-retroactive`,
  atomicFanOut: `${runId}-atomic-fan-out`
};
const allTenantIds = Object.values(tenantIds);

const activeProLicense = {
  getTenantEntitlements: async () => ({
    plan: "PRO",
    license: { status: "ACTIVE" }
  })
} as any;

const dailySettings = (slot: Date, recipients: string[]) => ({
  enabled: true,
  frequency: "daily",
  hour: slot.getHours(),
  minute: slot.getMinutes(),
  reportStyle: "BASIC",
  recipients
});

const createScheduledTenant = async (input: {
  tenantId: string;
  slot: Date;
  settingsCreatedAt: Date;
  recipients: string[];
}) => {
  await prisma.tenant.create({
    data: { id: input.tenantId, name: `${runId} synthetic tenant` }
  });
  await prisma.auditLog.create({
    data: {
      tenantId: input.tenantId,
      action: "SETTINGS_REPORTS",
      resource: "reports",
      details: dailySettings(input.slot, input.recipients),
      createdAt: input.settingsCreatedAt
    }
  });
};

const queuedReports = (tenantId: string) =>
  prisma.emailQueue.findMany({
    where: { tenantId, type: "SCHEDULED_REPORT" },
    orderBy: [{ recipient: "asc" }, { createdAt: "asc" }],
    select: { id: true, recipient: true }
  });

describe("scheduled report delivery durability", () => {
  before(async () => {
    await prisma.$connect();
  });

  after(async () => {
    await prisma.emailQueue.deleteMany({ where: { tenantId: { in: allTenantIds } } });
    await prisma.auditLog.deleteMany({ where: { tenantId: { in: allTenantIds } } });
    await prisma.tenant.deleteMany({ where: { id: { in: allTenantIds } } });
    await prisma.$disconnect();
  });

  it("persists one queue row per recipient when two cron cycles race on the same slot", async () => {
    const slot = new Date(2032, 4, 3, 8, 0, 0, 0);
    await createScheduledTenant({
      tenantId: tenantIds.concurrent,
      slot,
      settingsCreatedAt: new Date(slot.getTime() - 60 * 60 * 1000),
      recipients: ["alpha@example.test", "beta@example.test"]
    });

    const queue = new EmailQueueService();
    await Promise.all([
      runReportsCronCycle(queue, activeProLicense, slot),
      runReportsCronCycle(queue, activeProLicense, slot)
    ]);

    const rows = await queuedReports(tenantIds.concurrent);
    assert.deepEqual(
      rows.map((row) => row.recipient),
      ["alpha@example.test", "beta@example.test"]
    );
  });

  it("catches up five minutes after the due slot and retrying the slot stays idempotent", async () => {
    const slot = new Date(2032, 4, 4, 9, 15, 0, 0);
    await createScheduledTenant({
      tenantId: tenantIds.catchUp,
      slot,
      settingsCreatedAt: new Date(slot.getTime() - 60 * 60 * 1000),
      recipients: ["catch-up@example.test"]
    });

    const queue = new EmailQueueService();
    const fiveMinutesLate = new Date(slot.getTime() + 5 * 60 * 1000);
    await runReportsCronCycle(queue, activeProLicense, fiveMinutesLate);
    await runReportsCronCycle(queue, activeProLicense, new Date(fiveMinutesLate.getTime() + 60 * 1000));

    const rows = await queuedReports(tenantIds.catchUp);
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.recipient, "catch-up@example.test");
  });

  it("does not apply a report configuration created after the missed slot", async () => {
    const slot = new Date(2032, 4, 5, 10, 30, 0, 0);
    await createScheduledTenant({
      tenantId: tenantIds.retroactive,
      slot,
      settingsCreatedAt: new Date(slot.getTime() + 60 * 1000),
      recipients: ["too-late@example.test"]
    });

    await runReportsCronCycle(
      new EmailQueueService(),
      activeProLicense,
      new Date(slot.getTime() + 5 * 60 * 1000)
    );

    assert.equal((await queuedReports(tenantIds.retroactive)).length, 0);
  });

  it("rolls back the complete enqueueManyOnce fan-out when one input is invalid", async () => {
    await prisma.tenant.create({
      data: { id: tenantIds.atomicFanOut, name: `${runId} atomic fan-out` }
    });
    const queue = new EmailQueueService();
    const type = `SCHEDULED_REPORT_ATOMIC_${runId}`;

    await assert.rejects(() =>
      (queue as any).enqueueManyOnce([
        {
          tenantId: tenantIds.atomicFanOut,
          type,
          recipient: "valid@example.test",
          subject: "Synthetic scheduled report",
          body: "Synthetic body",
          deduplicationKey: `${runId}:valid`
        },
        {
          tenantId: tenantIds.atomicFanOut,
          type,
          recipient: null,
          subject: "Synthetic scheduled report",
          body: "Synthetic body",
          deduplicationKey: `${runId}:invalid`
        }
      ])
    );

    assert.equal(
      await prisma.emailQueue.count({
        where: { tenantId: tenantIds.atomicFanOut, type }
      }),
      0
    );
  });
});
