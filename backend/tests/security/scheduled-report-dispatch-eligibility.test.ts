import assert from "node:assert/strict";
import { after, afterEach, before, describe, it } from "node:test";
import { prisma } from "../../src/infrastructure/database/prisma/client.js";
import { EmailQueueService } from "../../src/infrastructure/email/email-queue-service.js";
import { emailSender } from "../../src/infrastructure/email/email-sender.js";
import { PrismaPlatformAdminRepository } from "../../src/infrastructure/repositories/prisma-platform-admin-repository.js";

const runId = `report-dispatch-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const tenantIds: string[] = [];
const queueIds: string[] = [];
const originalSend = emailSender.send;
const queue = new EmailQueueService();

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
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Timed out waiting for ${label}`)), 3000);
      })
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
};

const createTenant = async (suffix: string, options: {
  active?: boolean;
  deleted?: boolean;
  plan?: string;
  licenseStatus?: string;
  expiresAt?: Date;
  noSubscription?: boolean;
} = {}) => {
  const id = `${runId}-${suffix}`;
  await prisma.tenant.create({
    data: {
      id,
      name: `Synthetic scheduled report ${suffix}`,
      isActive: options.active ?? true,
      deletedAt: options.deleted ? new Date() : null
    }
  });
  tenantIds.push(id);
  if (!options.noSubscription) {
    await prisma.tenantSubscription.create({
      data: {
        tenantId: id,
        provider: "local",
        plan: options.plan ?? "PRO",
        status: options.licenseStatus ?? "ACTIVE",
        currentPeriodEnd: options.expiresAt,
        trialEndsAt: options.licenseStatus === "TRIAL" ? options.expiresAt : null
      }
    });
  }
  return id;
};

const enqueue = async (suffix: string, tenantId: string | undefined, options: {
  type?: string;
  attempts?: number;
  meta?: Record<string, unknown>;
} = {}) => {
  const row = await queue.enqueue({
    tenantId,
    type: options.type ?? "SCHEDULED_REPORT",
    recipient: `${suffix}@example.test`,
    subject: `Synthetic report ${suffix}`,
    body: "Synthetic scheduled report; no production data",
    meta: { syntheticCase: suffix, ...options.meta }
  });
  queueIds.push(row.id);
  if (options.attempts !== undefined) {
    return prisma.emailQueue.update({ where: { id: row.id }, data: { attempts: options.attempts } });
  }
  return row;
};

const assertBlocked = async (id: string, reason: string, attempts = 0) => {
  const row = await prisma.emailQueue.findUniqueOrThrow({ where: { id } });
  assert.equal(row.status, "FAILED", "ineligible scheduled reports must become terminal");
  assert.equal(row.attempts, attempts, "policy denial is not a provider attempt");
  assert.equal(row.processingToken, null);
  assert.equal(row.processingStartedAt, null);
  assert.equal(row.leaseExpiresAt, null);
  assert.equal(row.lastError, `SCHEDULED_REPORT_DISPATCH_BLOCKED:${reason}`);
  const meta = (row.meta ?? {}) as Record<string, unknown>;
  assert.equal(meta.dispatchBlockedReason, reason);
  assert.equal(typeof meta.dispatchBlockedAt, "string");
  assert.equal(new Date(String(meta.dispatchBlockedAt)).toISOString(), meta.dispatchBlockedAt);
  assert.ok(!row.lastError?.includes(row.recipient), "policy errors must not contain recipients");
  return row;
};

const afterClaim = async (id: string, hook: () => Promise<void>, work: () => Promise<unknown>) => {
  const delegate = prisma.emailQueue;
  const originalFind = delegate.findFirstOrThrow.bind(delegate);
  let invoked = false;
  (delegate as any).findFirstOrThrow = async (args: Parameters<typeof originalFind>[0]) => {
    const row = await originalFind(args);
    if (!invoked && row.id === id && row.processingToken) {
      invoked = true;
      await hook();
    }
    return row;
  };
  try {
    await work();
    assert.equal(invoked, true, "the transition must happen after queue ownership was claimed");
  } finally {
    (delegate as any).findFirstOrThrow = originalFind;
  }
};

describe("scheduled report dispatch eligibility", () => {
  before(async () => { await prisma.$connect(); });

  afterEach(async () => {
    emailSender.send = originalSend;
    await prisma.emailQueue.deleteMany({ where: { id: { in: queueIds.splice(0) } } });
    await prisma.auditLog.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await prisma.invoiceDelivery.deleteMany({ where: { invoice: { tenantId: { in: tenantIds } } } });
    await prisma.invoice.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await prisma.tenantSubscription.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await prisma.tenant.deleteMany({ where: { id: { in: tenantIds.splice(0) } } });
  });

  after(async () => { await prisma.$disconnect(); });

  const deniedCases = [
    { suffix: "inactive", options: { active: false }, reason: "TENANT_INACTIVE" },
    { suffix: "deleted", options: { deleted: true }, reason: "TENANT_DELETED" },
    { suffix: "license-suspended", options: { licenseStatus: "SUSPENDED" }, reason: "LICENSE_SUSPENDED" },
    { suffix: "license-expired", options: { licenseStatus: "EXPIRED" }, reason: "LICENSE_EXPIRED" },
    { suffix: "deadline-expired", options: { expiresAt: new Date(0) }, reason: "LICENSE_EXPIRED" },
    { suffix: "trial-expired", options: { licenseStatus: "TRIAL", expiresAt: new Date(0) }, reason: "LICENSE_EXPIRED" },
    { suffix: "license-pending", options: { licenseStatus: "PENDING" }, reason: "LICENSE_PENDING" },
    { suffix: "license-past-due", options: { licenseStatus: "PAST_DUE" }, reason: "LICENSE_PAST_DUE" },
    { suffix: "license-canceled", options: { licenseStatus: "CANCELED" }, reason: "LICENSE_CANCELED" },
    { suffix: "no-license", options: { noSubscription: true }, reason: "LICENSE_PENDING" },
    { suffix: "starter", options: { plan: "STARTER" }, reason: "FEATURE_UNAVAILABLE" }
  ];

  for (const testCase of deniedCases) {
    it(`blocks ${testCase.suffix} before the provider without consuming an attempt`, async () => {
      const tenantId = await createTenant(testCase.suffix, testCase.options);
      const row = await enqueue(testCase.suffix, tenantId, { attempts: 2 });
      let sends = 0;
      emailSender.send = async () => { sends += 1; return { provider: "resend", id: "unexpected-send" }; };
      await queue.processPending(new Date(), { ids: [row.id] });
      assert.equal(sends, 0);
      const blocked = await assertBlocked(row.id, testCase.reason, 2);
      assert.equal((blocked.meta as any).syntheticCase, testCase.suffix);
    });
  }

  for (const tenantId of [undefined, `${runId}-missing-tenant`]) {
    it(`blocks a report with ${tenantId ? "a missing tenant" : "no tenant id"}`, async () => {
      const row = await enqueue(tenantId ? "missing" : "unbound", tenantId);
      let sends = 0;
      emailSender.send = async () => { sends += 1; return { provider: "resend", id: "unexpected-send" }; };
      await queue.processPending(new Date(), { ids: [row.id] });
      assert.equal(sends, 0);
      await assertBlocked(row.id, "TENANT_MISSING");
    });
  }

  for (const licenseStatus of ["ACTIVE", "TRIAL"]) {
    it(`sends eligible PRO ${licenseStatus} with the queue idempotency key`, async () => {
      const tenantId = await createTenant(licenseStatus.toLowerCase(), {
        licenseStatus,
        expiresAt: new Date(Date.now() + 24 * 60 * 60_000)
      });
      const row = await enqueue(licenseStatus.toLowerCase(), tenantId);
      const calls: string[] = [];
      emailSender.send = async (input) => {
        calls.push(String(input.idempotencyKey));
        return { provider: "resend", id: "eligible-report-message" };
      };
      await queue.processPending(new Date(), { ids: [row.id] });
      assert.deepEqual(calls, [`fleetum-email-queue:${row.id}`]);
      const sent = await prisma.emailQueue.findUniqueOrThrow({ where: { id: row.id } });
      assert.equal(sent.status, "SENT");
      assert.equal(sent.attempts, 1);
      assert.equal(sent.processingToken, null);
      assert.equal((sent.meta as any).providerMessageId, "eligible-report-message");
      assert.equal((sent.meta as any).dispatchBlockedReason, undefined);
    });
  }

  it("honors an eligible legacy audit license when no subscription exists", async () => {
    const tenantId = await createTenant("legacy-license", { noSubscription: true });
    await prisma.auditLog.create({
      data: {
        tenantId,
        action: "PLATFORM_LICENSE_UPDATED",
        resource: "tenant",
        details: { after: { plan: "PRO", status: "ACTIVE", seats: 3, expiresAt: null } }
      }
    });
    const row = await enqueue("legacy-license", tenantId);
    let sends = 0;
    emailSender.send = async () => { sends += 1; return { provider: "resend", id: "legacy-report-message" }; };
    await queue.processPending(new Date(), { ids: [row.id] });
    assert.equal(sends, 1);
    assert.equal((await prisma.emailQueue.findUniqueOrThrow({ where: { id: row.id } })).status, "SENT");
  });

  it("rechecks tenant state after discovery and claim and never replays a blocked report after reactivation", async () => {
    const tenantId = await createTenant("after-claim");
    const row = await enqueue("after-claim", tenantId);
    let sends = 0;
    emailSender.send = async () => { sends += 1; return { provider: "resend", id: "unexpected-send" }; };
    await afterClaim(row.id, async () => {
      await prisma.tenant.update({ where: { id: tenantId }, data: { isActive: false } });
    }, () => queue.processPending(new Date(), { ids: [row.id] }));
    assert.equal(sends, 0);
    const blocked = await assertBlocked(row.id, "TENANT_INACTIVE");
    await prisma.tenant.update({ where: { id: tenantId }, data: { isActive: true } });
    const retry = await queue.processPending(new Date(), { ids: [row.id] });
    assert.equal(retry.processed, 0);
    assert.equal(sends, 0);
    assert.deepEqual((await prisma.emailQueue.findUniqueOrThrow({ where: { id: row.id } })).meta, blocked.meta);
  });

  it("rechecks the current license after claim instead of sending a stale authorized report", async () => {
    const tenantId = await createTenant("license-after-claim");
    const row = await enqueue("license-after-claim", tenantId);
    let sends = 0;
    emailSender.send = async () => { sends += 1; return { provider: "resend", id: "unexpected-send" }; };
    await afterClaim(row.id, async () => {
      await prisma.tenantSubscription.update({ where: { tenantId }, data: { status: "SUSPENDED" } });
    }, () => queue.processPending(new Date(), { ids: [row.id] }));
    assert.equal(sends, 0);
    await assertBlocked(row.id, "LICENSE_SUSPENDED");
  });

  it("does not release a queued report after a Platform suspension followed by reactivation", async () => {
    const tenantId = await createTenant("platform-reactivated");
    const row = await enqueue("platform-reactivated", tenantId);
    await prisma.emailQueue.update({ where: { id: row.id }, data: { createdAt: new Date(Date.now() - 60_000) } });
    const platform = new PrismaPlatformAdminRepository();
    const actor = { actorUserId: `${runId}-synthetic-platform`, sourceIp: "192.0.2.5" };
    await platform.setTenantActive(tenantId, false, actor);
    await platform.setTenantActive(tenantId, true, actor);
    let sends = 0;
    emailSender.send = async () => { sends += 1; return { provider: "resend", id: "unexpected-send" }; };
    await queue.processPending(new Date(), { ids: [row.id] });
    assert.equal(sends, 0);
    await assertBlocked(row.id, "TENANT_STATUS_CHANGED");
  });

  it("finalizes an already accepted provider receipt while suspended without sending again", async () => {
    const tenantId = await createTenant("accepted-receipt", { active: false, licenseStatus: "SUSPENDED" });
    const providerAcceptedAt = new Date(Date.now() - 60_000).toISOString();
    const row = await enqueue("accepted-receipt", tenantId, {
      attempts: 2,
      meta: { emailProvider: "resend", providerMessageId: "persisted-synthetic-receipt", providerAcceptedAt }
    });
    let sends = 0;
    emailSender.send = async () => { sends += 1; throw new Error("receipt finalization must not send"); };
    await queue.processPending(new Date(), { ids: [row.id] });
    assert.equal(sends, 0);
    const sent = await prisma.emailQueue.findUniqueOrThrow({ where: { id: row.id } });
    assert.equal(sent.status, "SENT");
    assert.equal(sent.attempts, 3);
    assert.equal(sent.lastError, null);
    assert.equal(sent.processingToken, null);
    assert.equal((sent.meta as any).providerMessageId, "persisted-synthetic-receipt");
    assert.equal((sent.meta as any).providerAcceptedAt, providerAcceptedAt);
    assert.equal((sent.meta as any).dispatchBlockedReason, undefined);
  });

  it("requires a confirmed resend receipt before bypassing eligibility", async () => {
    const tenantId = await createTenant("incomplete-receipt", { active: false });
    const row = await enqueue("incomplete-receipt", tenantId, {
      meta: { emailProvider: "resend", providerMessageId: null, providerAcceptedAt: new Date().toISOString() }
    });
    let sends = 0;
    emailSender.send = async () => { sends += 1; return { provider: "resend", id: "unexpected-send" }; };
    await queue.processPending(new Date(), { ids: [row.id] });
    assert.equal(sends, 0);
    await assertBlocked(row.id, "TENANT_INACTIVE");
  });

  it("leaves password, invitation, valid invoices, billing, public and unknown queue types deliverable", async () => {
    const tenantId = await createTenant("other-types", { active: false, deleted: true, licenseStatus: "SUSPENDED", plan: "STARTER" });
    // A reserved invoice type still needs its own valid domain command. The
    // scheduled-report guard must not authorize or reject it as a report.
    const invoice = await prisma.invoice.create({ data: {
      tenantId, invoiceNumber: `${runId}-other-types`,
      issueDate: new Date("2030-01-01T00:00:00.000Z"), dueDate: new Date("2030-01-31T00:00:00.000Z"),
      periodStart: new Date("2029-12-01T00:00:00.000Z"), periodEnd: new Date("2029-12-31T00:00:00.000Z"),
      subtotal: 100, taxRate: 22, taxAmount: 22, total: 122, billingName: "Synthetic Billing"
    } });
    const invoiceDelivery = await prisma.invoiceDelivery.create({
      data: { invoiceId: invoice.id, recipient: "other-2@example.test" }
    });
    const types = [
      "PASSWORD_RESET", "USER_INVITATION", "SAAS_INVOICE_EMAIL", "BILLING_SUBSCRIPTION_SUSPENDED",
      "PUBLIC_DEMO_REQUEST", "SYNTHETIC_UNKNOWN_QUEUE_TYPE"
    ];
    const rows = await Promise.all(types.map((type, index) => enqueue(`other-${index}`, type === "PUBLIC_DEMO_REQUEST" ? undefined : tenantId, {
      type, meta: type === "SAAS_INVOICE_EMAIL"
        ? { tenantId, invoiceId: invoice.id, invoiceDeliveryId: invoiceDelivery.id } : undefined
    })));
    const calls: string[] = [];
    emailSender.send = async (input) => {
      calls.push(String(input.idempotencyKey));
      return { provider: "resend", id: `unaffected-message-${calls.length}` };
    };
    await queue.processPending(new Date(), { ids: rows.map((row) => row.id) });
    assert.deepEqual(calls.sort(), rows.map((row) => `fleetum-email-queue:${row.id}`).sort());
    const persisted = await prisma.emailQueue.findMany({ where: { id: { in: rows.map((row) => row.id) } } });
    assert.ok(persisted.every((row) => row.status === "SENT" && row.attempts === 1));
    assert.ok(persisted.every((row) => (row.meta as any).dispatchBlockedReason === undefined));
    assert.equal((await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } })).status, "SENT");
    assert.equal((await prisma.invoiceDelivery.findUniqueOrThrow({ where: { id: invoiceDelivery.id } })).status, "SENT");
  });

  it("serializes authorization behind a tenant suspension that commits first", async () => {
    const tenantId = await createTenant("locked-suspension");
    const row = await enqueue("locked-suspension", tenantId);
    const locked = deferred();
    const releaseLock = deferred();
    const claimed = deferred();
    let sends = 0;
    emailSender.send = async () => { sends += 1; return { provider: "resend", id: "unexpected-send" }; };
    const suspension = prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "Tenant" WHERE "id" = ${tenantId} FOR UPDATE`;
      await tx.tenant.update({ where: { id: tenantId }, data: { isActive: false } });
      locked.resolve();
      await releaseLock.promise;
    }, { timeout: 7000 });
    await waitFor(locked.promise, "synthetic suspension lock");
    let worker: Promise<unknown> | undefined;
    let blockedAtTenantLock = false;
    try {
      worker = afterClaim(row.id, async () => { claimed.resolve(); }, () => queue.processPending(new Date(), { ids: [row.id] }));
      await waitFor(claimed.promise, "queue claim");
      const deadline = Date.now() + 1500;
      while (Date.now() < deadline && sends === 0) {
        const waiters = await prisma.$queryRaw<Array<{ waiting: boolean }>>`
          SELECT EXISTS (
            SELECT 1 FROM pg_stat_activity
            WHERE datname = current_database() AND pid <> pg_backend_pid()
              AND wait_event_type = 'Lock' AND query LIKE '%"Tenant"%'
          ) AS waiting
        `;
        if (waiters[0]?.waiting) { blockedAtTenantLock = true; break; }
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    } finally {
      releaseLock.resolve();
      await suspension;
      if (worker) await worker;
    }
    assert.equal(blockedAtTenantLock, true, "authorization must synchronize with an in-flight tenant status writer");
    assert.equal(sends, 0);
    await assertBlocked(row.id, "TENANT_INACTIVE");
  });

  it("serializes authorization behind a subscription downgrade that commits first", async () => {
    const tenantId = await createTenant("locked-subscription-downgrade");
    const row = await enqueue("locked-subscription-downgrade", tenantId);
    const locked = deferred();
    const releaseLock = deferred();
    const claimed = deferred();
    let sends = 0;
    emailSender.send = async () => { sends += 1; return { provider: "resend", id: "unexpected-send" }; };
    const downgrade = prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "TenantSubscription" WHERE "tenantId" = ${tenantId} FOR UPDATE`;
      await tx.tenantSubscription.update({ where: { tenantId }, data: { plan: "STARTER" } });
      locked.resolve();
      await releaseLock.promise;
    }, { timeout: 7000 });
    await waitFor(locked.promise, "synthetic subscription downgrade lock");
    let worker: Promise<unknown> | undefined;
    let blockedAtSubscriptionLock = false;
    try {
      worker = afterClaim(row.id, async () => { claimed.resolve(); }, () => queue.processPending(new Date(), { ids: [row.id] }));
      await waitFor(claimed.promise, "queue claim before subscription authorization");
      const deadline = Date.now() + 1500;
      while (Date.now() < deadline && sends === 0) {
        const waiters = await prisma.$queryRaw<Array<{ waiting: boolean }>>`
          SELECT EXISTS (
            SELECT 1 FROM pg_stat_activity
            WHERE datname = current_database() AND pid <> pg_backend_pid()
              AND wait_event_type = 'Lock' AND query LIKE '%"TenantSubscription"%'
          ) AS waiting
        `;
        if (waiters[0]?.waiting) { blockedAtSubscriptionLock = true; break; }
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    } finally {
      releaseLock.resolve();
      await downgrade;
      if (worker) await worker;
    }
    assert.equal(blockedAtSubscriptionLock, true, "authorization must synchronize with an in-flight subscription writer");
    assert.equal(sends, 0);
    assert.equal((await prisma.tenantSubscription.findUniqueOrThrow({ where: { tenantId } })).plan, "STARTER");
    await assertBlocked(row.id, "FEATURE_UNAVAILABLE");
  });

  it("allows an already started provider call to finish without holding the Tenant lock during network wait", async () => {
    const tenantId = await createTenant("network-in-flight");
    const row = await enqueue("network-in-flight", tenantId);
    const enteredProvider = deferred();
    const releaseProvider = deferred();
    let sends = 0;
    emailSender.send = async () => {
      sends += 1;
      enteredProvider.resolve();
      await releaseProvider.promise;
      return { provider: "resend", id: "in-flight-synthetic-message" };
    };
    const worker = queue.processPending(new Date(), { ids: [row.id] });
    try {
      await waitFor(enteredProvider.promise, "provider initiation");
      await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SET LOCAL lock_timeout = '1000ms'`;
        await tx.$queryRaw`SELECT "id" FROM "Tenant" WHERE "id" = ${tenantId} FOR UPDATE`;
        await tx.tenant.update({ where: { id: tenantId }, data: { isActive: false } });
      });
    } finally {
      releaseProvider.resolve();
      await worker;
    }
    assert.equal(sends, 1);
    assert.equal((await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } })).isActive, false);
    const sent = await prisma.emailQueue.findUniqueOrThrow({ where: { id: row.id } });
    assert.equal(sent.status, "SENT", "a provider call already started before suspension may finish");
    assert.equal(sent.attempts, 1);
    assert.equal(sent.processingToken, null);
    assert.equal((sent.meta as any).providerMessageId, "in-flight-synthetic-message");
  });

  it("does not send or overwrite a queue lease taken over between claim and authorization", async () => {
    const tenantId = await createTenant("claim-takeover");
    const row = await enqueue("claim-takeover", tenantId);
    const successorLease = new Date(Date.now() + 10 * 60_000);
    let sends = 0;
    emailSender.send = async () => { sends += 1; return { provider: "resend", id: "unexpected-send" }; };
    await afterClaim(row.id, async () => {
      await prisma.emailQueue.update({
        where: { id: row.id },
        data: { processingToken: "synthetic-successor-worker", leaseExpiresAt: successorLease }
      });
    }, () => queue.processPending(new Date(), { ids: [row.id] }));
    assert.equal(sends, 0);
    const persisted = await prisma.emailQueue.findUniqueOrThrow({ where: { id: row.id } });
    assert.equal(persisted.status, "PENDING");
    assert.equal(persisted.attempts, 0);
    assert.equal(persisted.processingToken, "synthetic-successor-worker");
    assert.equal(persisted.leaseExpiresAt?.getTime(), successorLease.getTime());
    assert.equal((persisted.meta as any).dispatchBlockedReason, undefined);
  });

  it("finalizes one provider send after the authorization commit acknowledgement is lost", async () => {
    const tenantId = await createTenant("authorization-lost-ack");
    const row = await enqueue("authorization-lost-ack", tenantId);
    let sends = 0;
    emailSender.send = async (input) => {
      sends += 1;
      assert.equal(input.idempotencyKey, `fleetum-email-queue:${row.id}`);
      return { provider: "resend", id: "authorization-lost-ack-message" };
    };
    const originalTransaction = prisma.$transaction.bind(prisma);
    let loseAcknowledgement = true;
    (prisma as any).$transaction = async (...args: unknown[]) => {
      const result = await (originalTransaction as any)(...args);
      if (loseAcknowledgement && typeof args[0] === "function") {
        loseAcknowledgement = false;
        throw new Error("synthetic authorization commit acknowledgement lost");
      }
      return result;
    };
    try {
      await queue.processPending(new Date(), { ids: [row.id] });
    } finally {
      (prisma as any).$transaction = originalTransaction;
    }
    assert.equal(loseAcknowledgement, false);
    assert.equal(sends, 1);
    const sent = await prisma.emailQueue.findUniqueOrThrow({ where: { id: row.id } });
    assert.equal(sent.status, "SENT");
    assert.equal(sent.attempts, 1);
    assert.equal(sent.processingToken, null);
    assert.equal((sent.meta as any).providerMessageId, "authorization-lost-ack-message");
    assert.equal((await queue.processPending(new Date(), { ids: [row.id] })).processed, 0);
    assert.equal(sends, 1);
  });

  it("keeps the accepted provider receipt after the authorization transaction rolls back after send initiation", async () => {
    const tenantId = await createTenant("authorization-rollback");
    const row = await enqueue("authorization-rollback", tenantId);
    let sends = 0;
    emailSender.send = async () => {
      sends += 1;
      return { provider: "resend", id: "authorization-rollback-message" };
    };
    const originalTransaction = prisma.$transaction.bind(prisma);
    let failFirstTransaction = true;
    (prisma as any).$transaction = async (callback: unknown, ...args: unknown[]) => {
      if (failFirstTransaction && typeof callback === "function") {
        failFirstTransaction = false;
        return (originalTransaction as any)(async (tx: unknown) => {
          await callback(tx);
          assert.equal(sends, 1, "provider initiation must occur before the injected transaction rollback");
          throw new Error("synthetic rollback after provider initiation");
        }, ...args);
      }
      return (originalTransaction as any)(callback, ...args);
    };
    try {
      await queue.processPending(new Date(), { ids: [row.id] });
    } finally {
      (prisma as any).$transaction = originalTransaction;
    }
    assert.equal(failFirstTransaction, false);
    assert.equal(sends, 1);
    const sent = await prisma.emailQueue.findUniqueOrThrow({ where: { id: row.id } });
    assert.equal(sent.status, "SENT");
    assert.equal(sent.attempts, 1);
    assert.equal(sent.processingToken, null);
    assert.equal((sent.meta as any).providerMessageId, "authorization-rollback-message");
  });

  it("observes an immediate provider rejection after authorization rollback and preserves normal retry backoff", async () => {
    const tenantId = await createTenant("rollback-provider-reject");
    const row = await enqueue("rollback-provider-reject", tenantId);
    await prisma.emailQueue.update({ where: { id: row.id }, data: { maxAttempts: 2 } });
    let sends = 0;
    emailSender.send = async () => {
      sends += 1;
      throw new Error("synthetic immediate provider rejection");
    };
    const originalTransaction = prisma.$transaction.bind(prisma);
    let failFirstTransaction = true;
    (prisma as any).$transaction = async (callback: unknown, ...args: unknown[]) => {
      if (failFirstTransaction && typeof callback === "function") {
        failFirstTransaction = false;
        return (originalTransaction as any)(async (tx: unknown) => {
          await callback(tx);
          throw new Error("synthetic rollback after rejected provider initiation");
        }, ...args);
      }
      return (originalTransaction as any)(callback, ...args);
    };
    const attemptAt = new Date();
    try {
      await queue.processPending(attemptAt, { ids: [row.id] });
    } finally {
      (prisma as any).$transaction = originalTransaction;
    }
    assert.equal(sends, 1);
    const retryable = await prisma.emailQueue.findUniqueOrThrow({ where: { id: row.id } });
    assert.equal(retryable.status, "PENDING");
    assert.equal(retryable.attempts, 1);
    assert.equal(retryable.processingToken, null);
    assert.match(retryable.lastError ?? "", /synthetic immediate provider rejection/);
    assert.ok(retryable.nextAttemptAt.getTime() - attemptAt.getTime() >= 2 * 60_000);
    assert.ok(retryable.nextAttemptAt.getTime() - attemptAt.getTime() < 3 * 60_000);
    assert.equal((retryable.meta as any).providerMessageId, undefined);
    assert.equal((retryable.meta as any).dispatchBlockedReason, undefined);
    assert.equal((await queue.processPending(attemptAt, { ids: [row.id] })).processed, 0);
    await prisma.emailQueue.update({ where: { id: row.id }, data: { nextAttemptAt: new Date(0) } });
    await queue.processPending(new Date(), { ids: [row.id] });
    const failed = await prisma.emailQueue.findUniqueOrThrow({ where: { id: row.id } });
    assert.equal(sends, 2);
    assert.equal(failed.status, "FAILED");
    assert.equal(failed.attempts, 2);
    assert.equal(failed.processingToken, null);
  });
});
