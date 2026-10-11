import assert from "node:assert/strict";
import { after, afterEach, before, describe, it } from "node:test";
import { AuthSessionService } from "../../src/application/services/auth-session-service.js";
import { SendReminderUseCase } from "../../src/application/usecases/reminders/send-reminder-usecase.js";
import { prisma } from "../../src/infrastructure/database/prisma/client.js";
import { EmailQueueService } from "../../src/infrastructure/email/email-queue-service.js";
import { emailSender } from "../../src/infrastructure/email/email-sender.js";
import { PrismaPlatformAdminRepository } from "../../src/infrastructure/repositories/prisma-platform-admin-repository.js";
import { PrismaReminderRepository } from "../../src/infrastructure/repositories/prisma-reminder-repository.js";
import { PrismaStoppageRepository } from "../../src/infrastructure/repositories/prisma-stoppage-repository.js";
import { PrismaUserRepository } from "../../src/infrastructure/repositories/prisma-user-repository.js";

const runId = `reminder-eligibility-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const tenantIds: string[] = [];
const directQueueIds: string[] = [];
const originalSend = emailSender.send;
const queue = new EmailQueueService();
const useCase = () => new SendReminderUseCase(new PrismaStoppageRepository(), new PrismaReminderRepository(), queue);
const dayMs = 24 * 60 * 60_000;
let sequence = 0;

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
};

const waitFor = async <T>(promise: Promise<T>, label: string): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`Timed out waiting for ${label}`)), 3000); })
    ]);
  } finally { if (timer) clearTimeout(timer); }
};

const fixture = async (suffix: string, options: {
  active?: boolean;
  deleted?: boolean;
  plan?: string;
  licenseStatus?: string;
  expiresAt?: Date;
  noSubscription?: boolean;
  due?: boolean;
} = {}) => {
  const tenant = await prisma.tenant.create({ data: {
    id: `${runId}-${suffix}-${sequence++}`, name: `Synthetic reminder ${suffix}`,
    isActive: options.active ?? true, deletedAt: options.deleted ? new Date() : null
  } });
  tenantIds.push(tenant.id);
  if (!options.noSubscription) {
    await prisma.tenantSubscription.create({ data: {
      tenantId: tenant.id, provider: "local", plan: options.plan ?? "STARTER", status: options.licenseStatus ?? "ACTIVE",
      currentPeriodEnd: options.expiresAt, trialEndsAt: options.licenseStatus === "TRIAL" ? options.expiresAt : null
    } });
  }
  const user = await prisma.user.create({ data: {
    tenantId: tenant.id, email: `${suffix}-${sequence}@example.test`, passwordHash: "synthetic-unused-password-hash",
    firstName: "Synthetic", lastName: "Reminder"
  } });
  const site = await prisma.site.create({ data: { tenantId: tenant.id, name: "Synthetic Site", address: "Synthetic Address", city: "TestCity" } });
  const workshop = await prisma.workshop.create({ data: { tenantId: tenant.id, name: "Synthetic Workshop", email: `${suffix}-workshop@example.test` } });
  const vehicle = await prisma.vehicle.create({ data: { tenantId: tenant.id, siteId: site.id, plate: `SYN-${sequence}`, brand: "Synthetic", model: "Vehicle" } });
  const now = new Date();
  const stoppage = await prisma.stoppage.create({ data: {
    tenantId: tenant.id, siteId: site.id, vehicleId: vehicle.id, workshopId: workshop.id,
    createdByUserId: user.id, reason: "Synthetic reminder security case", priority: "LOW",
    openedAt: new Date(now.getTime() - 3 * dayMs), reminderAfterDays: options.due === false ? null : 1,
    workshopEmailSnapshot: workshop.email
  } });
  return { tenant, user, site, workshop, vehicle, stoppage, now };
};
type Fixture = Awaited<ReturnType<typeof fixture>>;

const enqueueRetry = async (data: Fixture, reminderType = "AUTOMATIC_RETRY", meta: Record<string, unknown> = {}) => {
  const row = await queue.enqueue({
    tenantId: data.tenant.id, type: "REMINDER_EMAIL", recipient: data.workshop.email!,
    subject: "Synthetic queued reminder", body: "Synthetic reminder body",
    meta: { tenantId: data.tenant.id, stoppageId: data.stoppage.id, reminderType, ...meta }
  });
  directQueueIds.push(row.id);
  return row;
};

const assertNoSuccess = async (data: Fixture, options: { allowFailureHistory?: boolean } = {}) => {
  assert.equal(await prisma.reminder.count({ where: { stoppageId: data.stoppage.id, success: true } }), 0);
  if (!options.allowFailureHistory) {
    assert.equal(await prisma.reminder.count({ where: { stoppageId: data.stoppage.id } }), 0, "policy denial must not create provider-failure history");
  }
  const stoppage = await prisma.stoppage.findUniqueOrThrow({ where: { id: data.stoppage.id } });
  assert.equal(stoppage.totalRemindersSent, 0);
  assert.equal(stoppage.lastReminderSentAt, null);
};

const assertTerminalBlocked = async (id: string, attempts = 0) => {
  const row = await prisma.emailQueue.findUniqueOrThrow({ where: { id } });
  assert.equal(row.status, "FAILED", "ineligible reminder must not remain retryable");
  assert.equal(row.attempts, attempts, "policy denial is not a provider attempt");
  assert.equal(row.processingToken, null);
  assert.equal(row.processingStartedAt, null);
  assert.equal(row.leaseExpiresAt, null);
  const meta = (row.meta ?? {}) as Record<string, unknown>;
  assert.equal(typeof meta.dispatchBlockedReason, "string");
  assert.equal(typeof meta.dispatchBlockedAt, "string");
  assert.equal(new Date(String(meta.dispatchBlockedAt)).toISOString(), meta.dispatchBlockedAt);
  assert.ok(row.lastError && !row.lastError.includes(row.recipient), "policy errors must omit recipients");
  return row;
};

const afterClaim = async (id: string, hook: () => Promise<void>, work: () => Promise<unknown>) => {
  const delegate = prisma.emailQueue;
  const originalFind = delegate.findFirstOrThrow.bind(delegate);
  let invoked = false;
  (delegate as any).findFirstOrThrow = async (args: Parameters<typeof originalFind>[0]) => {
    const row = await originalFind(args);
    if (!invoked && row.id === id && row.processingToken) { invoked = true; await hook(); }
    return row;
  };
  try { await work(); assert.equal(invoked, true, "transition must occur after queue claim"); }
  finally { (delegate as any).findFirstOrThrow = originalFind; }
};

describe("reminder email tenant, license and lifecycle eligibility", () => {
  before(async () => { await prisma.$connect(); });
  afterEach(async () => {
    emailSender.send = originalSend;
    const owned = { in: tenantIds };
    await prisma.emailQueue.deleteMany({ where: { OR: [{ tenantId: owned }, { id: { in: directQueueIds.splice(0) } }] } });
    await prisma.reminder.deleteMany({ where: { tenantId: owned } });
    await prisma.stoppageEvent.deleteMany({ where: { tenantId: owned } });
    await prisma.stoppagePhoto.deleteMany({ where: { stoppage: { tenantId: owned } } });
    await prisma.stoppage.deleteMany({ where: { tenantId: owned } });
    await prisma.vehicle.deleteMany({ where: { tenantId: owned } });
    await prisma.workshop.deleteMany({ where: { tenantId: owned } });
    await prisma.site.deleteMany({ where: { tenantId: owned } });
    await prisma.refreshSession.deleteMany({ where: { tenantId: owned } });
    await prisma.user.deleteMany({ where: { tenantId: owned } });
    await prisma.auditLog.deleteMany({ where: { tenantId: owned } });
    await prisma.tenantSubscription.deleteMany({ where: { tenantId: owned } });
    await prisma.tenant.deleteMany({ where: { id: { in: tenantIds.splice(0) } } });
  });
  after(async () => { await prisma.$disconnect(); });

  const deniedCases = [
    { suffix: "tenant-inactive", options: { active: false } },
    { suffix: "tenant-deleted", options: { deleted: true } },
    { suffix: "license-expired", options: { licenseStatus: "EXPIRED" } },
    { suffix: "license-pending", options: { licenseStatus: "PENDING" } },
    { suffix: "license-suspended", options: { licenseStatus: "SUSPENDED" } },
    { suffix: "license-past-due", options: { licenseStatus: "PAST_DUE" } },
    { suffix: "license-canceled", options: { licenseStatus: "CANCELED" } },
    { suffix: "expired-epoch", options: { expiresAt: new Date(0) } },
    { suffix: "expired-trial", options: { licenseStatus: "TRIAL", expiresAt: new Date(0) } },
    { suffix: "missing-license", options: { noSubscription: true } }
  ];
  for (const testCase of deniedCases) {
    it(`does not send automatic reminders for ${testCase.suffix}`, async () => {
      const data = await fixture(testCase.suffix, testCase.options);
      let sends = 0;
      emailSender.send = async () => { sends += 1; return { provider: "resend", id: "unexpected-reminder" }; };
      await useCase().automaticRun(data.now);
      assert.equal(sends, 0);
      await assertNoSuccess(data);
      assert.equal(await prisma.emailQueue.count({ where: { tenantId: data.tenant.id, type: "REMINDER_EMAIL", status: "PENDING" } }), 0);
    });
  }

  for (const licenseStatus of ["ACTIVE", "TRIAL"]) {
    it(`allows STARTER ${licenseStatus} automatic reminders through a stable queue idempotency key`, async () => {
      const data = await fixture(`starter-${licenseStatus}`, { licenseStatus, expiresAt: new Date(Date.now() + dayMs) });
      const keys: string[] = [];
      emailSender.send = async (input) => { keys.push(String(input.idempotencyKey)); return { provider: "resend", id: "eligible-reminder" }; };
      await useCase().automaticRun(data.now);
      assert.equal(keys.length, 1);
      assert.match(keys[0]!, /^fleetum-email-queue:/);
      const rows = await prisma.emailQueue.findMany({ where: { tenantId: data.tenant.id, type: "REMINDER_EMAIL" } });
      assert.equal(rows.length, 1);
      assert.equal(rows[0]!.status, "SENT");
      assert.equal(keys[0], `fleetum-email-queue:${rows[0]!.id}`);
      assert.equal(await prisma.reminder.count({ where: { stoppageId: data.stoppage.id, success: true } }), 1);
      assert.equal((await prisma.stoppage.findUniqueOrThrow({ where: { id: data.stoppage.id } })).totalRemindersSent, 1);
    });
  }

  it("allows an ACTIVE legacy audit license without imposing a premium plan requirement", async () => {
    const data = await fixture("legacy-license", { noSubscription: true });
    await prisma.auditLog.create({ data: { tenantId: data.tenant.id, action: "PLATFORM_LICENSE_UPDATED", resource: "tenant", details: { after: { plan: "STARTER", status: "ACTIVE", seats: 3, expiresAt: null } } } });
    let sends = 0;
    emailSender.send = async () => { sends += 1; return { provider: "resend", id: "legacy-reminder" }; };
    await useCase().automaticRun(data.now);
    assert.equal(sends, 1);
    assert.equal(await prisma.reminder.count({ where: { stoppageId: data.stoppage.id, success: true } }), 1);
  });

  it("an eligible legacy reminder and a concurrent real auth session finish without a Tenant/User lock cycle", async () => {
    const data = await fixture("legacy-auth-lock-cycle", { noSubscription: true });
    await prisma.auditLog.create({ data: {
      tenantId: data.tenant.id, action: "PLATFORM_LICENSE_UPDATED", resource: "tenant",
      details: { after: { plan: "STARTER", status: "ACTIVE", seats: 3, expiresAt: null } }
    } });
    const row = await enqueueRetry(data, "MANUAL_RETRY");
    const authUserLocked = deferred();
    const guardUserReached = deferred();
    const originalTransaction = prisma.$transaction.bind(prisma);
    let authLockObserved = false;
    let guardUserObserved = false;
    let sends = 0;
    emailSender.send = async () => { sends += 1; return { provider: "resend", id: "legacy-auth-concurrent-reminder" }; };

    // The hooks only coordinate actual database operations. AuthSessionService
    // takes its real User UPDATE lock, creates a real RefreshSession and writes
    // its real AuditLog (including Tenant FK checks). The reminder keeps its
    // real legacy Tenant UPDATE lock. No lock or database response is mocked.
    (prisma as any).$transaction = async (callback: unknown, ...args: unknown[]) => {
      if (typeof callback !== "function") return (originalTransaction as any)(callback, ...args);
      return (originalTransaction as any)(async (tx: any) => {
        let reminderTenantLocked = false;
        const queryRaw = tx.$queryRaw.bind(tx);
        const userFindMany = tx.user.findMany.bind(tx.user);
        const instrumentedUser = new Proxy(tx.user, {
          get(target, property, receiver) {
            if (property !== "findMany") return Reflect.get(target, property, receiver);
            return async (...queryArgs: unknown[]) => {
              if (reminderTenantLocked && !guardUserObserved) {
                guardUserObserved = true;
                guardUserReached.resolve();
              }
              return userFindMany(...queryArgs);
            };
          }
        });
        const instrumented = new Proxy(tx, {
          get(target, property, receiver) {
            if (property === "user") return instrumentedUser;
            if (property !== "$queryRaw") return Reflect.get(target, property, receiver);
            return async (...queryArgs: unknown[]) => {
              const sql = Array.isArray(queryArgs[0]) ? queryArgs[0].join(" ") : String((queryArgs[0] as any)?.sql ?? "");
              const isAuthLock = /FROM\s+"User"/.test(sql) && /FOR\s+UPDATE/.test(sql) && queryArgs.includes(data.user.id);
              const isReminderTenantLock = /FROM\s+"Tenant"/.test(sql) && /FOR\s+UPDATE/.test(sql) && queryArgs.includes(data.tenant.id);
              const isReminderUserLock = reminderTenantLocked && /FROM\s+"User"/.test(sql) && /FOR\s+SHARE/.test(sql);
              if (isReminderUserLock && !guardUserObserved) {
                guardUserObserved = true;
                guardUserReached.resolve();
              }
              const result = await queryRaw(...queryArgs);
              if (isReminderTenantLock) reminderTenantLocked = true;
              if (isAuthLock && !authLockObserved) {
                authLockObserved = true;
                authUserLocked.resolve();
                await waitFor(guardUserReached.promise, "reminder reaching user ownership while its Tenant lock is held");
              }
              return result;
            };
          }
        });
        return callback(instrumented);
      }, ...args);
    };

    const sessions = new AuthSessionService({ signAccess: () => "synthetic-access-token" } as any, new PrismaUserRepository());
    let auth: Promise<unknown> | undefined;
    let worker: Promise<unknown> | undefined;
    try {
      auth = sessions.createSession({ userId: data.user.id, tenantId: data.tenant.id, roles: [], permissions: [], userAgent: "synthetic-reminder-auth-race" });
      // Observe rejection immediately so a real deadlock cannot become an
      // unhandled rejection while the test waits for the worker transaction.
      const authOutcome = auth.then((value) => ({ value }), (error: unknown) => ({ error }));
      await waitFor(authUserLocked.promise, "auth acquiring its User UPDATE lock");
      worker = queue.processPending(new Date(), { ids: [row.id] });
      const results = await waitFor(Promise.all([authOutcome, worker]), "auth and reminder transactions completing");
      assert.equal(authLockObserved, true);
      assert.equal(guardUserObserved, true);
      assert.ok(!("error" in results[0]), "real session creation must finish without a PostgreSQL deadlock or timeout");
      assert.equal(sends, 1);
      assert.equal((await prisma.emailQueue.findUniqueOrThrow({ where: { id: row.id } })).status, "SENT");
      assert.equal(await prisma.refreshSession.count({ where: { tenantId: data.tenant.id, userId: data.user.id, revokedAt: null } }), 1);
      assert.equal(await prisma.auditLog.count({ where: { tenantId: data.tenant.id, action: "AUTH_SESSION_CREATED" } }), 1);
      assert.equal(await prisma.reminder.count({ where: { stoppageId: data.stoppage.id, success: true } }), 1);
      assert.equal((await prisma.stoppage.findUniqueOrThrow({ where: { id: data.stoppage.id } })).totalRemindersSent, 1);
    } finally {
      guardUserReached.resolve();
      await Promise.allSettled([...(auth ? [auth] : []), ...(worker ? [worker] : [])]);
      (prisma as any).$transaction = originalTransaction;
    }
  });

  for (const relation of ["site", "vehicle", "workshop"] as const) {
    it(`does not leak or send an automatic reminder using a foreign tenant ${relation}`, async () => {
      const data = await fixture(`foreign-${relation}`);
      const foreign = await fixture(`foreign-${relation}-owner`, { due: false });
      const relationKey = `${relation}Id`;
      await prisma.stoppage.update({ where: { id: data.stoppage.id }, data: { [relationKey]: foreign[relation].id } });
      let sends = 0;
      emailSender.send = async () => { sends += 1; return { provider: "resend", id: "unexpected-foreign-reminder" }; };
      await useCase().automaticRun(data.now);
      assert.equal(sends, 0);
      await assertNoSuccess(data);
      await assertNoSuccess(foreign);
    });

    it(`does not send automatic reminders after the related ${relation} is soft-deleted`, async () => {
      const data = await fixture(`deleted-${relation}`);
      await (prisma[relation] as any).update({ where: { id: data[relation].id }, data: { deletedAt: new Date() } });
      let sends = 0;
      emailSender.send = async () => { sends += 1; return { provider: "resend", id: "unexpected-deleted-relation-reminder" }; };
      await useCase().automaticRun(data.now);
      assert.equal(sends, 0);
      await assertNoSuccess(data);
    });
  }

  it("does not send an automatic reminder to an inactive workshop", async () => {
    const data = await fixture("inactive-workshop");
    await prisma.workshop.update({ where: { id: data.workshop.id }, data: { isActive: false } });
    let sends = 0;
    emailSender.send = async () => { sends += 1; return { provider: "resend", id: "unexpected-inactive-workshop-reminder" }; };
    await useCase().automaticRun(data.now);
    assert.equal(sends, 0);
    await assertNoSuccess(data);
  });

  const invalidUserLinks = [
    { field: "createdByUserId", condition: "foreign" },
    { field: "assignedToUserId", condition: "foreign" },
    { field: "assignedToUserId", condition: "missing" }
  ] as const;
  // PostgreSQL's creator FK already prevents a missing creator fixture. The
  // scalar assignee has no FK and can contain a missing legacy user ID.
  for (const { field, condition } of invalidUserLinks) {
    for (const path of ["manual", "automatic", "queued-automatic", "queued-manual"] as const) {
      it(`${path} rejects a legacy ${condition} ${field} before provider initiation`, async () => {
        const data = await fixture(`user-link-${field}-${condition}-${path}`);
        const foreign = condition === "foreign" ? await fixture(`user-link-foreign-${field}-${path}`, { due: false }) : null;
        const queued = path.startsWith("queued-")
          ? await enqueueRetry(data, path === "queued-manual" ? "MANUAL_RETRY" : "AUTOMATIC_RETRY")
          : null;
        await prisma.stoppage.update({ where: { id: data.stoppage.id }, data: {
          [field]: foreign?.user.id ?? `${runId}-missing-assignee-${sequence++}`
        } });
        const before = await prisma.stoppage.findUniqueOrThrow({ where: { id: data.stoppage.id } });
        let sends = 0;
        emailSender.send = async () => { sends += 1; return { provider: "resend", id: "unexpected-invalid-user-link" }; };
        if (path === "manual") {
          await assert.rejects(() => useCase().manualEmail(data.tenant.id, data.stoppage.id), (error: unknown) => {
            const statusCode = (error as any)?.statusCode;
            assert.ok(Number.isInteger(statusCode) && statusCode >= 400 && statusCode < 500);
            return true;
          });
        } else if (path === "automatic") {
          await useCase().automaticRun(data.now);
        } else {
          await queue.processPending(new Date(), { ids: [queued!.id] });
          await assertTerminalBlocked(queued!.id);
        }
        assert.equal(sends, 0, "neither the producer nor the worker may initiate a provider request");
        assert.equal(await prisma.emailQueue.count({ where: { tenantId: data.tenant.id } }), queued ? 1 : 0);
        await assertNoSuccess(data);
        assert.deepEqual(await prisma.stoppage.findUniqueOrThrow({ where: { id: data.stoppage.id } }), before,
          "denying an invalid user link must preserve stoppage status, counters and all historical fields");
        if (foreign) {
          await assertNoSuccess(foreign);
          assert.equal(await prisma.emailQueue.count({ where: { tenantId: foreign.tenant.id } }), 0);
        }
      });
    }
  }

  for (const userState of ["suspended", "deleted"] as const) {
    for (const path of ["manual", "automatic", "queued"] as const) {
      it(`${path} keeps owned historical ${userState} creator and assignee eligible`, async () => {
        const data = await fixture(`historical-user-${userState}-${path}`);
        await prisma.stoppage.update({ where: { id: data.stoppage.id }, data: { assignedToUserId: data.user.id } });
        const queued = path === "queued" ? await enqueueRetry(data, "MANUAL_RETRY") : null;
        await prisma.user.update({ where: { id: data.user.id }, data: {
          status: "SUSPENDED", ...(userState === "deleted" ? { deletedAt: new Date() } : {})
        } });
        let sends = 0;
        emailSender.send = async () => { sends += 1; return { provider: "resend", id: "eligible-historical-owned-user" }; };
        if (path === "manual") {
          assert.deepEqual(await useCase().manualEmail(data.tenant.id, data.stoppage.id), { success: true, queued: false });
        } else if (path === "automatic") {
          await useCase().automaticRun(data.now);
        } else {
          await queue.processPending(new Date(), { ids: [queued!.id] });
        }
        assert.equal(sends, 1);
        const rows = await prisma.emailQueue.findMany({ where: { tenantId: data.tenant.id, type: "REMINDER_EMAIL" } });
        assert.equal(rows.length, 1);
        assert.equal(rows[0]!.status, "SENT");
        const stoppage = await prisma.stoppage.findUniqueOrThrow({ where: { id: data.stoppage.id } });
        assert.equal(stoppage.status, "SOLICITED");
        assert.equal(stoppage.totalRemindersSent, 1);
        assert.ok(stoppage.lastReminderSentAt);
        assert.equal(stoppage.createdByUserId, data.user.id);
        assert.equal(stoppage.assignedToUserId, data.user.id);
        assert.equal(await prisma.reminder.count({ where: { stoppageId: data.stoppage.id, success: true } }), 1);
        assert.equal(await prisma.reminder.count({ where: { stoppageId: data.stoppage.id, success: false } }), 0);
      });
    }
  }

  for (const relation of ["site", "vehicle"] as const) {
    it(`keeps an inactive but not deleted ${relation} eligible for an open stoppage reminder`, async () => {
      const data = await fixture(`inactive-valid-${relation}`);
      await (prisma[relation] as any).update({ where: { id: data[relation].id }, data: { isActive: false } });
      let sends = 0;
      emailSender.send = async () => { sends += 1; return { provider: "resend", id: "eligible-inactive-relation" }; };
      await useCase().automaticRun(data.now);
      assert.equal(sends, 1);
      assert.equal(await prisma.reminder.count({ where: { stoppageId: data.stoppage.id, success: true } }), 1);
      assert.equal((await prisma.stoppage.findUniqueOrThrow({ where: { id: data.stoppage.id } })).totalRemindersSent, 1);
    });
  }

  it("protects manual reminders with the same tenant and license checks", async () => {
    const data = await fixture("manual-suspended", { licenseStatus: "SUSPENDED" });
    let sends = 0;
    emailSender.send = async () => { sends += 1; return { provider: "resend", id: "unexpected-manual-reminder" }; };
    let result: any;
    try { result = await useCase().manualEmail(data.tenant.id, data.stoppage.id); } catch { result = { rejected: true }; }
    assert.equal(sends, 0);
    assert.notEqual(result?.success, true);
    await assertNoSuccess(data);
  });

  it("does not let a manual request for tenant A access tenant B's stoppage", async () => {
    const data = await fixture("manual-owner-a");
    const foreign = await fixture("manual-owner-b", { due: false });
    let sends = 0;
    emailSender.send = async () => { sends += 1; return { provider: "resend", id: "unexpected-foreign-manual" }; };
    await assert.rejects(() => useCase().manualEmail(data.tenant.id, foreign.stoppage.id));
    assert.equal(sends, 0);
    await assertNoSuccess(foreign);
  });

  it("keeps legitimate manual success and preserves CLOSED for a manual reminder", async () => {
    const data = await fixture("manual-closed");
    await prisma.stoppage.update({ where: { id: data.stoppage.id }, data: { status: "CLOSED", closedAt: data.now } });
    const keys: string[] = [];
    emailSender.send = async (input) => { keys.push(String(input.idempotencyKey)); return { provider: "resend", id: "manual-closed-reminder" }; };
    const result = await useCase().manualEmail(data.tenant.id, data.stoppage.id);
    assert.equal(result.success, true);
    assert.equal(result.queued, false);
    assert.equal(keys.length, 1);
    assert.match(keys[0]!, /^fleetum-email-queue:/);
    const persisted = await prisma.stoppage.findUniqueOrThrow({ where: { id: data.stoppage.id } });
    assert.equal(persisted.status, "CLOSED");
    assert.equal(persisted.closedAt?.getTime(), data.now.getTime());
    assert.equal(persisted.totalRemindersSent, 1);
    assert.equal(await prisma.reminder.count({ where: { stoppageId: data.stoppage.id, success: true } }), 1);
  });

  for (const reminderType of ["AUTOMATIC_RETRY", "MANUAL_RETRY"]) {
    it(`blocks a legacy ${reminderType} after tenant suspension and never replays it after reactivation`, async () => {
      const data = await fixture(`legacy-${reminderType}`);
      const row = await enqueueRetry(data, reminderType);
      await prisma.tenant.update({ where: { id: data.tenant.id }, data: { isActive: false } });
      let sends = 0;
      emailSender.send = async () => { sends += 1; return { provider: "resend", id: "unexpected-suspended-retry" }; };
      await queue.processPending(new Date(), { ids: [row.id] });
      assert.equal(sends, 0);
      await assertTerminalBlocked(row.id);
      await assertNoSuccess(data);
      await prisma.tenant.update({ where: { id: data.tenant.id }, data: { isActive: true } });
      assert.equal((await queue.processPending(new Date(), { ids: [row.id] })).processed, 0);
      assert.equal(sends, 0);
      await assertNoSuccess(data);
    });
  }

  it("blocks an already queued reminder after the license becomes ineligible", async () => {
    const data = await fixture("queued-license-suspended");
    const row = await enqueueRetry(data, "MANUAL_RETRY");
    await prisma.tenantSubscription.update({ where: { tenantId: data.tenant.id }, data: { status: "PAST_DUE" } });
    let sends = 0;
    emailSender.send = async () => { sends += 1; return { provider: "resend", id: "unexpected-license-retry" }; };
    await queue.processPending(new Date(), { ids: [row.id] });
    assert.equal(sends, 0);
    await assertTerminalBlocked(row.id);
    await assertNoSuccess(data);
  });

  it("allows an old reminder after a PRO to STARTER downgrade that retains ACTIVE entitlement", async () => {
    const data = await fixture("queued-valid-downgrade", { plan: "PRO" });
    const row = await enqueueRetry(data, "AUTOMATIC_RETRY");
    await prisma.tenantSubscription.update({ where: { tenantId: data.tenant.id }, data: { plan: "STARTER" } });
    let sends = 0;
    emailSender.send = async () => { sends += 1; return { provider: "resend", id: "valid-downgrade-reminder" }; };
    await queue.processPending(new Date(), { ids: [row.id] });
    assert.equal(sends, 1);
    assert.equal((await prisma.emailQueue.findUniqueOrThrow({ where: { id: row.id } })).status, "SENT");
    assert.equal((await prisma.stoppage.findUniqueOrThrow({ where: { id: data.stoppage.id } })).totalRemindersSent, 1);
  });

  it("does not release a stale reminder after Platform suspension and reactivation before its first retry", async () => {
    const data = await fixture("queued-reactivated");
    const row = await enqueueRetry(data);
    await prisma.emailQueue.update({ where: { id: row.id }, data: { createdAt: new Date(Date.now() - 60_000) } });
    const platform = new PrismaPlatformAdminRepository();
    const audit = { actorUserId: `${runId}-platform`, sourceIp: "192.0.2.10" };
    await platform.setTenantActive(data.tenant.id, false, audit);
    await platform.setTenantActive(data.tenant.id, true, audit);
    let sends = 0;
    emailSender.send = async () => { sends += 1; return { provider: "resend", id: "unexpected-reactivated-retry" }; };
    await queue.processPending(new Date(), { ids: [row.id] });
    assert.equal(sends, 0);
    await assertTerminalBlocked(row.id);
    await assertNoSuccess(data);
  });

  for (const lifecycle of ["closed", "deleted"] as const) {
    it(`rechecks an automatic retry when the stoppage is ${lifecycle} after queue claim`, async () => {
      const data = await fixture(`after-claim-${lifecycle}`);
      const row = await enqueueRetry(data);
      let sends = 0;
      emailSender.send = async () => { sends += 1; return { provider: "resend", id: "unexpected-stale-lifecycle" }; };
      await afterClaim(row.id, async () => {
        await prisma.stoppage.update({ where: { id: data.stoppage.id }, data: lifecycle === "closed" ? { status: "CLOSED", closedAt: new Date() } : { deletedAt: new Date() } });
      }, () => queue.processPending(new Date(), { ids: [row.id] }));
      assert.equal(sends, 0);
      await assertTerminalBlocked(row.id);
      await assertNoSuccess(data);
      if (lifecycle === "closed") assert.equal((await prisma.stoppage.findUniqueOrThrow({ where: { id: data.stoppage.id } })).status, "CLOSED");
    });
  }

  it("lets two concurrent automatic cycles send one reminder and persist its effects once", async () => {
    const data = await fixture("concurrent-automatic");
    const entered = deferred();
    const release = deferred();
    let sends = 0;
    emailSender.send = async () => {
      sends += 1;
      if (sends === 1) { entered.resolve(); await release.promise; }
      return { provider: "resend", id: "concurrent-logical-reminder" };
    };
    const first = useCase().automaticRun(data.now);
    try {
      await waitFor(entered.promise, "first automatic provider invocation");
      await waitFor(useCase().automaticRun(data.now), "competing automatic cycle");
    } finally { release.resolve(); await first; }
    assert.equal(sends, 1);
    assert.equal(await prisma.reminder.count({ where: { stoppageId: data.stoppage.id, success: true } }), 1);
    assert.equal((await prisma.stoppage.findUniqueOrThrow({ where: { id: data.stoppage.id } })).totalRemindersSent, 1);
  });

  it("does not duplicate or bring forward a legacy pending automatic reminder's backoff", async () => {
    const data = await fixture("legacy-pending-backoff");
    const row = await enqueueRetry(data, "AUTOMATIC_RETRY");
    const now = new Date();
    const nextAttemptAt = new Date(now.getTime() + 20 * 60_000);
    await prisma.emailQueue.update({ where: { id: row.id }, data: { attempts: 1, nextAttemptAt } });
    let sends = 0;
    emailSender.send = async () => { sends += 1; return { provider: "resend", id: "unexpected-early-backoff" }; };
    await useCase().automaticRun(now);
    assert.equal(sends, 0);
    assert.equal(await prisma.emailQueue.count({ where: { tenantId: data.tenant.id, type: "REMINDER_EMAIL" } }), 1);
    const pending = await prisma.emailQueue.findUniqueOrThrow({ where: { id: row.id } });
    assert.equal(pending.status, "PENDING");
    assert.equal(pending.attempts, 1);
    assert.equal(pending.nextAttemptAt.getTime(), nextAttemptAt.getTime());
    assert.equal(pending.processingToken, null);
    await assertNoSuccess(data);
  });

  it("does not bypass a legacy automatic reminder's active lease and recovers that same row when the lease expires", async () => {
    const data = await fixture("legacy-pending-leased");
    const row = await enqueueRetry(data, "AUTOMATIC_RETRY");
    const now = new Date();
    const leaseExpiresAt = new Date(now.getTime() + 20 * 60_000);
    await prisma.emailQueue.update({ where: { id: row.id }, data: {
      attempts: 1, nextAttemptAt: new Date(0), processingToken: "synthetic-legacy-owner",
      processingStartedAt: now, leaseExpiresAt
    } });
    const keys: string[] = [];
    emailSender.send = async (input) => { keys.push(String(input.idempotencyKey)); return { provider: "resend", id: "recovered-legacy-reminder" }; };
    await useCase().automaticRun(now);
    assert.equal(keys.length, 0);
    assert.equal(await prisma.emailQueue.count({ where: { tenantId: data.tenant.id, type: "REMINDER_EMAIL" } }), 1);
    const leased = await prisma.emailQueue.findUniqueOrThrow({ where: { id: row.id } });
    assert.equal(leased.status, "PENDING");
    assert.equal(leased.attempts, 1);
    assert.equal(leased.processingToken, "synthetic-legacy-owner");
    assert.equal(leased.leaseExpiresAt?.getTime(), leaseExpiresAt.getTime());
    await assertNoSuccess(data);
    await prisma.emailQueue.update({ where: { id: row.id }, data: { leaseExpiresAt: new Date(0) } });
    await useCase().automaticRun(new Date());
    assert.equal(keys.length, 0, "the automatic producer must leave recovery of a pending row to the queue worker");
    await queue.processPending(new Date(), { ids: [row.id] });
    assert.deepEqual(keys, [`fleetum-email-queue:${row.id}`]);
    assert.equal(await prisma.emailQueue.count({ where: { tenantId: data.tenant.id, type: "REMINDER_EMAIL" } }), 1);
    assert.equal((await prisma.emailQueue.findUniqueOrThrow({ where: { id: row.id } })).status, "SENT");
    assert.equal(await prisma.reminder.count({ where: { stoppageId: data.stoppage.id, success: true } }), 1);
    assert.equal((await prisma.stoppage.findUniqueOrThrow({ where: { id: data.stoppage.id } })).totalRemindersSent, 1);
  });

  it("queues an automatic provider failure and retries with one successful reminder registration", async () => {
    const data = await fixture("automatic-provider-retry");
    let sends = 0;
    const keys: string[] = [];
    emailSender.send = async (input) => {
      sends += 1; keys.push(String(input.idempotencyKey));
      if (sends === 1) throw new Error("synthetic provider unavailable");
      return { provider: "resend", id: "automatic-retry-accepted" };
    };
    await useCase().automaticRun(data.now);
    const rows = await prisma.emailQueue.findMany({ where: { tenantId: data.tenant.id, type: "REMINDER_EMAIL" } });
    assert.equal(rows.length, 1);
    const row = rows[0]!;
    assert.equal(row.status, "PENDING");
    assert.equal(row.attempts, 1);
    await assertNoSuccess(data, { allowFailureHistory: true });
    const failureHistory = await prisma.reminder.findMany({ where: { stoppageId: data.stoppage.id, success: false } });
    assert.equal(failureHistory.length, 1, "the failed automatic provider attempt must remain visible in reminder history");
    assert.equal(failureHistory[0]!.type, "AUTOMATIC");
    assert.equal(failureHistory[0]!.channel, "EMAIL");
    assert.ok(failureHistory[0]!.errorMessage, "failed provider history must explain that delivery failed");
    assert.ok(!failureHistory[0]!.errorMessage?.includes(data.workshop.email!), "failed provider history must not echo the recipient");
    await prisma.emailQueue.update({ where: { id: row.id }, data: { nextAttemptAt: new Date(0) } });
    await queue.processPending(new Date(), { ids: [row.id] });
    assert.equal(sends, 2);
    assert.deepEqual(keys, [`fleetum-email-queue:${row.id}`, `fleetum-email-queue:${row.id}`]);
    assert.equal((await prisma.emailQueue.findUniqueOrThrow({ where: { id: row.id } })).status, "SENT");
    assert.equal(await prisma.reminder.count({ where: { stoppageId: data.stoppage.id, success: true } }), 1);
    assert.equal(await prisma.reminder.count({ where: { stoppageId: data.stoppage.id, success: false } }), 1);
    assert.equal(await prisma.reminder.count({ where: { stoppageId: data.stoppage.id } }), 2);
    assert.equal((await prisma.stoppage.findUniqueOrThrow({ where: { id: data.stoppage.id } })).totalRemindersSent, 1);
    assert.equal((await queue.processPending(new Date(), { ids: [row.id] })).processed, 0);
    assert.equal(sends, 2);
    assert.equal(await prisma.reminder.count({ where: { stoppageId: data.stoppage.id } }), 2);
  });

  it("preserves manual queued response on provider failure and finalizes the retry once", async () => {
    const data = await fixture("manual-provider-retry");
    let sends = 0;
    emailSender.send = async () => {
      sends += 1;
      if (sends === 1) throw new Error("synthetic manual provider failure");
      return { provider: "resend", id: "manual-retry-accepted" };
    };
    const result = await useCase().manualEmail(data.tenant.id, data.stoppage.id);
    assert.equal(result.success, false);
    assert.equal(result.queued, true);
    await assertNoSuccess(data, { allowFailureHistory: true });
    const failureHistory = await prisma.reminder.findMany({ where: { stoppageId: data.stoppage.id, success: false } });
    assert.equal(failureHistory.length, 1, "the failed manual provider attempt must remain visible in reminder history");
    assert.equal(failureHistory[0]!.type, "MANUAL");
    assert.equal(failureHistory[0]!.channel, "EMAIL");
    assert.ok(failureHistory[0]!.errorMessage, "failed provider history must explain that delivery failed");
    assert.ok(!failureHistory[0]!.errorMessage?.includes(data.workshop.email!), "failed provider history must not echo the recipient");
    const row = await prisma.emailQueue.findFirstOrThrow({ where: { tenantId: data.tenant.id, type: "REMINDER_EMAIL" } });
    assert.equal(row.status, "PENDING");
    assert.equal(row.attempts, 1);
    await prisma.emailQueue.update({ where: { id: row.id }, data: { nextAttemptAt: new Date(0) } });
    await queue.processPending(new Date(), { ids: [row.id] });
    assert.equal(sends, 2);
    assert.equal(await prisma.reminder.count({ where: { stoppageId: data.stoppage.id, success: true } }), 1);
    assert.equal(await prisma.reminder.count({ where: { stoppageId: data.stoppage.id, success: false } }), 1);
    assert.equal(await prisma.reminder.count({ where: { stoppageId: data.stoppage.id } }), 2);
    assert.equal((await prisma.stoppage.findUniqueOrThrow({ where: { id: data.stoppage.id } })).totalRemindersSent, 1);
    assert.equal((await queue.processPending(new Date(), { ids: [row.id] })).processed, 0);
    assert.equal(sends, 2);
    assert.equal(await prisma.reminder.count({ where: { stoppageId: data.stoppage.id } }), 2);
  });

  it("finalizes a persisted receipt without sending again or reopening a closed stoppage", async () => {
    const data = await fixture("persisted-receipt");
    await prisma.stoppage.update({ where: { id: data.stoppage.id }, data: { status: "CLOSED", closedAt: data.now } });
    const row = await enqueueRetry(data, "AUTOMATIC_RETRY", { emailProvider: "resend", providerMessageId: "persisted-reminder-receipt", providerAcceptedAt: new Date(data.now.getTime() - 60_000).toISOString() });
    await prisma.tenant.update({ where: { id: data.tenant.id }, data: { isActive: false } });
    let sends = 0;
    emailSender.send = async () => { sends += 1; throw new Error("persisted receipt must not invoke provider"); };
    await queue.processPending(new Date(), { ids: [row.id] });
    assert.equal(sends, 0);
    const finalized = await prisma.emailQueue.findUniqueOrThrow({ where: { id: row.id } });
    assert.equal(finalized.status, "SENT");
    assert.equal((finalized.meta as any).providerMessageId, "persisted-reminder-receipt");
    const persisted = await prisma.stoppage.findUniqueOrThrow({ where: { id: data.stoppage.id } });
    assert.equal(persisted.status, "CLOSED");
    assert.equal(persisted.closedAt?.getTime(), data.now.getTime());
    assert.equal(persisted.totalRemindersSent, 1);
    assert.equal(await prisma.reminder.count({ where: { stoppageId: data.stoppage.id, success: true } }), 1);
  });

  it("does not hold stoppage locks during provider wait and preserves a closure committed while the email is in flight", async () => {
    const data = await fixture("closed-in-flight");
    const entered = deferred();
    const release = deferred();
    let sends = 0;
    emailSender.send = async () => { sends += 1; entered.resolve(); await release.promise; return { provider: "resend", id: "in-flight-reminder" }; };
    const worker = useCase().automaticRun(data.now);
    const closedAt = new Date();
    try {
      await waitFor(entered.promise, "provider initiation before closure");
      await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SET LOCAL lock_timeout = '1000ms'`;
        await tx.stoppage.update({ where: { id: data.stoppage.id }, data: { status: "CLOSED", closedAt } });
      });
    } finally { release.resolve(); await worker; }
    assert.equal(sends, 1);
    const persisted = await prisma.stoppage.findUniqueOrThrow({ where: { id: data.stoppage.id } });
    assert.equal(persisted.status, "CLOSED");
    assert.equal(persisted.closedAt?.getTime(), closedAt.getTime());
    assert.equal(persisted.totalRemindersSent, 1);
    assert.equal(await prisma.reminder.count({ where: { stoppageId: data.stoppage.id, success: true } }), 1);
  });

  it("serializes a receipt finalizer and an automatic producer under a legacy license without taking Stoppage before Tenant", async () => {
    const data = await fixture("legacy-finalizer-producer", { noSubscription: true });
    await prisma.auditLog.create({ data: {
      tenantId: data.tenant.id, action: "PLATFORM_LICENSE_UPDATED", resource: "tenant",
      details: { after: { plan: "STARTER", status: "ACTIVE", seats: 3, expiresAt: null } }
    } });
    const row = await enqueueRetry(data, "AUTOMATIC_RETRY", {
      emailProvider: "resend", providerMessageId: "legacy-finalizer-receipt", providerAcceptedAt: new Date().toISOString()
    });
    const locked = deferred();
    const release = deferred();
    const claimed = deferred();
    let sends = 0;
    emailSender.send = async () => { sends += 1; return { provider: "resend", id: "unexpected-legacy-race-send" }; };
    const lockTenant = prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "Tenant" WHERE "id" = ${data.tenant.id} FOR UPDATE`;
      locked.resolve();
      await release.promise;
    }, { timeout: 10000 });
    await waitFor(locked.promise, "external Tenant lock");
    let finalizer: Promise<unknown> | undefined;
    let producer: Promise<unknown> | undefined;
    const tenantWaiters = async () => {
      const [row] = await prisma.$queryRaw<Array<{ count: bigint }>>`
        SELECT COUNT(*) AS count FROM pg_stat_activity
        WHERE datname = current_database() AND pid <> pg_backend_pid()
          AND wait_event_type = 'Lock' AND query LIKE '%"Tenant"%'
      `;
      return Number(row?.count ?? 0);
    };
    const waitForTenantWaiters = async (minimum: number) => {
      const deadline = Date.now() + 1500;
      while (Date.now() < deadline) {
        if (await tenantWaiters() >= minimum) return;
        await new Promise((done) => setTimeout(done, 10));
      }
      assert.fail(`expected ${minimum} operation(s) waiting on the held Tenant lock`);
    };
    const assertStoppageUnlocked = () => prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SET LOCAL lock_timeout = '500ms'`;
      await tx.$queryRaw`SELECT "id" FROM "Stoppage" WHERE "id" = ${data.stoppage.id} FOR UPDATE`;
    });
    try {
      finalizer = afterClaim(row.id, async () => { claimed.resolve(); }, () => queue.processPending(new Date(), { ids: [row.id] }));
      await waitFor(claimed.promise, "legacy receipt queue claim");
      await waitForTenantWaiters(1);
      await assertStoppageUnlocked();
      producer = useCase().automaticRun(new Date());
      await waitForTenantWaiters(2);
      await assertStoppageUnlocked();
    } finally {
      release.resolve();
      await lockTenant;
      if (finalizer) await waitFor(finalizer, "legacy receipt finalization");
      if (producer) await waitFor(producer, "legacy automatic producer completion");
    }
    assert.equal(sends, 0, "the accepted receipt must not be sent again by either path");
    assert.equal((await prisma.emailQueue.findUniqueOrThrow({ where: { id: row.id } })).status, "SENT");
    assert.equal(await prisma.emailQueue.count({ where: { tenantId: data.tenant.id, type: "REMINDER_EMAIL" } }), 1);
    assert.equal(await prisma.reminder.count({ where: { stoppageId: data.stoppage.id, success: true } }), 1);
    assert.equal((await prisma.stoppage.findUniqueOrThrow({ where: { id: data.stoppage.id } })).totalRemindersSent, 1);
  });

  it("finalizes one reminder after the dispatch guard commit acknowledgement is lost", async () => {
    const data = await fixture("reminder-guard-lost-ack");
    const row = await enqueueRetry(data);
    let sends = 0;
    emailSender.send = async (input) => {
      sends += 1;
      assert.equal(input.idempotencyKey, `fleetum-email-queue:${row.id}`);
      return { provider: "resend", id: "reminder-guard-lost-ack-receipt" };
    };
    const originalTransaction = prisma.$transaction.bind(prisma);
    let loseAcknowledgement = true;
    (prisma as any).$transaction = async (...args: unknown[]) => {
      const result = await (originalTransaction as any)(...args);
      if (loseAcknowledgement && typeof args[0] === "function") {
        loseAcknowledgement = false;
        assert.equal(sends, 1, "the injected lost acknowledgement must follow reminder provider initiation");
        throw new Error("synthetic reminder guard commit acknowledgement lost");
      }
      return result;
    };
    try { await queue.processPending(new Date(), { ids: [row.id] }); }
    finally { (prisma as any).$transaction = originalTransaction; }
    assert.equal(loseAcknowledgement, false);
    assert.equal(sends, 1);
    const sent = await prisma.emailQueue.findUniqueOrThrow({ where: { id: row.id } });
    assert.equal(sent.status, "SENT");
    assert.equal(sent.attempts, 1);
    assert.equal(sent.processingToken, null);
    assert.equal(sent.leaseExpiresAt, null);
    assert.equal((sent.meta as any).providerMessageId, "reminder-guard-lost-ack-receipt");
    assert.equal(await prisma.reminder.count({ where: { stoppageId: data.stoppage.id } }), 1);
    assert.equal(await prisma.reminder.count({ where: { stoppageId: data.stoppage.id, success: true } }), 1);
    assert.equal((await prisma.stoppage.findUniqueOrThrow({ where: { id: data.stoppage.id } })).totalRemindersSent, 1);
    assert.equal((await queue.processPending(new Date(), { ids: [row.id] })).processed, 0);
    assert.equal(sends, 1);
    assert.equal(await prisma.reminder.count({ where: { stoppageId: data.stoppage.id } }), 1);
  });

  it("finalizes an accepted reminder after its dispatch guard transaction rolls back after provider initiation", async () => {
    const data = await fixture("reminder-guard-rollback");
    const row = await enqueueRetry(data);
    let sends = 0;
    emailSender.send = async () => { sends += 1; return { provider: "resend", id: "reminder-guard-rollback-receipt" }; };
    const originalTransaction = prisma.$transaction.bind(prisma);
    let failFirstTransaction = true;
    (prisma as any).$transaction = async (callback: unknown, ...args: unknown[]) => {
      if (failFirstTransaction && typeof callback === "function") {
        failFirstTransaction = false;
        return (originalTransaction as any)(async (tx: unknown) => {
          await callback(tx);
          assert.equal(sends, 1, "the injected rollback must follow reminder provider initiation");
          throw new Error("synthetic reminder guard rollback after provider initiation");
        }, ...args);
      }
      return (originalTransaction as any)(callback, ...args);
    };
    try { await queue.processPending(new Date(), { ids: [row.id] }); }
    finally { (prisma as any).$transaction = originalTransaction; }
    assert.equal(failFirstTransaction, false);
    assert.equal(sends, 1);
    const sent = await prisma.emailQueue.findUniqueOrThrow({ where: { id: row.id } });
    assert.equal(sent.status, "SENT");
    assert.equal(sent.attempts, 1);
    assert.equal(sent.processingToken, null);
    assert.equal(sent.leaseExpiresAt, null);
    assert.equal((sent.meta as any).providerMessageId, "reminder-guard-rollback-receipt");
    assert.equal(await prisma.reminder.count({ where: { stoppageId: data.stoppage.id } }), 1);
    assert.equal(await prisma.reminder.count({ where: { stoppageId: data.stoppage.id, success: true } }), 1);
    assert.equal((await prisma.stoppage.findUniqueOrThrow({ where: { id: data.stoppage.id } })).totalRemindersSent, 1);
    assert.equal((await queue.processPending(new Date(), { ids: [row.id] })).processed, 0);
    assert.equal(sends, 1);
    assert.equal(await prisma.reminder.count({ where: { stoppageId: data.stoppage.id } }), 1);
  });

  it("observes immediate provider rejection after reminder guard rollback and records one failure with normal backoff", async () => {
    const data = await fixture("reminder-guard-rollback-rejected");
    const row = await enqueueRetry(data);
    let sends = 0;
    emailSender.send = async () => { sends += 1; throw new Error("synthetic immediate reminder provider rejection"); };
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => { unhandled.push(reason); };
    process.on("unhandledRejection", onUnhandled);
    const originalTransaction = prisma.$transaction.bind(prisma);
    let failFirstTransaction = true;
    (prisma as any).$transaction = async (callback: unknown, ...args: unknown[]) => {
      if (failFirstTransaction && typeof callback === "function") {
        failFirstTransaction = false;
        return (originalTransaction as any)(async (tx: unknown) => {
          await callback(tx);
          assert.equal(sends, 1, "the injected rollback must follow rejected provider initiation");
          throw new Error("synthetic reminder guard rollback after rejected provider initiation");
        }, ...args);
      }
      return (originalTransaction as any)(callback, ...args);
    };
    const now = new Date();
    try {
      await queue.processPending(now, { ids: [row.id] });
      await new Promise((done) => setImmediate(done));
    } finally {
      (prisma as any).$transaction = originalTransaction;
      process.removeListener("unhandledRejection", onUnhandled);
    }
    assert.equal(failFirstTransaction, false);
    assert.equal(sends, 1);
    assert.deepEqual(unhandled, []);
    const pending = await prisma.emailQueue.findUniqueOrThrow({ where: { id: row.id } });
    assert.equal(pending.status, "PENDING");
    assert.equal(pending.attempts, 1);
    assert.equal(pending.processingToken, null);
    assert.equal(pending.leaseExpiresAt, null);
    assert.ok(pending.nextAttemptAt.getTime() - now.getTime() >= 2 * 60_000);
    assert.ok(pending.nextAttemptAt.getTime() - now.getTime() < 3 * 60_000);
    assert.equal((pending.meta as any).providerMessageId, undefined);
    assert.equal((pending.meta as any).dispatchBlockedReason, undefined);
    await assertNoSuccess(data, { allowFailureHistory: true });
    const failures = await prisma.reminder.findMany({ where: { stoppageId: data.stoppage.id, success: false } });
    assert.equal(failures.length, 1);
    assert.ok(failures[0]!.errorMessage);
    assert.equal((await queue.processPending(now, { ids: [row.id] })).processed, 0);
    assert.equal(sends, 1);
    assert.equal(await prisma.reminder.count({ where: { stoppageId: data.stoppage.id } }), 1);
  });
});
