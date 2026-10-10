import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { SettingsService } from "../../src/application/services/settings-service.js";
import { prisma } from "../../src/infrastructure/database/prisma/client.js";
import { runReportsCronCycle } from "../../src/infrastructure/cron/reports-cron.js";
import { EmailQueueService } from "../../src/infrastructure/email/email-queue-service.js";
import { PrismaAuditLogRepository } from "../../src/infrastructure/repositories/prisma-audit-log-repository.js";
import { PrismaPlatformAdminRepository } from "../../src/infrastructure/repositories/prisma-platform-admin-repository.js";

const runId = `scheduled-report-cursor-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const tenantIds = {
  longOutage: `${runId}-long-outage`,
  backlog: `${runId}-backlog`,
  concurrent: `${runId}-concurrent`,
  rollback: `${runId}-rollback`,
  disabled: `${runId}-disabled`,
  noRecipients: `${runId}-no-recipients`,
  ineligible: `${runId}-ineligible`,
  reactivated: `${runId}-reactivated`,
  statusWriter: `${runId}-status-writer`,
  tenantInactiveDuring: `${runId}-tenant-inactive-during`,
  licenseChangedDuring: `${runId}-license-changed-during`,
  licenseRestoredDuring: `${runId}-license-restored-during`,
  changed: `${runId}-changed`,
  concurrentSettings: `${runId}-concurrent-settings`,
  retroactive: `${runId}-retroactive`
};
const allTenantIds = Object.values(tenantIds);
const queue = new EmailQueueService();
const cursorModel = (prisma as any).scheduledReportCursor;
const localTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

const activeProLicense = {
  getTenantEntitlements: async () => ({ plan: "PRO", license: { status: "ACTIVE" } })
} as any;

const dailySettings = (slot: Date, recipients: string[], enabled = true) => ({
  enabled,
  frequency: "daily",
  hour: slot.getHours(),
  minute: slot.getMinutes(),
  reportStyle: "BASIC",
  recipients
});

const localSlot = (year: number, month: number, day: number, hour: number, minute = 0) =>
  new Date(year, month, day, hour, minute, 0, 0);

const nextDaySlot = (slot: Date, days = 1) =>
  localSlot(slot.getFullYear(), slot.getMonth(), slot.getDate() + days, slot.getHours(), slot.getMinutes());

const createScheduledTenant = async (input: {
  tenantId: string;
  slot: Date;
  settingsCreatedAt: Date;
  recipients: string[];
  enabled?: boolean;
}) => {
  await prisma.tenant.create({ data: { id: input.tenantId, name: `${runId} synthetic tenant` } });
  const settings = await prisma.auditLog.create({
    data: {
      tenantId: input.tenantId,
      action: "SETTINGS_REPORTS",
      resource: "reports",
      details: dailySettings(input.slot, input.recipients, input.enabled),
      createdAt: input.settingsCreatedAt
    }
  });
  await cursorModel.create({
    data: {
      tenantId: input.tenantId,
      settingsAuditLogId: settings.id,
      timeZone: localTimeZone,
      nextRunAt: input.slot
    }
  });
  return settings;
};

const queuedReports = (tenantId: string) =>
  prisma.emailQueue.findMany({
    where: { tenantId, type: "SCHEDULED_REPORT" },
    orderBy: [{ recipient: "asc" }, { createdAt: "asc" }],
    select: { recipient: true, meta: true, deduplicationKey: true }
  });

const cursorFor = (tenantId: string) => cursorModel.findUniqueOrThrow({ where: { tenantId } });

describe("persistent scheduled report cursor", () => {
  before(async () => {
    await prisma.$connect();
  });

  after(async () => {
    await prisma.emailQueue.deleteMany({ where: { tenantId: { in: allTenantIds } } });
    await cursorModel.deleteMany({ where: { tenantId: { in: allTenantIds } } });
    await prisma.auditLog.deleteMany({ where: { tenantId: { in: allTenantIds } } });
    await prisma.tenant.deleteMany({ where: { id: { in: allTenantIds } } });
    await prisma.$disconnect();
  });

  it("recovers a persisted due slot more than 180 minutes late, once across retries", async () => {
    const slot = localSlot(2032, 5, 1, 8);
    const now = localSlot(2032, 5, 1, 13);
    await createScheduledTenant({
      tenantId: tenantIds.longOutage,
      slot,
      settingsCreatedAt: nextDaySlot(slot, -1),
      recipients: ["long-outage@example.test"]
    });

    await runReportsCronCycle(queue, activeProLicense, now);
    await runReportsCronCycle(queue, activeProLicense, new Date(now.getTime() + 60_000));

    const rows = await queuedReports(tenantIds.longOutage);
    assert.equal(rows.length, 1);
    assert.equal((rows[0]?.meta as any)?.scheduledFor, slot.toISOString());
    const cursor = await cursorFor(tenantIds.longOutage);
    assert.equal(cursor.lastQueuedFor?.getTime(), slot.getTime());
    assert.equal(cursor.nextRunAt?.getTime(), nextDaySlot(slot).getTime());
  });

  it("sends only the latest occurrence after several missed days and records the skipped range", async () => {
    const first = localSlot(2032, 5, 4, 8);
    const latest = nextDaySlot(first, 3);
    await createScheduledTenant({
      tenantId: tenantIds.backlog,
      slot: first,
      settingsCreatedAt: nextDaySlot(first, -1),
      recipients: ["backlog@example.test"]
    });

    await runReportsCronCycle(queue, activeProLicense, new Date(latest.getTime() + 5 * 60 * 60_000));

    const rows = await queuedReports(tenantIds.backlog);
    assert.equal(rows.length, 1, "a prolonged outage must not send an email burst");
    assert.equal((rows[0]?.meta as any)?.scheduledFor, latest.toISOString());
    const cursor = await cursorFor(tenantIds.backlog);
    assert.equal(cursor.lastQueuedFor?.getTime(), latest.getTime());
    assert.equal(cursor.lastSkippedFrom?.getTime(), first.getTime());
    assert.equal(cursor.lastSkippedThrough?.getTime(), nextDaySlot(first, 2).getTime());
    assert.equal(cursor.lastSkipReason, "BACKLOG");
    assert.equal(cursor.nextRunAt?.getTime(), nextDaySlot(latest).getTime());
  });

  it("two concurrent cron cycles enqueue one row per recipient and advance once", async () => {
    const slot = localSlot(2032, 5, 8, 8);
    await createScheduledTenant({
      tenantId: tenantIds.concurrent,
      slot,
      settingsCreatedAt: nextDaySlot(slot, -1),
      recipients: ["first@example.test", "second@example.test"]
    });

    await Promise.all([
      runReportsCronCycle(queue, activeProLicense, slot),
      runReportsCronCycle(queue, activeProLicense, slot)
    ]);

    assert.deepEqual(
      (await queuedReports(tenantIds.concurrent)).map((row) => row.recipient),
      ["first@example.test", "second@example.test"]
    );
    const cursor = await cursorFor(tenantIds.concurrent);
    assert.equal(cursor.lastQueuedFor?.getTime(), slot.getTime());
    assert.equal(cursor.nextRunAt?.getTime(), nextDaySlot(slot).getTime());
  });

  it("rolls back both queue rows and cursor advancement if enqueue fails after insertion", async () => {
    const slot = localSlot(2032, 5, 9, 8);
    await createScheduledTenant({
      tenantId: tenantIds.rollback,
      slot,
      settingsCreatedAt: nextDaySlot(slot, -1),
      recipients: ["rollback@example.test"]
    });

    const failingQueue = {
      enqueueManyOnce: async (inputs: Parameters<EmailQueueService["enqueueManyOnce"]>[0], db: Parameters<EmailQueueService["enqueueManyOnce"]>[1]) => {
        await queue.enqueueManyOnce(inputs, db);
        throw new Error("synthetic failure after queue insert");
      }
    } as any;
    await runReportsCronCycle(failingQueue, activeProLicense, slot);

    assert.equal((await queuedReports(tenantIds.rollback)).length, 0);
    assert.equal((await cursorFor(tenantIds.rollback)).nextRunAt?.getTime(), slot.getTime());

    await runReportsCronCycle(queue, activeProLicense, new Date(slot.getTime() + 60_000));
    assert.equal((await queuedReports(tenantIds.rollback)).length, 1);
    assert.equal((await cursorFor(tenantIds.rollback)).nextRunAt?.getTime(), nextDaySlot(slot).getTime());
  });

  it("advances missed slots without emailing for disabled, recipient-free, or ineligible schedules", async () => {
    const slot = localSlot(2032, 5, 10, 8);
    await Promise.all([
      createScheduledTenant({
        tenantId: tenantIds.disabled,
        slot,
        settingsCreatedAt: nextDaySlot(slot, -1),
        recipients: ["disabled@example.test"],
        enabled: false
      }),
      createScheduledTenant({
        tenantId: tenantIds.noRecipients,
        slot,
        settingsCreatedAt: nextDaySlot(slot, -1),
        recipients: []
      }),
      createScheduledTenant({
        tenantId: tenantIds.ineligible,
        slot,
        settingsCreatedAt: nextDaySlot(slot, -1),
        recipients: ["ineligible@example.test"]
      })
    ]);

    const license = {
      getTenantEntitlements: async (tenantId: string) => ({
        plan: "PRO",
        license: { status: tenantId === tenantIds.ineligible ? "SUSPENDED" : "ACTIVE" }
      })
    } as any;
    await runReportsCronCycle(queue, license, new Date(slot.getTime() + 5 * 60 * 60_000));

    for (const tenantId of [tenantIds.disabled, tenantIds.noRecipients, tenantIds.ineligible]) {
      assert.equal((await queuedReports(tenantId)).length, 0);
      const cursor = await cursorFor(tenantId);
      assert.ok(cursor.nextRunAt === null || cursor.nextRunAt.getTime() > slot.getTime());
    }
    assert.equal((await cursorFor(tenantIds.noRecipients)).lastSkipReason, "NO_RECIPIENTS");
    assert.equal((await cursorFor(tenantIds.ineligible)).lastSkipReason, "INELIGIBLE");

    await runReportsCronCycle(queue, activeProLicense, new Date(slot.getTime() + 6 * 60 * 60_000));
    assert.equal((await queuedReports(tenantIds.ineligible)).length, 0, "reactivation must not release a skipped report");
  });

  it("does not recover a slot that elapsed while the tenant was deactivated", async () => {
    const slot = localSlot(2032, 5, 13, 8);
    await createScheduledTenant({
      tenantId: tenantIds.reactivated,
      slot,
      settingsCreatedAt: nextDaySlot(slot, -1),
      recipients: ["reactivated@example.test"]
    });
    await prisma.tenant.update({ where: { id: tenantIds.reactivated }, data: { isActive: false } });
    await prisma.auditLog.create({
      data: {
        tenantId: tenantIds.reactivated,
        action: "PLATFORM_TENANT_STATUS_CHANGED",
        resource: "tenant",
        resourceId: tenantIds.reactivated,
        details: { before: { isActive: true }, after: { isActive: false } },
        createdAt: new Date(slot.getTime() + 60 * 60_000)
      }
    });
    await prisma.tenant.update({ where: { id: tenantIds.reactivated }, data: { isActive: true } });
    await prisma.auditLog.create({
      data: {
        tenantId: tenantIds.reactivated,
        action: "PLATFORM_TENANT_STATUS_CHANGED",
        resource: "tenant",
        resourceId: tenantIds.reactivated,
        details: { before: { isActive: false }, after: { isActive: true } },
        createdAt: new Date(slot.getTime() + 4 * 60 * 60_000)
      }
    });

    await runReportsCronCycle(queue, activeProLicense, new Date(slot.getTime() + 5 * 60 * 60_000));

    assert.equal((await queuedReports(tenantIds.reactivated)).length, 0);
    const cursor = await cursorFor(tenantIds.reactivated);
    assert.equal(cursor.lastSkipReason, "TENANT_STATUS_CHANGED");
    assert.equal(cursor.lastSkippedThrough?.getTime(), slot.getTime());
    assert.equal(cursor.nextRunAt?.getTime(), nextDaySlot(slot).getTime());
  });

  it("records actual status transitions and ignores a no-op status request", async () => {
    const slot = new Date(Date.now() - 5 * 60 * 60_000);
    slot.setSeconds(0, 0);
    await createScheduledTenant({
      tenantId: tenantIds.statusWriter,
      slot,
      settingsCreatedAt: nextDaySlot(slot, -1),
      recipients: ["status-writer@example.test"]
    });
    const repository = new PrismaPlatformAdminRepository();
    const audit = { actorUserId: `${runId}-actor`, sourceIp: "127.0.0.1" };
    assert.equal(await repository.setTenantActive(tenantIds.statusWriter, true, audit), true);
    assert.equal(await repository.setTenantActive(tenantIds.statusWriter, false, audit), true);
    assert.equal(await repository.setTenantActive(tenantIds.statusWriter, true, audit), false);

    const events = await prisma.auditLog.findMany({
      where: { tenantId: tenantIds.statusWriter, action: "PLATFORM_TENANT_STATUS_CHANGED" },
      orderBy: { createdAt: "asc" }
    });
    assert.equal(events.length, 2);
    assert.deepEqual((events[0]?.details as any)?.before, { isActive: true });
    assert.deepEqual((events[1]?.details as any)?.before, { isActive: false });
    assert.ok(events.every((event) => event.createdAt.getTime() > slot.getTime()));

    await runReportsCronCycle(queue, activeProLicense, new Date());
    assert.equal((await queuedReports(tenantIds.statusWriter)).length, 0);
    assert.equal((await cursorFor(tenantIds.statusWriter)).lastSkipReason, "TENANT_STATUS_CHANGED");
  });

  it("rechecks tenant and license after report generation before advancing the cursor", async () => {
    const slot = localSlot(2032, 5, 14, 8);
    await Promise.all([
      createScheduledTenant({
        tenantId: tenantIds.tenantInactiveDuring,
        slot,
        settingsCreatedAt: nextDaySlot(slot, -1),
        recipients: ["tenant-race@example.test"]
      }),
      createScheduledTenant({
        tenantId: tenantIds.licenseChangedDuring,
        slot,
        settingsCreatedAt: nextDaySlot(slot, -1),
        recipients: ["license-race@example.test"]
      }),
      createScheduledTenant({
        tenantId: tenantIds.licenseRestoredDuring,
        slot,
        settingsCreatedAt: nextDaySlot(slot, -1),
        recipients: ["license-restored@example.test"]
      })
    ]);
    let licenseReads = 0;
    let restorationReads = 0;
    const changingLicense = {
      getTenantEntitlements: async (tenantId: string) => {
        if (tenantId === tenantIds.tenantInactiveDuring) {
          await prisma.tenant.update({ where: { id: tenantId }, data: { isActive: false } });
          return { plan: "PRO", license: { status: "ACTIVE" } };
        }
        if (tenantId === tenantIds.licenseChangedDuring) {
          licenseReads += 1;
          return { plan: "PRO", license: { status: licenseReads === 1 ? "ACTIVE" : "SUSPENDED" } };
        }
        if (tenantId === tenantIds.licenseRestoredDuring) {
          restorationReads += 1;
          return { plan: "PRO", license: { status: restorationReads === 1 ? "SUSPENDED" : "ACTIVE" } };
        }
        return { plan: "PRO", license: { status: "ACTIVE" } };
      }
    } as any;
    await runReportsCronCycle(queue, changingLicense, slot);

    assert.equal((await queuedReports(tenantIds.tenantInactiveDuring)).length, 0);
    assert.equal((await cursorFor(tenantIds.tenantInactiveDuring)).lastSkipReason, "TENANT_INACTIVE");
    assert.equal((await queuedReports(tenantIds.licenseChangedDuring)).length, 0);
    assert.equal((await cursorFor(tenantIds.licenseChangedDuring)).lastSkipReason, "INELIGIBLE");
    assert.equal(licenseReads, 2);
    assert.equal((await queuedReports(tenantIds.licenseRestoredDuring)).length, 0);
    assert.equal((await cursorFor(tenantIds.licenseRestoredDuring)).nextRunAt?.getTime(), slot.getTime());
    await runReportsCronCycle(queue, activeProLicense, new Date(slot.getTime() + 60_000));
    assert.equal((await queuedReports(tenantIds.licenseRestoredDuring)).length, 1);
  });

  it("saving new settings invalidates a due cursor tied to the old audit row", async () => {
    const slot = new Date(Date.now() - 60 * 60_000);
    slot.setSeconds(0, 0);
    const old = await createScheduledTenant({
      tenantId: tenantIds.changed,
      slot,
      settingsCreatedAt: nextDaySlot(slot, -1),
      recipients: ["old-recipient@example.test"]
    });
    const earlier = nextDaySlot(slot, -1);
    await cursorModel.update({
      where: { tenantId: tenantIds.changed },
      data: { lastSkippedFrom: earlier, lastSkippedThrough: earlier, lastSkipReason: "BACKLOG" }
    });
    const now = new Date();
    const newHour = (now.getHours() + 1) % 24;
    const settingsService = new SettingsService(new PrismaAuditLogRepository());
    await settingsService.setByResource(tenantIds.changed, undefined, "reports", {
      enabled: true,
      frequency: "weekly",
      hour: newHour,
      minute: 0,
      reportStyle: "BASIC",
      recipients: ["new-recipient@example.test"]
    });

    const latestSettings = await prisma.auditLog.findFirstOrThrow({
      where: { tenantId: tenantIds.changed, action: "SETTINGS_REPORTS", resource: "reports" },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }]
    });
    assert.notEqual(latestSettings.id, old.id);

    await runReportsCronCycle(queue, activeProLicense, new Date(now.getTime() + 60_000));

    assert.equal((await queuedReports(tenantIds.changed)).length, 0);
    const cursor = await cursorFor(tenantIds.changed);
    assert.equal(cursor.settingsAuditLogId, latestSettings.id);
    assert.ok(cursor.nextRunAt === null || cursor.nextRunAt.getTime() > now.getTime());
    assert.equal(cursor.lastSkippedFrom?.getTime(), earlier.getTime());
    assert.equal(cursor.lastSkippedThrough?.getTime(), earlier.getTime());
    assert.equal(cursor.lastSkipReason, "BACKLOG");
  });

  it("serializes concurrent settings saves so the cursor names the newest audit row", async () => {
    await prisma.tenant.create({
      data: { id: tenantIds.concurrentSettings, name: `${runId} synthetic concurrent settings` }
    });
    const settingsService = new SettingsService(new PrismaAuditLogRepository());
    const slot = localSlot(2032, 5, 12, 8);
    await Promise.all([
      settingsService.setByResource(tenantIds.concurrentSettings, undefined, "reports", dailySettings(slot, ["one@example.test"])),
      settingsService.setByResource(tenantIds.concurrentSettings, undefined, "reports", dailySettings(nextDaySlot(slot, 0), ["two@example.test"]))
    ]);

    const latestSettings = await prisma.auditLog.findFirstOrThrow({
      where: { tenantId: tenantIds.concurrentSettings, action: "SETTINGS_REPORTS", resource: "reports" },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }]
    });
    const cursor = await cursorFor(tenantIds.concurrentSettings);
    assert.equal(cursor.settingsAuditLogId, latestSettings.id);
  });

  it("does not retrospectively deliver a slot that predates new settings", async () => {
    const slot = localSlot(2032, 5, 11, 8);
    await createScheduledTenant({
      tenantId: tenantIds.retroactive,
      slot,
      settingsCreatedAt: new Date(slot.getTime() + 60_000),
      recipients: ["retroactive@example.test"]
    });

    await runReportsCronCycle(queue, activeProLicense, new Date(slot.getTime() + 5 * 60_000));

    assert.equal((await queuedReports(tenantIds.retroactive)).length, 0);
    assert.ok((await cursorFor(tenantIds.retroactive)).nextRunAt?.getTime() > slot.getTime());
  });
});
