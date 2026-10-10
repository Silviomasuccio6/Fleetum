import assert from "node:assert/strict";
import { after, afterEach, before, describe, it } from "node:test";
import { ManageStoppagesUseCases } from "../../src/application/usecases/stoppages/manage-stoppages-usecases.js";
import { GetDashboardStatsUseCase } from "../../src/application/usecases/stats/get-dashboard-stats-usecase.js";
import { LicensePolicyService } from "../../src/application/services/license-policy-service.js";
import { VehicleProfitabilityReportService } from "../../src/application/services/vehicle-profitability-report-service.js";
import { prisma } from "../../src/infrastructure/database/prisma/client.js";
import { runReportsCronCycle } from "../../src/infrastructure/cron/reports-cron.js";
import { EmailQueueService } from "../../src/infrastructure/email/email-queue-service.js";
import { PrismaAuditLogRepository } from "../../src/infrastructure/repositories/prisma-audit-log-repository.js";
import { PrismaNotificationsRepository } from "../../src/infrastructure/repositories/prisma-notifications-repository.js";
import { PrismaStoppageOpsRepository } from "../../src/infrastructure/repositories/prisma-stoppage-ops-repository.js";
import { PrismaStoppageRepository } from "../../src/infrastructure/repositories/prisma-stoppage-repository.js";
import { StoppagesController } from "../../src/interfaces/http/controllers/stoppages-controller.js";

const runId = `stoppage-ownership-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const ownedTenantIds: string[] = [];
const repository = new PrismaStoppageRepository();
const useCases = new ManageStoppagesUseCases(repository);
const ops = new PrismaStoppageOpsRepository();
const notifications = new PrismaNotificationsRepository();
const stats = new GetDashboardStatsUseCase();
const dayMs = 24 * 60 * 60_000;
let sequence = 0;

const fixture = async (suffix: string) => {
  const marker = `SYNTHETIC_${suffix.toUpperCase()}_${sequence++}`;
  const tenant = await prisma.tenant.create({ data: { id: `${runId}-${suffix}-${sequence}`, name: marker } });
  ownedTenantIds.push(tenant.id);
  const user = await prisma.user.create({ data: {
    tenantId: tenant.id, email: `${suffix}-${sequence}@example.test`, passwordHash: "synthetic-unused-hash",
    firstName: marker, lastName: "Synthetic"
  } });
  const site = await prisma.site.create({ data: { tenantId: tenant.id, name: `${marker}_SITE`, address: "Synthetic", city: "Synthetic" } });
  const workshop = await prisma.workshop.create({ data: { tenantId: tenant.id, name: `${marker}_WORKSHOP`, email: `${suffix}-workshop-${sequence}@example.test` } });
  const vehicle = await prisma.vehicle.create({ data: {
    tenantId: tenant.id, siteId: site.id, plate: `${marker}_PLATE`, brand: marker, model: `${marker}_MODEL`
  } });
  const stoppage = await prisma.stoppage.create({ data: {
    tenantId: tenant.id, siteId: site.id, vehicleId: vehicle.id, workshopId: workshop.id,
    createdByUserId: user.id, assignedToUserId: user.id, reason: `${marker}_REASON`, priority: "LOW",
    openedAt: new Date(Date.now() - dayMs), estimatedCostPerDay: 17, reminderAfterDays: 1
  } });
  return { tenant, user, site, workshop, vehicle, stoppage, marker };
};
type Fixture = Awaited<ReturnType<typeof fixture>>;

const pair = async () => ({ a: await fixture("owner-a"), b: await fixture("foreign-b") });
const createInput = (owner: Fixture): Record<string, unknown> => ({
  siteId: owner.site.id, vehicleId: owner.vehicle.id, workshopId: owner.workshop.id,
  createdByUserId: owner.user.id, assignedToUserId: owner.user.id,
  reason: `Unique synthetic new stoppage ${sequence++}`, openedAt: new Date(), priority: "LOW"
});

const assert4xx = async (work: () => Promise<unknown>) => {
  await assert.rejects(work, (error: unknown) => {
    assert.ok(error instanceof Error, "rejected domain request must return an error");
    const status = (error as any).statusCode;
    assert.ok(Number.isInteger(status) && status >= 400 && status < 500, `expected explicit 4xx, received ${String(status)}`);
    return true;
  });
};

const snapshot = async () => {
  const ids = { in: [...ownedTenantIds] };
  return JSON.stringify({
    stoppages: await prisma.stoppage.findMany({ where: { tenantId: ids }, orderBy: { id: "asc" } }),
    events: await prisma.stoppageEvent.findMany({ where: { tenantId: ids }, orderBy: { id: "asc" } }),
    reminders: await prisma.reminder.findMany({ where: { tenantId: ids }, orderBy: { id: "asc" } }),
    queued: await prisma.emailQueue.findMany({ where: { tenantId: ids }, orderBy: { id: "asc" } })
  });
};

const assertNoMutation = async (work: () => Promise<unknown>) => {
  const before = await snapshot();
  await assert4xx(work);
  assert.equal(await snapshot(), before, "denial must not modify either tenant or append side effects");
};

const createLegacy = async (owner: Fixture, foreign: Fixture, relation = "all") => {
  const fields: Record<string, string> = relation === "all"
    ? { siteId: foreign.site.id, vehicleId: foreign.vehicle.id, workshopId: foreign.workshop.id }
    : { [relation]: relation === "createdByUserId" || relation === "assignedToUserId" ? foreign.user.id : (foreign as any)[relation.replace(/Id$/, "")].id };
  return prisma.stoppage.create({ data: {
    tenantId: owner.tenant.id, siteId: owner.site.id, vehicleId: owner.vehicle.id, workshopId: owner.workshop.id,
    createdByUserId: owner.user.id, reason: `${foreign.marker}_LEGACY_${relation}`, openedAt: new Date(Date.now() - dayMs),
    estimatedCostPerDay: 999, ...fields
  } });
};

const downstreamFixture = async () => {
  const { a, b } = await pair();
  const corrupted = await createLegacy(a, b);
  await prisma.stoppage.update({ where: { id: corrupted.id }, data: { assignedToUserId: a.user.id, priority: "CRITICAL" } });
  const historical = await prisma.stoppage.create({ data: {
    tenantId: a.tenant.id, siteId: a.site.id, vehicleId: a.vehicle.id, workshopId: a.workshop.id,
    createdByUserId: a.user.id, assignedToUserId: a.user.id, reason: "Synthetic owned deleted history", status: "CLOSED",
    openedAt: new Date(Date.now() - 5 * dayMs), closedAt: new Date(Date.now() - 2 * dayMs), deletedAt: new Date()
  } });
  const corruptHistorical = await createLegacy(a, b);
  await prisma.stoppage.update({ where: { id: corruptHistorical.id }, data: { deletedAt: new Date() } });
  await prisma.reminder.createMany({ data: [
    { tenantId: a.tenant.id, stoppageId: b.stoppage.id, type: "MANUAL", channel: "EMAIL", recipient: "foreign-parent@example.test", body: b.marker, success: false, errorMessage: b.marker },
    { tenantId: a.tenant.id, stoppageId: corrupted.id, type: "MANUAL", channel: "EMAIL", recipient: "corrupt-parent@example.test", body: b.marker, success: false, errorMessage: b.marker },
    { tenantId: a.tenant.id, stoppageId: corruptHistorical.id, type: "MANUAL", channel: "EMAIL", recipient: "corrupt-history@example.test", body: b.marker, success: false, errorMessage: b.marker },
    { tenantId: b.tenant.id, stoppageId: a.stoppage.id, type: "MANUAL", channel: "EMAIL", recipient: "foreign-child@example.test", body: b.marker, success: false, errorMessage: b.marker }
  ] });
  const ownReminder = await prisma.reminder.create({ data: {
    tenantId: a.tenant.id, stoppageId: a.stoppage.id, type: "MANUAL", channel: "EMAIL", recipient: "owned-current@example.test", body: a.marker
  } });
  const historicalReminder = await prisma.reminder.create({ data: {
    tenantId: a.tenant.id, stoppageId: historical.id, type: "AUTOMATIC", channel: "EMAIL", recipient: "owned-history@example.test", body: "Synthetic owned history", success: false, errorMessage: "Synthetic historical failure"
  } });
  await prisma.stoppageEvent.createMany({ data: [
    { tenantId: a.tenant.id, stoppageId: b.stoppage.id, userId: a.user.id, type: "SYNTHETIC", message: b.marker, payload: { marker: b.marker } },
    { tenantId: b.tenant.id, stoppageId: a.stoppage.id, userId: b.user.id, type: "SYNTHETIC", message: b.marker, payload: { marker: b.marker } }
  ] });
  return { a, b, corrupted, historical, ownReminder, historicalReminder };
};

const response = () => ({
  statusCode: 200, body: undefined as unknown,
  status(code: number) { this.statusCode = code; return this; },
  json(body: unknown) { this.body = body; return this; },
  send(body?: unknown) { this.body = body; return this; }
});
const controller = () => new StoppagesController(useCases, {} as any, ops);
const request = (owner: Fixture, id: string, body: Record<string, unknown> = {}) => ({
  auth: { tenantId: owner.tenant.id, userId: owner.user.id }, params: { id }, body, query: {}
} as any);

describe("stoppage ownership across mutations and projections", { concurrency: false }, () => {
  before(async () => { await prisma.$connect(); });
  afterEach(async () => {
    const ids = { in: [...ownedTenantIds] };
    await prisma.emailQueue.deleteMany({ where: { tenantId: ids } });
    await prisma.reminder.deleteMany({ where: { OR: [{ tenantId: ids }, { stoppage: { tenantId: ids } }] } });
    await prisma.stoppageEvent.deleteMany({ where: { OR: [{ tenantId: ids }, { stoppage: { tenantId: ids } }] } });
    await prisma.stoppagePhoto.deleteMany({ where: { stoppage: { tenantId: ids } } });
    await prisma.stoppage.deleteMany({ where: { tenantId: ids } });
    await prisma.vehicle.deleteMany({ where: { tenantId: ids } });
    await prisma.workshop.deleteMany({ where: { tenantId: ids } });
    await prisma.site.deleteMany({ where: { tenantId: ids } });
    await prisma.user.deleteMany({ where: { tenantId: ids } });
    await prisma.scheduledReportCursor.deleteMany({ where: { tenantId: ids } });
    await prisma.auditLog.deleteMany({ where: { tenantId: ids } });
    await prisma.tenantSubscription.deleteMany({ where: { tenantId: ids } });
    await prisma.tenant.deleteMany({ where: { id: { in: ownedTenantIds.splice(0) } } });
  });
  after(async () => { await prisma.$disconnect(); });

  for (const relation of ["site", "vehicle", "workshop"] as const) {
    for (const condition of ["foreign", "missing", "deleted"] as const) {
      for (const operation of ["create", "update"] as const) {
        it(`${operation} rejects a ${condition} ${relation} without changes or foreign response data`, async () => {
          const { a, b } = await pair();
          let deletedId: string | undefined;
          if (condition === "deleted") {
            const candidate = await (prisma[relation] as any).create({ data: {
              tenantId: a.tenant.id, deletedAt: new Date(),
              ...(relation === "site" ? { name: "Synthetic deleted site", address: "Synthetic", city: "Synthetic" }
                : relation === "vehicle" ? { siteId: a.site.id, plate: `DELETED-${sequence++}`, brand: "Synthetic", model: "Synthetic" }
                  : { name: "Synthetic deleted workshop" })
            } });
            deletedId = candidate.id;
          }
          const target = condition === "foreign" ? b[relation].id : condition === "missing" ? `${runId}-missing-${relation}` : deletedId!;
          const input = operation === "create" ? { ...createInput(a), [`${relation}Id`]: target } : { [`${relation}Id`]: target, notes: "must not persist" };
          await assertNoMutation(() => operation === "create"
            ? useCases.create(a.tenant.id, input)
            : useCases.update(a.tenant.id, a.stoppage.id, input));
        });
      }
    }

    it(`allows same-tenant inactive ${relation} in a new assignment`, async () => {
      const a = await fixture(`inactive-${relation}`);
      await (prisma[relation] as any).update({ where: { id: a[relation].id }, data: { isActive: false } });
      const created = await useCases.create(a.tenant.id, createInput(a)) as any;
      assert.equal(created[`${relation}Id`], a[relation].id);
      assert.equal(created.tenantId, a.tenant.id);
      assert.equal(created[relation].isActive, false);
    });

    it(`preserves an owned soft-deleted historical ${relation} during a partial status patch`, async () => {
      const a = await fixture(`historical-${relation}`);
      await (prisma[relation] as any).update({ where: { id: a[relation].id }, data: { deletedAt: new Date(), isActive: false } });
      const updated = await useCases.update(a.tenant.id, a.stoppage.id, { status: "IN_PROGRESS" }) as any;
      assert.equal(updated.status, "IN_PROGRESS");
      assert.equal(updated[`${relation}Id`], a[relation].id);
      assert.equal(updated[relation].tenantId, a.tenant.id);
      assert.ok(updated[relation].deletedAt);
    });
  }

  for (const field of ["createdByUserId", "assignedToUserId"] as const) {
    for (const condition of ["foreign", "missing", "deleted"] as const) {
      it(`create rejects ${condition} ${field}`, async () => {
        const { a, b } = await pair();
        if (condition === "deleted") await prisma.user.update({ where: { id: a.user.id }, data: { deletedAt: new Date() } });
        const userId = condition === "foreign" ? b.user.id : condition === "missing" ? `${runId}-missing-user` : a.user.id;
        await assertNoMutation(() => useCases.create(a.tenant.id, { ...createInput(a), [field]: userId }));
      });
    }
  }

  for (const condition of ["foreign", "missing", "deleted"] as const) {
    it(`update rejects ${condition} assignee without changes`, async () => {
      const { a, b } = await pair();
      const deleted = condition === "deleted" ? await prisma.user.create({ data: {
        tenantId: a.tenant.id, email: "deleted-assignee@example.test", passwordHash: "synthetic-unused-hash", firstName: "Synthetic", lastName: "Deleted", deletedAt: new Date()
      } }) : null;
      const userId = condition === "foreign" ? b.user.id : condition === "missing" ? `${runId}-missing-assignee` : deleted!.id;
      await assertNoMutation(() => useCases.update(a.tenant.id, a.stoppage.id, { assignedToUserId: userId }));
    });
  }

  it("accepts a same-tenant nondeleted suspended assignee without imposing an ACTIVE gate", async () => {
    const a = await fixture("suspended-assignee");
    await prisma.user.update({ where: { id: a.user.id }, data: { status: "SUSPENDED" } });
    const created = await useCases.create(a.tenant.id, createInput(a)) as any;
    assert.equal(created.assignedToUserId, a.user.id);
    const updated = await useCases.update(a.tenant.id, a.stoppage.id, { assignedToUserId: a.user.id }) as any;
    assert.equal(updated.assignedToUserId, a.user.id);
  });

  it("allows clearing an owned assignee", async () => {
    const a = await fixture("clear-assignee");
    const updated = await useCases.update(a.tenant.id, a.stoppage.id, { assignedToUserId: null }) as any;
    assert.equal(updated.assignedToUserId, null);
  });

  it("keeps the existing explicit workshop snapshot override behavior", async () => {
    const a = await fixture("snapshot-override");
    const created = await useCases.create(a.tenant.id, {
      ...createInput(a), workshopEmailSnapshot: "override@example.test", workshopPhoneSnapshot: "000000000",
      workshopWhatsappSnapshot: "000000001"
    }) as any;
    assert.equal(created.workshopEmailSnapshot, "override@example.test");
    assert.equal(created.workshopPhoneSnapshot, "000000000");
    const updated = await useCases.update(a.tenant.id, created.id, { workshopEmailSnapshot: "updated@example.test" }) as any;
    assert.equal(updated.workshopEmailSnapshot, "updated@example.test");
    assert.equal(updated.workshopWhatsappSnapshot, "000000001");
  });

  it("preserves a deleted historical creator and assignee during a partial status patch", async () => {
    const a = await fixture("historical-user");
    await prisma.user.update({ where: { id: a.user.id }, data: { deletedAt: new Date(), status: "SUSPENDED" } });
    const updated = await useCases.update(a.tenant.id, a.stoppage.id, { status: "WAITING_PARTS" }) as any;
    assert.equal(updated.status, "WAITING_PARTS");
    assert.equal(updated.createdByUserId, a.user.id);
    assert.equal(updated.assignedToUserId, a.user.id);
  });

  it("does not allow replacing an immutable creator with another owned user", async () => {
    const a = await fixture("immutable-creator");
    const replacement = await prisma.user.create({ data: {
      tenantId: a.tenant.id, email: "replacement@example.test", passwordHash: "synthetic-unused-hash", firstName: "Synthetic", lastName: "Replacement"
    } });
    await assertNoMutation(() => repository.update(a.tenant.id, a.stoppage.id, { createdByUserId: replacement.id }));
  });

  for (const operation of ["create", "update"] as const) {
    for (const field of ["tenantId", "id", "deletedAt", "createdAt", "lastReminderSentAt", "totalRemindersSent"] as const) {
      it(`repository ${operation} rejects client-controlled ${field}`, async () => {
        const { a, b } = await pair();
        const values: Record<string, unknown> = {
          tenantId: b.tenant.id, id: `${runId}-injected-id`, deletedAt: new Date(), createdAt: new Date(0),
          lastReminderSentAt: new Date(), totalRemindersSent: 999
        };
        const input = operation === "create" ? { ...createInput(a), [field]: values[field] } : { [field]: values[field] };
        await assertNoMutation(() => operation === "create" ? repository.create(a.tenant.id, input) : repository.update(a.tenant.id, a.stoppage.id, input));
      });
    }

    for (const nested of ["tenant", "site", "vehicle", "workshop", "createdBy", "reminders", "events", "photos"] as const) {
      it(`repository ${operation} rejects nested ${nested} mutation injection`, async () => {
        const { a, b } = await pair();
        const target = nested === "tenant" ? b.tenant.id : nested === "createdBy" ? b.user.id : (b as any)[nested]?.id ?? b.stoppage.id;
        const input = operation === "create" ? { ...createInput(a), [nested]: { connect: { id: target } } } : { [nested]: { connect: { id: target } } };
        await assertNoMutation(() => operation === "create" ? repository.create(a.tenant.id, input) : repository.update(a.tenant.id, a.stoppage.id, input));
      });
    }
  }

  for (const operation of ["update", "remove", "updateStatus"] as const) {
    it(`controller ${operation} rejects a foreign stoppage without events or changes`, async () => {
      const { a, b } = await pair();
      const res = response();
      const body = operation === "updateStatus" ? { status: "CLOSED" } : { notes: "must not persist" };
      await assertNoMutation(() => controller()[operation](request(a, b.stoppage.id, body), res as any));
      assert.equal(res.body, undefined, "foreign target must not appear in a successful response");
    });
  }

  for (const operation of ["update", "delete"] as const) {
    it(`repository ${operation} rejects a foreign stoppage target`, async () => {
      const { a, b } = await pair();
      await assertNoMutation(() => operation === "update"
        ? repository.update(a.tenant.id, b.stoppage.id, { notes: "must not persist" })
        : repository.delete(a.tenant.id, b.stoppage.id));
    });
  }

  it("legitimate closure records its checklist and status event only on its owned stoppage", async () => {
    const a = await fixture("safe-close");
    const res = response();
    await controller().updateStatus(request(a, a.stoppage.id, { status: "CLOSED" }), res as any);
    assert.equal((res.body as any).id, a.stoppage.id);
    assert.equal((res.body as any).status, "CLOSED");
    assert.ok((res.body as any).closedAt);
    const events = await prisma.stoppageEvent.findMany({ where: { tenantId: a.tenant.id, stoppageId: a.stoppage.id } });
    assert.deepEqual(events.map((row) => row.type).sort(), ["CLOSURE_CHECKLIST", "STATUS_CHANGED"]);
  });

  for (const relation of ["siteId", "vehicleId", "workshopId", "createdByUserId", "assignedToUserId"] as const) {
    it(`hides an existing legacy stoppage with a foreign ${relation} from all ordinary read boundaries`, async () => {
      const { a, b } = await pair();
      const corrupted = await createLegacy(a, b, relation);
      assert.equal(await repository.getById(a.tenant.id, corrupted.id), null);
      const listed = await repository.list(a.tenant.id, { skip: 0, take: 100 });
      assert.equal(listed.total, 1);
      assert.deepEqual(listed.data.map((row: any) => row.id), [a.stoppage.id]);
      const searched = await repository.list(a.tenant.id, { search: b.marker, skip: 0, take: 100 });
      assert.equal(searched.total, 0);
      assert.deepEqual(searched.data, []);
      const paginated = await repository.list(a.tenant.id, { skip: 1, take: 1 });
      assert.equal(paginated.total, 1);
      assert.deepEqual(paginated.data, []);
      assert.equal((await prisma.stoppage.findUniqueOrThrow({ where: { id: corrupted.id } }))[relation], relation === "createdByUserId" || relation === "assignedToUserId" ? b.user.id : (b as any)[relation.replace(/Id$/, "")].id, "read filtering must not silently repair legacy data");
    });
  }

  it("includes historical same-tenant references without exposing a foreign reminder", async () => {
    const { a, b } = await pair();
    await prisma.site.update({ where: { id: a.site.id }, data: { deletedAt: new Date(), isActive: false } });
    const foreignReminder = await prisma.reminder.create({ data: {
      tenantId: b.tenant.id, stoppageId: a.stoppage.id, type: "MANUAL", channel: "EMAIL", recipient: "foreign@example.test", body: b.marker
    } });
    const ownReminder = await prisma.reminder.create({ data: {
      tenantId: a.tenant.id, stoppageId: a.stoppage.id, type: "MANUAL", channel: "EMAIL", recipient: "owned@example.test", body: a.marker
    } });
    const item = await repository.getById(a.tenant.id, a.stoppage.id) as any;
    assert.equal(item.site.id, a.site.id);
    assert.deepEqual(item.reminders.map((row: any) => row.id), [ownReminder.id]);
    const listed = await repository.list(a.tenant.id, { skip: 0, take: 100 }) as any;
    assert.ok(!JSON.stringify(listed).includes(foreignReminder.id));
    assert.ok(!JSON.stringify(listed).includes(b.marker));
  });

  it("rejects mutations of a corrupt legacy stoppage without automatically repairing it", async () => {
    const { a, b } = await pair();
    const corrupted = await createLegacy(a, b);
    await assertNoMutation(() => useCases.update(a.tenant.id, corrupted.id, { status: "IN_PROGRESS" }));
    await assertNoMutation(() => repository.delete(a.tenant.id, corrupted.id));
  });

  for (const method of ["listCalendarRows", "listCostRows", "listOpenStoppagesForAssignment"] as const) {
    it(`${method} excludes corrupt legacy stoppages and foreign markers`, async () => {
      const { a, b } = await pair();
      await createLegacy(a, b);
      const args = method === "listOpenStoppagesForAssignment" ? [a.tenant.id] : [a.tenant.id, new Date(Date.now() - 3 * dayMs), new Date(Date.now() + dayMs)];
      const rows = await (ops[method] as any)(...args);
      assert.equal(rows.length, 1);
      assert.ok(!JSON.stringify(rows).includes(b.marker));
      assert.ok(!JSON.stringify(rows).includes(b.user.id));
    });
  }

  it("notifications omit corrupt stoppages before limiting and omit reminders on foreign or corrupt targets", async () => {
    const { a, b } = await pair();
    const corrupted = await createLegacy(a, b);
    await prisma.stoppage.update({ where: { id: corrupted.id }, data: { openedAt: new Date(0) } });
    const rows = await notifications.listOpenStoppages(a.tenant.id, 1);
    assert.deepEqual(rows.map((row) => row.id), [a.stoppage.id]);
    await prisma.reminder.createMany({ data: [
      { tenantId: a.tenant.id, stoppageId: b.stoppage.id, type: "MANUAL", channel: "EMAIL", recipient: "foreign-target@example.test", body: "Synthetic", success: false, errorMessage: b.marker },
      { tenantId: a.tenant.id, stoppageId: corrupted.id, type: "MANUAL", channel: "EMAIL", recipient: "corrupt-target@example.test", body: "Synthetic", success: false, errorMessage: b.marker }
    ] });
    const owned = await prisma.reminder.create({ data: {
      tenantId: a.tenant.id, stoppageId: a.stoppage.id, type: "MANUAL", channel: "EMAIL", recipient: "owned@example.test", body: "Synthetic", success: false, errorMessage: a.marker
    } });
    const failures = await notifications.listFailedReminders(a.tenant.id, 100);
    assert.deepEqual(failures.map((row) => row.id), [owned.id]);
    assert.ok(!JSON.stringify(failures).includes(b.marker));
  });

  for (const target of ["foreign", "corrupt"] as const) {
    it(`event append rejects a ${target} stoppage target`, async () => {
      const { a, b } = await pair();
      const id = target === "foreign" ? b.stoppage.id : (await createLegacy(a, b)).id;
      await assertNoMutation(() => ops.createEvent({ tenantId: a.tenant.id, stoppageId: id, userId: a.user.id, type: "UPDATED", message: "Synthetic event" }));
    });

    it(`event readers hide legacy events attached to a ${target} stoppage`, async () => {
      const { a, b } = await pair();
      const id = target === "foreign" ? b.stoppage.id : (await createLegacy(a, b)).id;
      await prisma.stoppageEvent.create({ data: { tenantId: a.tenant.id, stoppageId: id, userId: a.user.id, type: "SYNTHETIC", message: b.marker, payload: { marker: b.marker } } });
      assert.deepEqual(await ops.listEvents(a.tenant.id, id, 100), []);
      assert.deepEqual(await ops.listEventsByType(a.tenant.id, id, "SYNTHETIC"), []);
      assert.equal(await ops.findLatestEventByType(a.tenant.id, id, "SYNTHETIC"), null);
    });
  }

  it("event append rejects a foreign user even on an owned stoppage", async () => {
    const { a, b } = await pair();
    await assertNoMutation(() => ops.createEvent({ tenantId: a.tenant.id, stoppageId: a.stoppage.id, userId: b.user.id, type: "UPDATED", message: "Synthetic event" }));
  });

  it("legitimate owned events remain available through every event reader", async () => {
    const a = await fixture("own-events");
    await ops.createEvent({ tenantId: a.tenant.id, stoppageId: a.stoppage.id, userId: a.user.id, type: "SYNTHETIC", message: "Synthetic owned event", payload: { marker: a.marker } });
    assert.equal((await ops.listEvents(a.tenant.id, a.stoppage.id, 100)).length, 1);
    assert.equal((await ops.listEventsByType(a.tenant.id, a.stoppage.id, "SYNTHETIC")).length, 1);
    assert.ok(await ops.findLatestEventByType(a.tenant.id, a.stoppage.id, "SYNTHETIC"));
  });

  for (const actor of ["foreign", "missing", "foreign-tenant"] as const) {
    it(`event readers and cost variance ignore a legacy event with ${actor === "foreign-tenant" ? "a foreign child tenant" : `a ${actor} actor`}`, async () => {
      const { a, b } = await pair();
      const now = Date.now();
      const valid = await prisma.stoppageEvent.create({ data: {
        tenantId: a.tenant.id, stoppageId: a.stoppage.id, userId: a.user.id,
        type: "FINAL_COST", message: "Synthetic owned final cost", payload: { actualTotalCost: 200 }, createdAt: new Date(now - 1000)
      } });
      const userId = actor === "foreign" ? b.user.id : actor === "missing" ? `${runId}-missing-actor` : a.user.id;
      const invalid = await prisma.stoppageEvent.create({ data: {
        tenantId: actor === "foreign-tenant" ? b.tenant.id : a.tenant.id, stoppageId: a.stoppage.id, userId,
        type: "FINAL_COST", message: b.marker, payload: { actualTotalCost: 99999, marker: b.marker }, createdAt: new Date(now)
      } });
      const rows = await ops.listEvents(a.tenant.id, a.stoppage.id, 100);
      assert.deepEqual(rows.map((row) => row.id), [valid.id]);
      assert.deepEqual((await ops.listEventsByType(a.tenant.id, a.stoppage.id, "FINAL_COST")).map((row) => row.id), [valid.id]);
      assert.equal((await ops.findLatestEventByType(a.tenant.id, a.stoppage.id, "FINAL_COST"))?.id, valid.id);
      assert.ok(!JSON.stringify(rows).includes(invalid.id));
      assert.ok(!JSON.stringify(rows).includes(b.marker));
      const res = response();
      await controller().costsVariance(request(a, a.stoppage.id), res as any);
      assert.equal((res.body as any).kpis.totalWithConsuntivo, 1);
      assert.equal((res.body as any).kpis.actualTotal, 200);
      assert.equal((res.body as any).data[0].actual, 200);
      assert.ok(!JSON.stringify(res.body).includes(b.marker));
    });
  }

  it("event readers preserve system events and same-tenant deleted historical actors", async () => {
    const a = await fixture("historical-event-actor");
    const historical = await prisma.stoppageEvent.create({ data: {
      tenantId: a.tenant.id, stoppageId: a.stoppage.id, userId: a.user.id,
      type: "SYNTHETIC", message: "Synthetic historical operator", payload: { marker: a.marker }, createdAt: new Date(Date.now() - 1000)
    } });
    await prisma.user.update({ where: { id: a.user.id }, data: { deletedAt: new Date(), status: "SUSPENDED" } });
    const system = await prisma.stoppageEvent.create({ data: {
      tenantId: a.tenant.id, stoppageId: a.stoppage.id, userId: null,
      type: "SYNTHETIC", message: "Synthetic system event"
    } });
    const rows = await ops.listEvents(a.tenant.id, a.stoppage.id, 100);
    assert.deepEqual(rows.map((row) => row.id), [system.id, historical.id]);
    assert.deepEqual((await ops.listEventsByType(a.tenant.id, a.stoppage.id, "SYNTHETIC")).map((row) => row.id), [system.id, historical.id]);
    assert.equal((await ops.findLatestEventByType(a.tenant.id, a.stoppage.id, "SYNTHETIC"))?.id, system.id);
  });

  it("safe deletion retains a DELETED event after soft deletion", async () => {
    const a = await fixture("safe-delete");
    const res = response();
    await controller().remove(request(a, a.stoppage.id), res as any);
    assert.equal(res.statusCode, 204);
    const deleted = await prisma.stoppage.findUniqueOrThrow({ where: { id: a.stoppage.id } });
    assert.ok(deleted.deletedAt);
    const events = await prisma.stoppageEvent.findMany({ where: { tenantId: a.tenant.id, stoppageId: a.stoppage.id } });
    assert.deepEqual(events.map((row) => row.type), ["DELETED"]);
    assert.equal(events[0]!.userId, a.user.id);
    assert.equal(await repository.getById(a.tenant.id, a.stoppage.id), null);
  });

  it("dashboard counts and feeds exclude corrupt parents and foreign children while retaining owned deleted reminder history", async () => {
    const { a, b, ownReminder, historicalReminder } = await downstreamFixture();
    const result = await stats.dashboardOverview(a.tenant.id);
    assert.equal(result.kpis.totalStoppages, 1);
    assert.equal(result.kpis.openStoppages, 1);
    assert.equal(result.kpis.criticalOpen, 0);
    assert.equal(result.feeds.recentStoppages.length, 1);
    assert.deepEqual(result.feeds.recentReminders.map((row) => row.id).sort(), [ownReminder.id, historicalReminder.id].sort());
    assert.ok(!JSON.stringify(result).includes(b.marker));
    assert.ok(!JSON.stringify(result).includes(b.vehicle.plate));
  });

  it("analytics counts, costs, charts and failures exclude corrupt parents and foreign reminder children", async () => {
    const { a, b } = await downstreamFixture();
    const result = await stats.analytics(a.tenant.id, { dateFrom: new Date(Date.now() - 7 * dayMs), dateTo: new Date(Date.now() + dayMs) });
    assert.equal(result.kpis.totalStoppages, 1);
    assert.equal(result.kpis.openStoppages, 1);
    assert.equal(result.kpis.criticalOpen, 0);
    assert.equal(result.kpis.remindersTotal, 1);
    assert.equal(result.kpis.reminderSuccessRate, 100);
    assert.equal(result.tables.reminderFailures.length, 0);
    assert.deepEqual(result.charts.byWorkshop, [{ name: a.workshop.name, count: 1 }]);
    assert.ok(result.kpis.estimatedTotalCost < 100, "foreign high-cost stoppages must not inflate the estimate");
    assert.ok(!JSON.stringify(result).includes(b.marker));
  });

  for (const field of ["plate", "brand", "model"] as const) {
    it(`analytics ${field} filtering cannot replace the parent ownership predicate`, async () => {
      const { a, b } = await downstreamFixture();
      const value = b.vehicle[field];
      const result = await stats.analytics(a.tenant.id, { [field]: value });
      assert.equal(result.kpis.totalStoppages, 0);
      assert.equal(result.kpis.remindersTotal, 0);
      assert.deepEqual(result.tables.longestOpen, []);
      assert.deepEqual(result.tables.reminderFailures, []);
      assert.deepEqual(result.charts.byWorkshop, []);
      // The requested filter may be echoed, but no record or relationship from B may be returned.
      assert.ok(!JSON.stringify({ charts: result.charts, tables: result.tables }).includes(b.marker));
    });
  }

  it("workshop health aggregates exclude corrupt stoppages and foreign reminder failures", async () => {
    const { a, b } = await downstreamFixture();
    const rows = await stats.workshopHealth(a.tenant.id);
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.workshopId, a.workshop.id);
    assert.equal(rows[0]!.totalStoppages, 1);
    assert.equal(rows[0]!.reminderFailureRate, 0);
    assert.ok(!JSON.stringify(rows).includes(b.marker));
  });

  it("team performance excludes corrupt stoppages assigned to an owned operator", async () => {
    const { a, b } = await downstreamFixture();
    const rows = await stats.teamPerformance(a.tenant.id);
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.userId, a.user.id);
    assert.equal(rows[0]!.assignedTotal, 1);
    assert.equal(rows[0]!.openTotal, 1);
    assert.ok(!JSON.stringify(rows).includes(b.marker));
  });

  it("AI suggestions and workshop capacity exclude corrupt parent relationship data", async () => {
    const { a, b } = await downstreamFixture();
    const suggestions = await stats.aiSuggestions(a.tenant.id);
    assert.deepEqual(suggestions.data.map((row) => row.stoppageId), [a.stoppage.id]);
    const capacity = await stats.workshopsCapacity(a.tenant.id);
    assert.equal(capacity.length, 1);
    assert.equal(capacity[0]!.workshopId, a.workshop.id);
    assert.equal(capacity[0]!.active, 1);
    assert.equal(capacity[0]!.critical, 0);
    assert.ok(!JSON.stringify({ suggestions, capacity }).includes(b.marker));
  });

  it("preventiveDue excludes a legacy owned vehicle referencing a foreign site", async () => {
    const { a, b } = await pair();
    await prisma.vehicle.update({ where: { id: a.vehicle.id }, data: { siteId: b.site.id } });
    const req = request(a, a.stoppage.id);
    req.query = { intervalDays: "1" };
    const res = response();
    await controller().preventiveDue(req, res as any);
    assert.deepEqual((res.body as any).data, []);
    assert.equal((res.body as any).kpis.dueNowDays, 0);
    assert.ok(!JSON.stringify(res.body).includes(b.marker));
  });

  it("preventiveDue preserves an owned deleted inactive site and ignores a newer corrupt stoppage reference", async () => {
    const { a, b } = await pair();
    await prisma.site.update({ where: { id: a.site.id }, data: { deletedAt: new Date(), isActive: false } });
    const corrupted = await createLegacy(a, b, "workshopId");
    await prisma.stoppage.update({ where: { id: corrupted.id }, data: { openedAt: new Date(Date.now() - 60_000) } });
    const req = request(a, a.stoppage.id);
    req.query = { intervalDays: "1" };
    const res = response();
    await controller().preventiveDue(req, res as any);
    const rows = (res.body as any).data;
    assert.equal(rows.length, 1);
    assert.equal(rows[0].vehicleId, a.vehicle.id);
    assert.equal(rows[0].site, a.site.name);
    assert.equal(rows[0].referenceDate, a.stoppage.openedAt.toISOString());
    assert.equal(rows[0].dueByDays, true);
    assert.ok(!JSON.stringify(res.body).includes(b.marker));
  });

  it("profitability excludes downtime from a legacy foreign workshop on an owned vehicle and exports only owned data", async () => {
    const { a, b } = await pair();
    await prisma.stoppage.update({ where: { id: a.stoppage.id }, data: { status: "CANCELED" } });
    const legacy = await createLegacy(a, b, "workshopId");
    await prisma.stoppage.update({ where: { id: legacy.id }, data: { openedAt: new Date(Date.now() - 5 * dayMs) } });
    const service = new VehicleProfitabilityReportService();
    const report = await service.build(a.tenant.id, {
      vehicleId: a.vehicle.id, dateFrom: new Date(Date.now() - 7 * dayMs), dateTo: new Date(), includeVat: true, includeCosts: true
    });
    assert.equal(report.vehicles.length, 1);
    assert.equal(report.summary.technicalStopDays, 0);
    assert.equal(report.vehicles[0]!.technicalStopDays, 0);
    assert.ok(!JSON.stringify(report).includes(b.marker));
    const csv = await service.toCsv(report);
    assert.ok(csv.includes(a.vehicle.plate));
    assert.ok(!csv.includes(b.marker));
    await assert4xx(() => service.build(a.tenant.id, {
      vehicleId: b.vehicle.id, dateFrom: new Date(Date.now() - 7 * dayMs), dateTo: new Date(), includeVat: true, includeCosts: true
    }));
  });

  it("scheduled report body and CSV/PDF attachments exclude corrupt ownership and retain valid deleted reminder history", async () => {
    const { a, b } = await downstreamFixture();
    await prisma.tenantSubscription.create({ data: { tenantId: a.tenant.id, provider: "local", plan: "PRO", status: "ACTIVE" } });
    const now = new Date();
    now.setSeconds(0, 0);
    const settings = await prisma.auditLog.create({ data: {
      tenantId: a.tenant.id, resource: "reports", action: "SETTINGS_REPORTS", createdAt: new Date(now.getTime() - dayMs),
      details: { enabled: true, frequency: "daily", hour: now.getHours(), minute: now.getMinutes(), reportStyle: "EXECUTIVE", recipients: ["synthetic-report@example.test"] }
    } });
    await prisma.scheduledReportCursor.create({ data: {
      tenantId: a.tenant.id, settingsAuditLogId: settings.id, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone, nextRunAt: now
    } });
    await runReportsCronCycle(new EmailQueueService(), new LicensePolicyService(new PrismaAuditLogRepository()), now);
    const rows = await prisma.emailQueue.findMany({ where: { tenantId: a.tenant.id, type: "SCHEDULED_REPORT" } });
    assert.equal(rows.length, 1);
    const queued = rows[0]!;
    assert.equal(queued.status, "PENDING", "this test must enqueue, never invoke a real provider");
    assert.ok(queued.body.includes("Totale fermi: 1"));
    assert.ok(queued.body.includes("Critici aperti: 0"));
    assert.ok(queued.body.includes("Reminder inviati: 2"));
    assert.ok(queued.body.includes("Reminder falliti: 1"));
    assert.ok(!queued.body.includes(b.marker));
    assert.ok(!queued.body.includes(b.workshop.id));
    const attachments = (queued.meta as any).attachments as Array<{ filename: string; contentBase64: string }>;
    const csv = Buffer.from(attachments.find((item) => item.filename.endsWith(".csv"))!.contentBase64, "base64").toString("utf8");
    assert.ok(csv.includes("total_stoppages,1\n"));
    assert.ok(csv.includes("reminders,2\n"));
    assert.ok(csv.includes("reminders_failed,1\n"));
    assert.ok(!csv.includes(b.marker));
    const pdf = Buffer.from(attachments.find((item) => item.filename.endsWith(".pdf"))!.contentBase64, "base64").toString("utf8");
    assert.ok(pdf.startsWith("%PDF"));
    assert.ok(pdf.includes("Totale fermi: 1"));
    assert.ok(!pdf.includes(b.marker));
    assert.ok(!pdf.includes(b.workshop.id));
  });

  for (const target of ["foreign", "corrupt"] as const) {
    it(`markReminderSent rejects a ${target} stoppage without mutations`, async () => {
      const { a, b } = await pair();
      const id = target === "foreign" ? b.stoppage.id : (await createLegacy(a, b)).id;
      await assertNoMutation(() => repository.markReminderSent(a.tenant.id, id, new Date()));
    });
  }

  for (const status of ["CLOSED", "CANCELED"] as const) {
    it(`markReminderSent does not reopen an owned ${status} stoppage`, async () => {
      const a = await fixture(`terminal-reminder-${status}`);
      const closedAt = status === "CLOSED" ? new Date() : null;
      await prisma.stoppage.update({ where: { id: a.stoppage.id }, data: { status, closedAt } });
      await repository.markReminderSent(a.tenant.id, a.stoppage.id, new Date());
      const row = await prisma.stoppage.findUniqueOrThrow({ where: { id: a.stoppage.id } });
      assert.equal(row.status, status);
      assert.equal(row.closedAt?.getTime() ?? null, closedAt?.getTime() ?? null);
    });
  }

  it("markReminderSent records the counter and timestamp on its owned OPEN stoppage", async () => {
    const a = await fixture("own-reminder-marker");
    const sentAt = new Date();
    await repository.markReminderSent(a.tenant.id, a.stoppage.id, sentAt);
    const row = await prisma.stoppage.findUniqueOrThrow({ where: { id: a.stoppage.id } });
    assert.equal(row.totalRemindersSent, 1);
    assert.equal(row.lastReminderSentAt?.getTime(), sentAt.getTime());
    assert.equal(row.status, "SOLICITED");
  });

  for (const relation of ["site", "vehicle", "workshop"] as const) {
    for (const operation of ["create", "update"] as const) {
      it(`${operation} rechecks ${relation} after a concurrent soft deletion commits`, async () => {
        const a = await fixture(`race-${operation}-${relation}`);
        // The next candidate belongs to A; use a separate row to avoid treating an unchanged historical ID as reassignment.
        const candidate = await (prisma[relation] as any).create({ data: {
          ...(relation === "site" ? { name: "Synthetic next site", address: "Synthetic", city: "Synthetic" }
            : relation === "vehicle" ? { siteId: a.site.id, plate: `RACE-${sequence++}`, brand: "Synthetic", model: "Synthetic" }
              : { name: "Synthetic next workshop", email: "race-workshop@example.test" }), tenantId: a.tenant.id
        } });
        let unlock!: () => void;
        let locked!: () => void;
        const hold = new Promise<void>((resolve) => { unlock = resolve; });
        const ready = new Promise<void>((resolve) => { locked = resolve; });
        const table = relation === "site" ? "Site" : relation === "vehicle" ? "Vehicle" : "Workshop";
        const deletion = prisma.$transaction(async (tx) => {
          await tx.$queryRawUnsafe(`SELECT "id" FROM "${table}" WHERE "id" = $1 FOR UPDATE`, candidate.id);
          await (tx[relation] as any).update({ where: { id: candidate.id }, data: { deletedAt: new Date() } });
          locked();
          await hold;
        }, { maxWait: 3000, timeout: 5000 });
        let outcome: Promise<{ value?: unknown; error?: unknown }> | undefined;
        try {
          await Promise.race([ready, deletion.then(() => { throw new Error("Lock holder finished before mutation started"); })]);
          const input = operation === "create" ? { ...createInput(a), [`${relation}Id`]: candidate.id } : { [`${relation}Id`]: candidate.id };
          outcome = (operation === "create" ? repository.create(a.tenant.id, input) : repository.update(a.tenant.id, a.stoppage.id, input))
            .then((value) => ({ value }), (error: unknown) => ({ error }));
          await new Promise((resolve) => { setTimeout(resolve, 50); });
          unlock();
          await deletion;
          const result = await outcome;
          assert.ok(result.error, "relation validation must observe the deletion after waiting for its row lock");
          const status = (result.error as any).statusCode;
          assert.ok(Number.isInteger(status) && status >= 400 && status < 500);
          const persisted = await prisma.stoppage.findUniqueOrThrow({ where: { id: a.stoppage.id } });
          assert.equal(persisted[`${relation}Id`], a[relation].id);
          assert.equal(await prisma.stoppage.count({ where: { tenantId: a.tenant.id } }), 1);
        } finally {
          unlock();
          await deletion;
          if (outcome) await outcome;
        }
      });
    }
  }
});
