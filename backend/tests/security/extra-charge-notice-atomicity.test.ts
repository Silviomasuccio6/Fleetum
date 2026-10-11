import assert from "node:assert/strict";
import { after, afterEach, before, describe, it } from "node:test";
import { RentalPaymentService } from "../../src/application/services/rental-payment-service.js";
import { PrivacyComplianceService } from "../../src/application/services/privacy-compliance-service.js";
import { prisma } from "../../src/infrastructure/database/prisma/client.js";
import { EmailQueueService } from "../../src/infrastructure/email/email-queue-service.js";
import { emailSender } from "../../src/infrastructure/email/email-sender.js";
import { PrismaAuditLogRepository } from "../../src/infrastructure/repositories/prisma-audit-log-repository.js";

const runId = `extra-notice-atomic-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const tenantIds: string[] = [];
const directQueueIds: string[] = [];
const originalSend = emailSender.send;
const queue = new EmailQueueService();
const service = () => new RentalPaymentService(new PrismaAuditLogRepository(), null, {}, queue);
let sequence = 0;

const fixture = async (suffix: string) => {
  const marker = `SYNTHETIC_${suffix.toUpperCase()}_${sequence++}`;
  const tenant = await prisma.tenant.create({ data: { id: `${runId}-${suffix}-${sequence}`, name: marker } });
  tenantIds.push(tenant.id);
  const subscription = await prisma.tenantSubscription.create({ data: { tenantId: tenant.id, provider: "local", plan: "STARTER", status: "ACTIVE" } });
  const user = await prisma.user.create({ data: {
    tenantId: tenant.id, email: `${suffix}-${sequence}@example.test`, firstName: "Synthetic", lastName: "Notice", passwordHash: "synthetic-unused-hash"
  } });
  const site = await prisma.site.create({ data: { tenantId: tenant.id, name: `${marker}_SITE`, address: "Synthetic", city: "Synthetic" } });
  const vehicle = await prisma.vehicle.create({ data: { tenantId: tenant.id, siteId: site.id, plate: `${marker}_PLATE`, brand: "Synthetic", model: "Synthetic" } });
  const customer = await prisma.rentalCustomer.create({ data: {
    tenantId: tenant.id, firstName: "Synthetic", lastName: "Customer", email: `${suffix}-${sequence}-customer@example.test`
  } });
  const booking = await prisma.rentalBooking.create({ data: {
    tenantId: tenant.id, vehicleId: vehicle.id, customerId: customer.id, createdByUserId: user.id,
    code: `${marker}_BOOKING`, customerName: "Synthetic Customer", customerEmail: `${suffix}-${sequence}-fallback@example.test`,
    status: "CLOSED", pickupAt: new Date("2030-01-01T00:00:00.000Z"), returnAt: new Date("2030-01-02T00:00:00.000Z")
  } });
  const extra = await prisma.rentalExtraCharge.create({ data: {
    tenantId: tenant.id, bookingId: booking.id, rentalCustomerId: customer.id, vehicleId: vehicle.id,
    createdByUserId: user.id, approvedByUserId: user.id, type: "DAMAGE", description: `${marker}_DESCRIPTION`,
    amountCents: 1200, adminFeeCents: 100, totalAmountCents: 1300, currency: "EUR", status: "APPROVED"
  } });
  return { tenant, subscription, user, site, vehicle, customer, booking, extra, marker };
};
type Fixture = Awaited<ReturnType<typeof fixture>>;
const pair = async () => ({ a: await fixture("owner-a"), b: await fixture("foreign-b") });
const input = (a: Fixture) => ({ tenantId: a.tenant.id, extraChargeId: a.extra.id, userId: a.user.id });
const charge = (a: Fixture) => prisma.rentalExtraCharge.findUniqueOrThrow({ where: { id: a.extra.id } });
const queued = (a: Fixture) => prisma.emailQueue.findMany({ where: { tenantId: a.tenant.id, type: "RENTAL_EXTRA_CHARGE_NOTICE" }, orderBy: { createdAt: "asc" } });
const noticeAudit = (a: Fixture) => prisma.auditLog.findMany({ where: { tenantId: a.tenant.id, resourceId: a.extra.id }, orderBy: { createdAt: "asc" } });
const notifiedAudits = (a: Fixture) => prisma.auditLog.count({ where: { tenantId: a.tenant.id, resourceId: a.extra.id, action: "RENTAL_EXTRA_CHARGE_NOTIFIED" } });
const snapshot = async () => {
  const own = { in: [...tenantIds] };
  return JSON.stringify({
    charges: await prisma.rentalExtraCharge.findMany({ where: { tenantId: own }, orderBy: { id: "asc" } }),
    queue: await prisma.emailQueue.findMany({ where: { OR: [{ tenantId: own }, { id: { in: directQueueIds } }] }, orderBy: { id: "asc" } }),
    audits: await prisma.auditLog.findMany({ where: { tenantId: own }, orderBy: { id: "asc" } }),
    bookings: await prisma.rentalBooking.findMany({ where: { tenantId: own }, orderBy: { id: "asc" } }),
    customers: await prisma.rentalCustomer.findMany({ where: { tenantId: own }, orderBy: { id: "asc" } })
  });
};
const assert4xx = async (work: () => Promise<unknown>) => assert.rejects(work, (error: unknown) => {
  assert.ok(error instanceof Error);
  const status = (error as any).statusCode;
  assert.ok(Number.isInteger(status) && status >= 400 && status < 500, `expected controlled 4xx, got ${String(status)}`);
  return true;
});
const assertDeniedWithoutMutation = async (work: () => Promise<unknown>) => {
  const initial = await snapshot();
  await assert4xx(work);
  assert.equal(await snapshot(), initial, "denied notice must not enqueue, change state or append audit in either tenant");
};
const prepare = async (a: Fixture) => {
  await service().notifyExtraCharge(input(a));
  const rows = await queued(a);
  assert.equal(rows.length, 1, "one producer operation must own exactly one queue command");
  return rows[0]!;
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
  try { await work(); assert.equal(invoked, true, "context transition must occur after the real queue lease claim"); }
  finally { (delegate as any).findFirstOrThrow = originalFind; }
};
const withFixtureFailure = async (
  table: "EmailQueue" | "AuditLog" | "RentalExtraCharge", condition: string, operation: "INSERT" | "UPDATE", work: () => Promise<void>
) => {
  const suffix = `${Date.now()}_${sequence++}`;
  const fn = `synthetic_extra_notice_failure_${suffix}`;
  const trigger = `synthetic_extra_notice_trigger_${suffix}`;
  let created = false;
  try {
    // All conditions are built only from fixture IDs validated by callers.
    // The trigger rejects one real database write; no persistence is mocked.
    await prisma.$executeRawUnsafe(`CREATE FUNCTION "${fn}"() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF ${condition} THEN
          RAISE EXCEPTION 'synthetic extra notice persistence failure' USING ERRCODE = '23514';
        END IF;
        RETURN NEW;
      END;
    $$`);
    await prisma.$executeRawUnsafe(`CREATE TRIGGER "${trigger}" BEFORE ${operation} ON "${table}" FOR EACH ROW EXECUTE FUNCTION "${fn}"()`);
    created = true;
    await work();
  } finally {
    if (created) await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS "${trigger}" ON "${table}"`);
    await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS "${fn}"()`);
  }
};
const safeId = (id: string) => { assert.match(id, /^[a-zA-Z0-9-]+$/); return id; };
const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
};
const waitBounded = async <T>(promise: Promise<T>, label: string, timeoutMs = 7000): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([promise, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`Timed out waiting for ${label}`)), timeoutMs);
    })]);
  } finally { if (timer) clearTimeout(timer); }
};
const assertBlocked = async (id: string) => {
  const row = await prisma.emailQueue.findUniqueOrThrow({ where: { id } });
  assert.equal(row.status, "FAILED", "ineligible notice must be terminally blocked before provider initiation");
  assert.equal(row.attempts, 0, "policy denial must not count as a provider attempt");
  assert.equal(row.processingToken, null);
  assert.equal(row.processingStartedAt, null);
  assert.equal(row.leaseExpiresAt, null);
  assert.ok(!String(row.lastError).includes(row.recipient), "denial diagnostics must omit the recipient");
  return row;
};

describe("extra charge notice preparation, authorization and receipt atomicity", { concurrency: false }, () => {
  before(async () => { await prisma.$connect(); });
  afterEach(async () => {
    emailSender.send = originalSend;
    const own = { in: [...tenantIds] };
    await prisma.emailQueue.deleteMany({ where: { OR: [{ tenantId: own }, { id: { in: directQueueIds.splice(0) } }] } });
    await prisma.rentalExtraCharge.deleteMany({ where: { tenantId: own } });
    await prisma.rentalBooking.deleteMany({ where: { tenantId: own } });
    await prisma.rentalCustomer.deleteMany({ where: { tenantId: own } });
    await prisma.vehicle.deleteMany({ where: { tenantId: own } });
    await prisma.site.deleteMany({ where: { tenantId: own } });
    await prisma.user.deleteMany({ where: { tenantId: own } });
    await prisma.auditLog.deleteMany({ where: { tenantId: own } });
    await prisma.tenantSubscription.deleteMany({ where: { tenantId: own } });
    await prisma.tenant.deleteMany({ where: { id: { in: tenantIds.splice(0) } } });
  });
  after(async () => { await prisma.$disconnect(); });

  it("preparation queues one notice and leaves APPROVED/notifiedAt unchanged until provider acceptance", async () => {
    const a = await fixture("prepared");
    let sends = 0;
    emailSender.send = async () => { sends += 1; throw new Error("producer must not dispatch a provider"); };
    await prepare(a);
    assert.equal(sends, 0);
    const current = await charge(a);
    assert.equal(current.status, "APPROVED");
    assert.equal(current.notifiedAt, null);
    assert.equal(await notifiedAudits(a), 0);
    assert.equal((await noticeAudit(a)).length, 1, "the prepared command and its audit are committed together");
  });

  for (const failure of ["queue", "audit"] as const) {
    it(`producer ${failure} write failure rolls back its queue command, audit and domain state`, async () => {
      const a = await fixture(`producer-failure-${failure}`);
      const initial = await snapshot();
      const condition = failure === "queue"
        ? `NEW."tenantId" = '${safeId(a.tenant.id)}' AND NEW."type" = 'RENTAL_EXTRA_CHARGE_NOTICE'`
        : `NEW."tenantId" = '${safeId(a.tenant.id)}' AND NEW."resourceId" = '${safeId(a.extra.id)}'`;
      await withFixtureFailure(failure === "queue" ? "EmailQueue" : "AuditLog", condition, "INSERT", async () => {
        await assert.rejects(() => service().notifyExtraCharge(input(a)));
        assert.equal(await snapshot(), initial, "a failed preparation must leave no committed command or state change");
      });
    });
  }

  it("two concurrent notify operations own one logical command and one queued audit", async () => {
    const a = await fixture("concurrent-producer");
    const results = await Promise.allSettled([service().notifyExtraCharge(input(a)), service().notifyExtraCharge(input(a))]);
    for (const result of results) assert.equal(result.status, "fulfilled", result.status === "rejected" ? String(result.reason) : "");
    assert.equal((await queued(a)).length, 1);
    assert.equal((await noticeAudit(a)).length, 1);
    assert.equal((await charge(a)).status, "APPROVED");
    assert.equal((await charge(a)).notifiedAt, null);
  });

  for (const target of ["foreign", "missing", "deleted"] as const) {
    it(`producer rejects a ${target} extra charge without side effects`, async () => {
      const { a, b } = await pair();
      if (target === "deleted") await prisma.rentalExtraCharge.update({ where: { id: a.extra.id }, data: { deletedAt: new Date() } });
      const extraChargeId = target === "foreign" ? b.extra.id : target === "missing" ? `${runId}-missing-extra` : a.extra.id;
      await assertDeniedWithoutMutation(() => service().notifyExtraCharge({ ...input(a), extraChargeId }));
    });
  }

  for (const target of ["foreign-booking", "foreign-booking-vehicle", "foreign-vehicle-site", "foreign-booking-customer", "foreign-charge-customer", "foreign-charge-vehicle", "customer-mismatch", "vehicle-mismatch", "deleted-booking", "deleted-customer"] as const) {
    it(`producer denies ${target} context without queue, state or audit mutation`, async () => {
      const { a, b } = await pair();
      if (target === "foreign-booking") await prisma.rentalExtraCharge.update({ where: { id: a.extra.id }, data: { bookingId: b.booking.id } });
      if (target === "foreign-booking-vehicle") await prisma.rentalBooking.update({ where: { id: a.booking.id }, data: { vehicleId: b.vehicle.id } });
      if (target === "foreign-vehicle-site") await prisma.vehicle.update({ where: { id: a.vehicle.id }, data: { siteId: b.site.id } });
      if (target === "foreign-booking-customer") await prisma.rentalBooking.update({ where: { id: a.booking.id }, data: { customerId: b.customer.id } });
      if (target === "foreign-charge-customer") await prisma.rentalExtraCharge.update({ where: { id: a.extra.id }, data: { rentalCustomerId: b.customer.id } });
      if (target === "foreign-charge-vehicle") await prisma.rentalExtraCharge.update({ where: { id: a.extra.id }, data: { vehicleId: b.vehicle.id } });
      if (target === "customer-mismatch") {
        const other = await prisma.rentalCustomer.create({ data: { tenantId: a.tenant.id, firstName: "Synthetic", lastName: "Other", email: "other-customer@example.test" } });
        await prisma.rentalExtraCharge.update({ where: { id: a.extra.id }, data: { rentalCustomerId: other.id } });
      }
      if (target === "vehicle-mismatch") {
        const other = await prisma.vehicle.create({ data: { tenantId: a.tenant.id, siteId: a.site.id, plate: `SYNTHETIC_OTHER_${sequence++}`, brand: "Synthetic", model: "Other" } });
        await prisma.rentalExtraCharge.update({ where: { id: a.extra.id }, data: { vehicleId: other.id } });
      }
      if (target === "deleted-booking") await prisma.rentalBooking.update({ where: { id: a.booking.id }, data: { deletedAt: new Date() } });
      if (target === "deleted-customer") await prisma.rentalCustomer.update({ where: { id: a.customer.id }, data: { deletedAt: new Date() } });
      await assertDeniedWithoutMutation(() => service().notifyExtraCharge(input(a)));
    });
  }

  for (const target of ["foreign", "missing", "suspended", "deleted"] as const) {
    it(`producer denies a ${target} actor`, async () => {
      const { a, b } = await pair();
      if (target === "suspended") await prisma.user.update({ where: { id: a.user.id }, data: { status: "SUSPENDED" } });
      if (target === "deleted") await prisma.user.update({ where: { id: a.user.id }, data: { deletedAt: new Date() } });
      const userId = target === "foreign" ? b.user.id : target === "missing" ? `${runId}-missing-actor` : a.user.id;
      await assertDeniedWithoutMutation(() => service().notifyExtraCharge({ ...input(a), userId }));
    });
  }

  for (const status of ["DRAFT", "PENDING_APPROVAL", "NOTIFIED", "PAYMENT_PROCESSING", "FAILED", "REQUIRES_ACTION", "PAID", "CANCELED", "REFUNDED", "DISPUTED"] as const) {
    it(`producer refuses to resurrect a ${status} extra charge`, async () => {
      const a = await fixture(`terminal-${status}`);
      await prisma.rentalExtraCharge.update({ where: { id: a.extra.id }, data: { status } });
      await assertDeniedWithoutMutation(() => service().notifyExtraCharge(input(a)));
    });
  }

  it("producer refuses a canceled booking without any notice side effect", async () => {
    const a = await fixture("canceled-booking");
    await prisma.rentalBooking.update({ where: { id: a.booking.id }, data: { status: "CANCELED" } });
    await assertDeniedWithoutMutation(() => service().notifyExtraCharge(input(a)));
  });

  it("owned deleted inactive vehicle and site remain valid historical context for an extra notice", async () => {
    const a = await fixture("historical-vehicle-site");
    await prisma.vehicle.update({ where: { id: a.vehicle.id }, data: { deletedAt: new Date(), isActive: false } });
    await prisma.site.update({ where: { id: a.site.id }, data: { deletedAt: new Date(), isActive: false } });
    const row = await prepare(a);
    let sends = 0;
    emailSender.send = async () => { sends += 1; return { provider: "resend", id: "synthetic-historical-extra" }; };
    await queue.processPending(new Date(), { ids: [row.id] });
    assert.equal(sends, 1);
    assert.equal((await charge(a)).status, "NOTIFIED");
    assert.equal(await notifiedAudits(a), 1);
  });

  it("a missing customer email uses the owned booking email fallback", async () => {
    const a = await fixture("recipient-fallback");
    await prisma.rentalCustomer.update({ where: { id: a.customer.id }, data: { email: null } });
    const row = await prepare(a);
    assert.equal(row.recipient, a.booking.customerEmail);
    let sends = 0;
    emailSender.send = async (request) => { sends += 1; assert.equal(request.to, a.booking.customerEmail); return { provider: "resend", id: "synthetic-extra-fallback" }; };
    await queue.processPending(new Date(), { ids: [row.id] });
    assert.equal(sends, 1);
    assert.equal((await charge(a)).status, "NOTIFIED");
  });

  it("missing customer and fallback email is rejected without queue or audit", async () => {
    const a = await fixture("recipient-missing");
    await prisma.rentalCustomer.update({ where: { id: a.customer.id }, data: { email: null } });
    await prisma.rentalBooking.update({ where: { id: a.booking.id }, data: { customerEmail: null } });
    await assertDeniedWithoutMutation(() => service().notifyExtraCharge(input(a)));
  });

  for (const target of ["tenant-inactive", "tenant-deleted", "license-suspended", "license-expired"] as const) {
    it(`producer rejects ${target} before creating a notice`, async () => {
      const a = await fixture(`ineligible-${target}`);
      if (target === "tenant-inactive") await prisma.tenant.update({ where: { id: a.tenant.id }, data: { isActive: false } });
      if (target === "tenant-deleted") await prisma.tenant.update({ where: { id: a.tenant.id }, data: { deletedAt: new Date() } });
      if (target === "license-suspended") await prisma.tenantSubscription.update({ where: { tenantId: a.tenant.id }, data: { status: "SUSPENDED" } });
      if (target === "license-expired") await prisma.tenantSubscription.update({ where: { tenantId: a.tenant.id }, data: { currentPeriodEnd: new Date(0) } });
      await assertDeniedWithoutMutation(() => service().notifyExtraCharge(input(a)));
    });
  }

  for (const target of ["tenant-inactive", "license-suspended", "extra-paid", "extra-canceled", "extra-deleted", "booking-deleted", "booking-canceled", "customer-deleted", "destination-changed", "description-changed", "amount-changed", "booking-vehicle-foreign-site"] as const) {
    it(`dispatch rechecks ${target} after claim and blocks before provider initiation`, async () => {
      const { a, b } = await pair();
      const row = await prepare(a);
      let sends = 0;
      emailSender.send = async () => { sends += 1; return { provider: "resend", id: "synthetic-must-not-send" }; };
      await afterClaim(row.id, async () => {
        if (target === "tenant-inactive") await prisma.tenant.update({ where: { id: a.tenant.id }, data: { isActive: false } });
        if (target === "license-suspended") await prisma.tenantSubscription.update({ where: { tenantId: a.tenant.id }, data: { status: "SUSPENDED" } });
        if (target === "extra-paid") await prisma.rentalExtraCharge.update({ where: { id: a.extra.id }, data: { status: "PAID" } });
        if (target === "extra-canceled") await prisma.rentalExtraCharge.update({ where: { id: a.extra.id }, data: { status: "CANCELED" } });
        if (target === "extra-deleted") await prisma.rentalExtraCharge.update({ where: { id: a.extra.id }, data: { deletedAt: new Date() } });
        if (target === "booking-deleted") await prisma.rentalBooking.update({ where: { id: a.booking.id }, data: { deletedAt: new Date() } });
        if (target === "booking-canceled") await prisma.rentalBooking.update({ where: { id: a.booking.id }, data: { status: "CANCELED" } });
        if (target === "customer-deleted") await prisma.rentalCustomer.update({ where: { id: a.customer.id }, data: { deletedAt: new Date() } });
        if (target === "destination-changed") await prisma.rentalCustomer.update({ where: { id: a.customer.id }, data: { email: "changed-destination@example.test" } });
        if (target === "description-changed") await prisma.rentalExtraCharge.update({ where: { id: a.extra.id }, data: { description: "Synthetic changed claim description" } });
        if (target === "amount-changed") await prisma.rentalExtraCharge.update({ where: { id: a.extra.id }, data: { amountCents: 2200, totalAmountCents: 2300 } });
        if (target === "booking-vehicle-foreign-site") await prisma.vehicle.update({ where: { id: a.vehicle.id }, data: { siteId: b.site.id } });
      }, () => queue.processPending(new Date(), { ids: [row.id] }));
      assert.equal(sends, 0);
      await assertBlocked(row.id);
      assert.equal(await notifiedAudits(a), 0);
      assert.equal((await charge(a)).notifiedAt, null);
      if (target === "extra-paid") assert.equal((await charge(a)).status, "PAID");
      if (target === "extra-canceled") assert.equal((await charge(a)).status, "CANCELED");
    });
  }

  it("provider acceptance promotes APPROVED and records one notification audit in the same local commit", async () => {
    const a = await fixture("accepted");
    const row = await prepare(a);
    let sends = 0;
    let observedStatus: string | undefined;
    let observedNotifiedAt: Date | null | undefined;
    emailSender.send = async (request) => {
      sends += 1;
      assert.equal(request.to, a.customer.email);
      assert.equal(request.idempotencyKey, `fleetum-email-queue:${row.id}`);
      const current = await charge(a);
      observedStatus = current.status;
      observedNotifiedAt = current.notifiedAt;
      return { provider: "resend", id: "synthetic-extra-accepted" };
    };
    await queue.processPending(new Date(), { ids: [row.id] });
    assert.equal(sends, 1);
    assert.equal(observedStatus, "APPROVED");
    assert.equal(observedNotifiedAt, null);
    const sent = await prisma.emailQueue.findUniqueOrThrow({ where: { id: row.id } });
    assert.equal(sent.status, "SENT");
    assert.equal(sent.processingToken, null);
    assert.equal((sent.meta as any).providerMessageId, "synthetic-extra-accepted");
    assert.equal((await charge(a)).status, "NOTIFIED");
    assert.ok((await charge(a)).notifiedAt);
    assert.equal(await notifiedAudits(a), 1);
    await queue.processPending(new Date(), { ids: [row.id] });
    assert.equal(sends, 1);
    assert.equal(await notifiedAudits(a), 1);
  });

  it("provider failure retries the same logical command and idempotency key without premature notification", async () => {
    const a = await fixture("provider-retry");
    const row = await prepare(a);
    const keys: string[] = [];
    emailSender.send = async (request) => {
      keys.push(String(request.idempotencyKey));
      if (keys.length === 1) throw new Error("synthetic extra provider outage");
      return { provider: "resend", id: "synthetic-extra-retry-accepted" };
    };
    await queue.processPending(new Date(), { ids: [row.id] });
    const pending = await prisma.emailQueue.findUniqueOrThrow({ where: { id: row.id } });
    assert.equal(pending.status, "PENDING");
    assert.equal(pending.attempts, 1);
    assert.equal((await charge(a)).status, "APPROVED");
    assert.equal((await charge(a)).notifiedAt, null);
    assert.equal(await notifiedAudits(a), 0);
    await service().notifyExtraCharge(input(a));
    assert.equal((await queued(a)).length, 1, "producer retry must reuse its pending command");
    await prisma.emailQueue.update({ where: { id: row.id }, data: { nextAttemptAt: new Date(0) } });
    await queue.processPending(new Date(), { ids: [row.id] });
    assert.deepEqual(keys, [`fleetum-email-queue:${row.id}`, `fleetum-email-queue:${row.id}`]);
    assert.equal((await charge(a)).status, "NOTIFIED");
    assert.equal(await notifiedAudits(a), 1);
  });

  for (const failure of ["charge-state", "notified-audit"] as const) {
    it(`accepted receipt survives ${failure} finalization failure and recovers without resend`, async () => {
      const a = await fixture(`local-finalization-${failure}`);
      const row = await prepare(a);
      let sends = 0;
      emailSender.send = async () => { sends += 1; return { provider: "resend", id: `synthetic-extra-receipt-${failure}` }; };
      const condition = failure === "charge-state"
        ? `NEW."id" = '${safeId(a.extra.id)}' AND NEW."status" = 'NOTIFIED'`
        : `NEW."resourceId" = '${safeId(a.extra.id)}' AND NEW."action" = 'RENTAL_EXTRA_CHARGE_NOTIFIED'`;
      await withFixtureFailure(failure === "charge-state" ? "RentalExtraCharge" : "AuditLog", condition, failure === "charge-state" ? "UPDATE" : "INSERT", async () => {
        await queue.processPending(new Date(), { ids: [row.id] });
        assert.equal(sends, 1);
        const pending = await prisma.emailQueue.findUniqueOrThrow({ where: { id: row.id } });
        assert.equal(pending.status, "PENDING");
        assert.equal((pending.meta as any).providerMessageId, `synthetic-extra-receipt-${failure}`);
        assert.equal(pending.processingToken, null);
        assert.equal((await charge(a)).status, "APPROVED");
        assert.equal((await charge(a)).notifiedAt, null);
        assert.equal(await notifiedAudits(a), 0);
      });
      await prisma.emailQueue.update({ where: { id: row.id }, data: { nextAttemptAt: new Date(0) } });
      await queue.processPending(new Date(), { ids: [row.id] });
      assert.equal(sends, 1, "stored acceptance must bypass the provider on local recovery");
      assert.equal((await prisma.emailQueue.findUniqueOrThrow({ where: { id: row.id } })).status, "SENT");
      assert.equal((await charge(a)).status, "NOTIFIED");
      assert.equal(await notifiedAudits(a), 1);
    });
  }

  for (const state of ["APPROVED", "PAID", "CANCELED"] as const) {
    it(`stored acceptance finalizes locally with ${state} current state and does not resurrect terminal charges`, async () => {
      const a = await fixture(`receipt-${state}`);
      const row = await prepare(a);
      if (state !== "APPROVED") await prisma.rentalExtraCharge.update({ where: { id: a.extra.id }, data: { status: state } });
      const acceptedAt = new Date("2026-01-01T00:00:00.000Z").toISOString();
      await prisma.emailQueue.update({ where: { id: row.id }, data: { meta: {
        ...(row.meta as Record<string, unknown>), emailProvider: "resend", providerMessageId: `synthetic-stored-extra-${state}`, providerAcceptedAt: acceptedAt
      } } });
      await prisma.tenant.update({ where: { id: a.tenant.id }, data: { isActive: false } });
      let sends = 0;
      emailSender.send = async () => { sends += 1; throw new Error("receipt recovery must not invoke provider"); };
      await queue.processPending(new Date(), { ids: [row.id] });
      assert.equal(sends, 0);
      assert.equal((await prisma.emailQueue.findUniqueOrThrow({ where: { id: row.id } })).status, "SENT");
      assert.equal((await charge(a)).status, state === "APPROVED" ? "NOTIFIED" : state);
      assert.equal((await charge(a)).notifiedAt?.toISOString(), acceptedAt);
      assert.equal(await notifiedAudits(a), 1);
    });
  }

  for (const metadata of ["missing-tenant", "foreign-tenant", "missing-extra", "foreign-extra", "mismatched-booking", "wrong-type", "missing-hash", "wrong-version", "wrong-customer"] as const) {
    it(`extra notice dispatch rejects ${metadata} metadata before the provider`, async () => {
      const { a, b } = await pair();
      const row = await prepare(a);
      const meta = { ...(row.meta as Record<string, unknown>) };
      if (metadata === "missing-tenant") delete meta.tenantId;
      if (metadata === "foreign-tenant") meta.tenantId = b.tenant.id;
      if (metadata === "missing-extra") delete meta.extraChargeId;
      if (metadata === "foreign-extra") meta.extraChargeId = b.extra.id;
      if (metadata === "mismatched-booking") meta.bookingId = b.booking.id;
      if (metadata === "wrong-type") meta.type = "FINE";
      if (metadata === "missing-hash") delete meta.contextHash;
      if (metadata === "wrong-version") meta.contextVersion = 2;
      if (metadata === "wrong-customer") meta.rentalCustomerId = b.customer.id;
      await prisma.emailQueue.update({ where: { id: row.id }, data: { meta } });
      let sends = 0;
      emailSender.send = async () => { sends += 1; return { provider: "resend", id: "synthetic-must-not-send" }; };
      await queue.processPending(new Date(), { ids: [row.id] });
      assert.equal(sends, 0);
      await assertBlocked(row.id);
      assert.equal(await notifiedAudits(a), 0);
    });
  }

  it("an unrelated extra charge timestamp change does not invalidate the prepared notice", async () => {
    const a = await fixture("unrelated-update");
    const row = await prepare(a);
    let sends = 0;
    emailSender.send = async () => { sends += 1; return { provider: "resend", id: "synthetic-unrelated-update" }; };
    await afterClaim(row.id, async () => {
      await prisma.rentalExtraCharge.update({ where: { id: a.extra.id }, data: { failureReason: "Synthetic operational annotation" } });
    }, () => queue.processPending(new Date(), { ids: [row.id] }));
    assert.equal(sends, 1, "the fingerprint must compare notice context rather than arbitrary updatedAt values");
    assert.equal((await prisma.emailQueue.findUniqueOrThrow({ where: { id: row.id } })).status, "SENT");
    assert.equal((await charge(a)).status, "NOTIFIED");
    assert.equal(await notifiedAudits(a), 1);
  });

  it("an optional absent extra vehicle pointer preserves a valid owned booking notice", async () => {
    const a = await fixture("nullable-extra-vehicle");
    await prisma.rentalExtraCharge.update({ where: { id: a.extra.id }, data: { vehicleId: null } });
    const row = await prepare(a);
    let sends = 0;
    emailSender.send = async () => { sends += 1; return { provider: "resend", id: "synthetic-null-extra-vehicle" }; };
    await queue.processPending(new Date(), { ids: [row.id] });
    assert.equal(sends, 1);
    assert.equal((await charge(a)).status, "NOTIFIED");
    assert.equal(await notifiedAudits(a), 1);
  });

  it("a verified NOTIFIED charge returns its existing command without a second audit or provider send", async () => {
    const a = await fixture("verified-notified-retry");
    const row = await prepare(a);
    let sends = 0;
    emailSender.send = async () => { sends += 1; return { provider: "resend", id: "synthetic-verified-notified" }; };
    await queue.processPending(new Date(), { ids: [row.id] });
    const before = await snapshot();
    await service().notifyExtraCharge(input(a));
    assert.equal(await snapshot(), before);
    assert.equal((await queued(a))[0]?.id, row.id);
    assert.equal(sends, 1);
  });

  it("a failed notice command remains terminal when public notify is repeated", async () => {
    const a = await fixture("terminal-command-retry");
    const row = await prepare(a);
    await prisma.emailQueue.update({ where: { id: row.id }, data: { maxAttempts: 1 } });
    let sends = 0;
    emailSender.send = async () => { sends += 1; throw new Error("Synthetic permanent provider rejection"); };
    await queue.processPending(new Date(), { ids: [row.id] });
    const failed = await prisma.emailQueue.findUniqueOrThrow({ where: { id: row.id } });
    assert.equal(failed.status, "FAILED");
    const before = await snapshot();
    try { await service().notifyExtraCharge(input(a)); }
    catch (error) {
      assert.ok(error instanceof Error);
      assert.ok((error as any).statusCode >= 400 && (error as any).statusCode < 500);
    }
    assert.equal(await snapshot(), before, "a public retry must not reopen or recreate a failed command");
    assert.equal(sends, 1);
    assert.equal((await charge(a)).status, "APPROVED");
    assert.equal(await notifiedAudits(a), 0);
  });

  for (const state of ["FAILED", "SENT"] as const) {
    it(`a ${state} command whose payload was purged cannot become a second logical notice`, async () => {
      const a = await fixture(`purged-${state}`);
      const row = await prepare(a);
      await prisma.emailQueue.update({ where: { id: row.id }, data: {
        status: state, deduplicationKey: null, recipient: "[purged]", subject: "[purged]", body: "[purged]", payloadPurgedAt: new Date()
      } });
      await prisma.$executeRaw`UPDATE "EmailQueue" SET "meta" = NULL WHERE "id" = ${row.id}`;
      const before = await snapshot();
      let sends = 0;
      emailSender.send = async () => { sends += 1; throw new Error("purged command retry must not dispatch"); };
      try { await service().notifyExtraCharge(input(a)); }
      catch (error) {
        assert.ok(error instanceof Error);
        assert.ok((error as any).statusCode >= 400 && (error as any).statusCode < 500);
      }
      assert.equal(await snapshot(), before, "the persistent queued audit must preserve one-command ownership after payload purge");
      assert.equal((await queued(a)).length, 1);
      assert.equal((await queued(a))[0]?.id, row.id);
      assert.equal(sends, 0);
    });
  }

  it("a legacy accepted receipt finalizes only its queue and never invents verified domain notification", async () => {
    const a = await fixture("legacy-receipt");
    const row = await queue.enqueue({
      tenantId: a.tenant.id, type: "RENTAL_EXTRA_CHARGE_NOTICE", recipient: a.customer.email!, subject: "Synthetic legacy notice", body: "Synthetic legacy body",
      meta: { bookingId: a.booking.id, extraChargeId: a.extra.id, type: a.extra.type,
        emailProvider: "resend", providerMessageId: "synthetic-legacy-accepted", providerAcceptedAt: "2026-01-01T00:00:00.000Z" }
    });
    directQueueIds.push(row.id);
    let sends = 0;
    emailSender.send = async () => { sends += 1; throw new Error("legacy accepted receipt must never be resent"); };
    await queue.processPending(new Date(), { ids: [row.id] });
    assert.equal(sends, 0);
    assert.equal((await prisma.emailQueue.findUniqueOrThrow({ where: { id: row.id } })).status, "SENT");
    assert.equal((await charge(a)).status, "APPROVED");
    assert.equal((await charge(a)).notifiedAt, null);
    assert.equal(await notifiedAudits(a), 0);
  });

  it("privacy anonymization and a legacy-license notice acquire tenant/booking locks without a deadlock", { timeout: 15_000 }, async () => {
    const a = await fixture("privacy-license-lock-order");
    await prisma.tenantSubscription.delete({ where: { id: a.subscription.id } });
    await prisma.auditLog.create({ data: {
      tenantId: a.tenant.id, action: "PLATFORM_LICENSE_UPDATED", resource: "tenant", resourceId: a.tenant.id,
      details: { after: { plan: "STARTER", status: "ACTIVE", seats: 3, expiresAt: null } }
    } });
    const bookingLocked = deferred();
    const resumePrivacy = deferred();
    const savedTransaction = prisma.$transaction;
    const transact = savedTransaction.bind(prisma);
    const bookingDelegate = prisma.rentalBooking;
    const savedBookingFind = bookingDelegate.findFirst;
    const bookingFind = savedBookingFind.bind(bookingDelegate);
    let privacyHoldingBooking = false;
    let privacyTenantFirst = false;
    let noticeTransactionStarted = false;
    let lockHandoffObserved = false;
    let privacyPid: number | undefined;
    let noticePid: number | undefined;
    type Outcome = { ok: true; value: unknown } | { ok: false; error: any };
    const settle = (work: Promise<unknown>): Promise<Outcome> => work.then((value) => ({ ok: true, value }), (error: any) => ({ ok: false, error }));
    let anonymizing: Promise<Outcome> | undefined;
    let notifying: Promise<Outcome> | undefined;
    const queryText = (query: any) => Array.isArray(query) ? query.join(" ") : String(query?.sql ?? query?.text ?? query ?? "");
    (prisma as any).$transaction = (work: any, options?: any) => {
      if (typeof work !== "function") return (transact as any)(work, options);
      const isNotice = privacyHoldingBooking;
      if (isNotice) noticeTransactionStarted = true;
      return (transact as any)(async (tx: any) => {
        let tenantKeyShare = false;
        const raw = tx.$queryRaw.bind(tx);
        const unsafe = tx.$queryRawUnsafe.bind(tx);
        const backend = await raw`SELECT pg_backend_pid() AS pid`;
        if (isNotice) noticePid = Number(backend[0].pid);
        else privacyPid = Number(backend[0].pid);
        const execute = async (original: (...args: any[]) => Promise<any>, args: any[]) => {
          const sql = queryText(args[0]);
          const tenantQuery = /\bFROM\s+"?Tenant"?(?=\s|$)/i.test(sql);
          const tenantUpdate = tenantQuery && /FOR\s+UPDATE/i.test(sql);
          if (tenantUpdate && privacyHoldingBooking && privacyTenantFirst) {
            // A privacy Tenant KEY SHARE acquired before Booking serializes the
            // notice before its Tenant UPDATE; release without a synthetic cycle.
            lockHandoffObserved = true;
            resumePrivacy.resolve();
          }
          const result = await original(...args);
          if (tenantQuery && /FOR\s+KEY\s+SHARE/i.test(sql)) tenantKeyShare = true;
          if (tenantUpdate && privacyHoldingBooking && !privacyTenantFirst) {
            // The notice now owns the real Tenant UPDATE lock. Releasing the
            // old Booking-first privacy transaction exposes its real FK cycle.
            lockHandoffObserved = true;
            resumePrivacy.resolve();
          }
          return result;
        };
        const delegate = tx.rentalBooking;
        const update = delegate.updateMany.bind(delegate);
        const pauseBookingUpdate = async (args: any) => {
          const result = await update(args);
          if (args.where?.customerId === a.customer.id && args.data?.customerEmail === null && !privacyHoldingBooking) {
            privacyTenantFirst = tenantKeyShare;
            privacyHoldingBooking = true;
            bookingLocked.resolve();
            await resumePrivacy.promise;
          }
          return result;
        };
        const observedBookings = new Proxy(delegate, {
          get(target, key) { return key === "updateMany" ? pauseBookingUpdate : Reflect.get(target, key, target); }
        });
        // Prisma transaction clients share the raw client target. Assigning to
        // tx.$queryRaw would leak the first transaction's bound method into the
        // second transaction and erase the lock cycle we are trying to observe.
        const observedTx = new Proxy(tx, {
          get(target, key) {
            if (key === "$queryRaw") return (...args: any[]) => execute(raw, args);
            if (key === "$queryRawUnsafe") return (...args: any[]) => execute(unsafe, args);
            if (key === "rentalBooking") return observedBookings;
            return Reflect.get(target, key, target);
          }
        });
        return work(observedTx);
      }, options);
    };
    (bookingDelegate as any).findFirst = async (args: any) => {
      if (privacyHoldingBooking && !noticeTransactionStarted && args.where?.id === a.booking.id) {
        // Baseline producer uses a plain read and has no tenant transaction:
        // release privacy rather than manufacturing an unrelated timeout.
        lockHandoffObserved = true;
        resumePrivacy.resolve();
      }
      return bookingFind(args);
    };
    let sends = 0;
    emailSender.send = async () => { sends += 1; throw new Error("producer/ privacy operations must not dispatch"); };
    try {
      anonymizing = settle(new PrivacyComplianceService().anonymizeCustomer({
        tenantId: a.tenant.id, userId: a.user.id, customerId: a.customer.id,
        confirmation: "ANONYMIZE_CUSTOMER", legalBasis: "Synthetic lock-order regression fixture", deleteAttachments: false
      }));
      await waitBounded(bookingLocked.promise, "privacy holding its real Booking row lock");
      notifying = settle(service().notifyExtraCharge(input(a)));
      const [privacy, notice] = await waitBounded(Promise.all([anonymizing, notifying]), "privacy and notice settlements", 9000);
      assert.equal(lockHandoffObserved, true, "the real notice must reach the coordinated tenant or baseline booking lookup");
      if (noticeTransactionStarted) {
        assert.ok(privacyPid && noticePid);
        assert.notEqual(privacyPid, noticePid, "concurrent authorization must use distinct real PostgreSQL transactions");
      }
      assert.ok(privacy.ok, privacy.ok ? "" : `privacy database failure: ${privacy.error.code ?? "unknown"} ${privacy.error.message}`);
      if (!notice.ok) {
        assert.ok(notice.error.statusCode >= 400 && notice.error.statusCode < 500,
          `unexpected notice database failure: ${notice.error.code ?? "unknown"} ${notice.error.message}`);
      }
      const customer = await prisma.rentalCustomer.findUniqueOrThrow({ where: { id: a.customer.id } });
      assert.equal(customer.email, null);
      assert.ok(customer.deletedAt);
      assert.equal(sends, 0);
    } finally {
      resumePrivacy.resolve();
      (prisma as any).$transaction = savedTransaction;
      (bookingDelegate as any).findFirst = savedBookingFind;
      if (anonymizing) await anonymizing;
      if (notifying) await notifying;
    }
  });

  it("license expiry while waiting for later authorization locks blocks provider initiation", { timeout: 10_000 }, async () => {
    const a = await fixture("license-expiry-after-check");
    const row = await prepare(a);
    const expiresAt = new Date(Date.now() + 1200);
    await prisma.tenantSubscription.update({ where: { tenantId: a.tenant.id }, data: { currentPeriodEnd: expiresAt } });
    const savedTransaction = prisma.$transaction;
    const transact = savedTransaction.bind(prisma);
    let paused = false;
    let sends = 0;
    emailSender.send = async () => { sends += 1; return { provider: "resend", id: "synthetic-expired-license-must-not-send" }; };
    (prisma as any).$transaction = (work: any, options?: any) => {
      if (typeof work !== "function") return (transact as any)(work, options);
      return (transact as any)(async (tx: any) => {
        const raw = tx.$queryRaw.bind(tx);
        const pauseBeforeExtra = async (...args: any[]) => {
          const sql = Array.isArray(args[0]) ? args[0].join(" ") : String(args[0]?.sql ?? args[0]?.text ?? "");
          if (!paused && /\bFROM\s+"?RentalExtraCharge"?(?=\s|$)/i.test(sql) && /FOR\s+UPDATE/i.test(sql)) {
            paused = true;
            assert.ok(Date.now() < expiresAt.getTime(), "the persisted license must still be valid when the first check finishes");
            // Pause after the real license check, before the subsequent real
            // Extra/Vehicle/Booking locks. Time is part of license eligibility.
            await new Promise((resolve) => { setTimeout(resolve, Math.max(0, expiresAt.getTime() - Date.now()) + 30); });
          }
          return raw(...args);
        };
        return work(new Proxy(tx, {
          get(target, key) { return key === "$queryRaw" ? pauseBeforeExtra : Reflect.get(target, key, target); }
        }));
      }, options);
    };
    try {
      await queue.processPending(new Date(), { ids: [row.id] });
      assert.equal(paused, true, "dispatch must pass the real initial license evaluation before the expiry pause");
      assert.equal(sends, 0, "a license that expired during authorization cannot authorize a later provider start");
      await assertBlocked(row.id);
      assert.equal((await charge(a)).status, "APPROVED");
      assert.equal((await charge(a)).notifiedAt, null);
      assert.equal(await notifiedAudits(a), 0);
    } finally { (prisma as any).$transaction = savedTransaction; }
  });

  for (const field of ["html", "replyTo", "fromName", "attachments"] as const) {
    it(`an unbound ${field} delivery field cannot alter a verified extra notice`, async () => {
      const a = await fixture(`unsafe-${field}`);
      const row = await prepare(a);
      const value = field === "html" ? "<p>Synthetic alternate content</p>"
        : field === "replyTo" ? "alternate-reply@example.test"
          : field === "fromName" ? "Synthetic alternate sender"
            : [{ filename: "synthetic.txt", contentBase64: "U1lOVEhFVElD", contentType: "text/plain" }];
      await prisma.emailQueue.update({ where: { id: row.id }, data: { meta: { ...(row.meta as Record<string, unknown>), [field]: value } } });
      let sends = 0;
      emailSender.send = async () => { sends += 1; return { provider: "resend", id: "synthetic-unsafe-delivery-must-not-send" }; };
      await queue.processPending(new Date(), { ids: [row.id] });
      assert.equal(sends, 0);
      await assertBlocked(row.id);
      assert.equal((await charge(a)).notifiedAt, null);
      assert.equal(await notifiedAudits(a), 0);
    });
  }

  for (const state of ["NONE", "PENDING", "SENT", "FAILED", "BLOCKED", "LEGACY_UNVERIFIED"] as const) {
    it(`booking payment summary exposes ${state} notice state with a receipt-backed date only`, async () => {
      const a = await fixture(`summary-${state}`);
      let sends = 0;
      if (state === "LEGACY_UNVERIFIED") {
        await prisma.rentalExtraCharge.update({ where: { id: a.extra.id }, data: { status: "NOTIFIED", notifiedAt: new Date("2026-01-01T00:00:00.000Z") } });
      } else if (state !== "NONE") {
        const row = await prepare(a);
        if (state === "SENT") {
          emailSender.send = async () => { sends += 1; return { provider: "resend", id: "synthetic-summary-accepted" }; };
          await queue.processPending(new Date(), { ids: [row.id] });
        }
        if (state === "FAILED") {
          await prisma.emailQueue.update({ where: { id: row.id }, data: { maxAttempts: 1 } });
          emailSender.send = async () => { sends += 1; throw new Error("Synthetic terminal summary failure"); };
          await queue.processPending(new Date(), { ids: [row.id] });
        }
        if (state === "BLOCKED") {
          await prisma.tenant.update({ where: { id: a.tenant.id }, data: { isActive: false } });
          emailSender.send = async () => { sends += 1; throw new Error("blocked summary must not dispatch"); };
          await queue.processPending(new Date(), { ids: [row.id] });
        }
      }
      const summary = await service().getBookingPaymentSummary(a.tenant.id, a.booking.id);
      const exposed = summary.extraCharges.find((item) => item.id === a.extra.id) as any;
      assert.ok(exposed);
      assert.equal(exposed.notificationStatus, state);
      if (state === "SENT") {
        assert.ok(exposed.notifiedAt instanceof Date);
        assert.equal(exposed.notifiedAt.toISOString(), (await charge(a)).notifiedAt?.toISOString());
        assert.equal(sends, 1);
      } else {
        assert.equal(exposed.notifiedAt, null, "an unverified legacy timestamp must not appear as accepted delivery");
        assert.equal(sends, state === "FAILED" ? 1 : 0);
      }
    });
  }

  it("provider acceptance without a message ID never creates a verified notification date", async () => {
    const a = await fixture("null-provider-id");
    const row = await prepare(a);
    let sends = 0;
    emailSender.send = async () => { sends += 1; return { provider: "resend", id: null }; };
    await queue.processPending(new Date(), { ids: [row.id] });
    assert.equal(sends, 1);
    assert.equal((await charge(a)).status, "APPROVED");
    assert.equal((await charge(a)).notifiedAt, null);
    assert.equal(await notifiedAudits(a), 0);
    const summary = await service().getBookingPaymentSummary(a.tenant.id, a.booking.id);
    const exposed = summary.extraCharges.find((item) => item.id === a.extra.id) as any;
    assert.equal(exposed.notificationStatus, "LEGACY_UNVERIFIED");
    assert.equal(exposed.notifiedAt, null);
  });

  for (const stored of ["unknown-provider", "null-provider-id"] as const) {
    it(`an ${stored} stored receipt cannot bypass actual provider acceptance`, async () => {
      const a = await fixture(`stored-${stored}`);
      const row = await prepare(a);
      await prisma.emailQueue.update({ where: { id: row.id }, data: { meta: {
        ...(row.meta as Record<string, unknown>), emailProvider: stored === "unknown-provider" ? "synthetic-unknown" : "resend",
        providerMessageId: stored === "null-provider-id" ? null : "synthetic-untrusted-stored-id", providerAcceptedAt: "2026-01-01T00:00:00.000Z"
      } } });
      let sends = 0;
      emailSender.send = async () => { sends += 1; return { provider: "resend", id: "synthetic-new-verified-acceptance" }; };
      await queue.processPending(new Date(), { ids: [row.id] });
      assert.equal(sends, 1, "only a valid provider/message receipt may avoid provider initiation");
      assert.equal((await charge(a)).status, "NOTIFIED");
      assert.notEqual((await charge(a)).notifiedAt?.toISOString(), "2026-01-01T00:00:00.000Z");
      assert.equal(await notifiedAudits(a), 1);
      const current = await prisma.emailQueue.findUniqueOrThrow({ where: { id: row.id } });
      assert.equal((current.meta as any).emailProvider, "resend");
      assert.equal((current.meta as any).providerMessageId, "synthetic-new-verified-acceptance");
    });
  }

  it("a blank provider message ID cannot become a verified notification receipt", async () => {
    const a = await fixture("blank-provider-id");
    const row = await prepare(a);
    let sends = 0;
    emailSender.send = async () => { sends += 1; return { provider: "resend", id: "   " }; };
    await queue.processPending(new Date(), { ids: [row.id] });
    assert.equal(sends, 1);
    assert.equal((await charge(a)).status, "APPROVED");
    assert.equal((await charge(a)).notifiedAt, null);
    assert.equal(await notifiedAudits(a), 0);
    const summary = await service().getBookingPaymentSummary(a.tenant.id, a.booking.id);
    const exposed = summary.extraCharges.find((item) => item.id === a.extra.id) as any;
    assert.equal(exposed.notificationStatus, "LEGACY_UNVERIFIED");
    assert.equal(exposed.notifiedAt, null);
  });

  it("an untrusted stored timestamp cannot suppress a subsequent valid provider receipt", async () => {
    const a = await fixture("invalid-untrusted-receipt-time");
    const row = await prepare(a);
    await prisma.emailQueue.update({ where: { id: row.id }, data: { meta: {
      ...(row.meta as Record<string, unknown>), emailProvider: "synthetic-unknown", providerMessageId: "synthetic-untrusted-id", providerAcceptedAt: "synthetic-invalid-timestamp"
    } } });
    let sends = 0;
    emailSender.send = async () => { sends += 1; return { provider: "resend", id: "synthetic-valid-new-receipt" }; };
    await queue.processPending(new Date(), { ids: [row.id] });
    assert.equal(sends, 1);
    assert.equal((await charge(a)).status, "NOTIFIED");
    assert.ok((await charge(a)).notifiedAt);
    assert.equal(await notifiedAudits(a), 1);
    const current = await prisma.emailQueue.findUniqueOrThrow({ where: { id: row.id } });
    assert.equal(current.status, "SENT");
    assert.equal((current.meta as any).providerMessageId, "synthetic-valid-new-receipt");
    assert.ok(Number.isFinite(Date.parse((current.meta as any).providerAcceptedAt)));
  });
});
