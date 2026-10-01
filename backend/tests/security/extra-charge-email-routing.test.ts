import assert from "node:assert/strict";
import { after, afterEach, before, describe, it } from "node:test";
import { prisma } from "../../src/infrastructure/database/prisma/client.js";
import { EmailQueueService } from "../../src/infrastructure/email/email-queue-service.js";
import { emailSender } from "../../src/infrastructure/email/email-sender.js";
import { RentalPaymentService } from "../../src/application/services/rental-payment-service.js";
import { PrismaAuditLogRepository } from "../../src/infrastructure/repositories/prisma-audit-log-repository.js";

const runId = `extra-email-routing-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const tenantIds: string[] = [];
const queueIds: string[] = [];
const originalSend = emailSender.send;
const queue = new EmailQueueService();
const payments = new RentalPaymentService(new PrismaAuditLogRepository(), null, {}, queue);
let sequence = 0;

const fixture = async (suffix: string) => {
  const label = `${suffix}-${sequence++}`;
  const tenant = await prisma.tenant.create({ data: { id: `${runId}-${label}`, name: `Synthetic routing ${label}` } });
  tenantIds.push(tenant.id);
  await prisma.tenantSubscription.create({ data: { tenantId: tenant.id, provider: "local", plan: "STARTER", status: "ACTIVE" } });
  const user = await prisma.user.create({ data: {
    tenantId: tenant.id, email: `${label}@example.test`, passwordHash: "synthetic-unused-hash",
    firstName: "Synthetic", lastName: "Routing"
  } });
  const site = await prisma.site.create({ data: { tenantId: tenant.id, name: "Synthetic Site", address: "Synthetic Address", city: "TestCity" } });
  const vehicle = await prisma.vehicle.create({ data: { tenantId: tenant.id, siteId: site.id, plate: `ROUTE-${sequence}`, brand: "Synthetic", model: "Vehicle" } });
  const workshop = await prisma.workshop.create({ data: { tenantId: tenant.id, name: "Synthetic Workshop", email: `${label}-workshop@example.test` } });
  const stoppage = await prisma.stoppage.create({ data: {
    tenantId: tenant.id, siteId: site.id, vehicleId: vehicle.id, workshopId: workshop.id,
    createdByUserId: user.id, reason: "Synthetic routing fixture", openedAt: new Date(),
    workshopEmailSnapshot: workshop.email
  } });
  const customer = await prisma.rentalCustomer.create({ data: {
    tenantId: tenant.id, firstName: "Synthetic", lastName: "Customer", email: `${label}-customer@example.test`
  } });
  const booking = await prisma.rentalBooking.create({ data: {
    tenantId: tenant.id, vehicleId: vehicle.id, customerId: customer.id, code: `ROUTE-${label}`,
    customerName: "Synthetic Customer", pickupAt: new Date("2030-01-01T00:00:00.000Z"), returnAt: new Date("2030-01-02T00:00:00.000Z")
  } });
  const extraCharge = await prisma.rentalExtraCharge.create({ data: {
    tenantId: tenant.id, bookingId: booking.id, rentalCustomerId: customer.id, vehicleId: vehicle.id,
    type: "DAMAGE", description: "Synthetic approved extra charge", amountCents: 10_000,
    adminFeeCents: 500, totalAmountCents: 10_500, currency: "EUR", status: "APPROVED",
    createdByUserId: user.id, approvedByUserId: user.id
  } });
  const contract = await prisma.bookingContract.create({ data: {
    tenantId: tenant.id, bookingId: booking.id, title: "Synthetic contract", content: "Synthetic contract content", status: "READY"
  } });
  const contractDelivery = await prisma.bookingContractDelivery.create({ data: {
    tenantId: tenant.id, bookingId: booking.id, contractId: contract.id,
    recipient: `${label}@example.test`, subject: "Synthetic contract", body: "Synthetic contract body"
  } });
  const invoice = await prisma.invoice.create({ data: {
    tenantId: tenant.id, invoiceNumber: `ROUTE-${runId}-${label}`,
    issueDate: new Date("2030-01-01T00:00:00.000Z"), dueDate: new Date("2030-01-31T00:00:00.000Z"),
    periodStart: new Date("2029-12-01T00:00:00.000Z"), periodEnd: new Date("2029-12-31T00:00:00.000Z"),
    subtotal: 100, taxRate: 22, taxAmount: 22, total: 122, billingName: "Synthetic Billing"
  } });
  const invoiceDelivery = await prisma.invoiceDelivery.create({ data: { invoiceId: invoice.id, recipient: `${label}@example.test` } });
  return { tenant, user, stoppage, booking, extraCharge, contract, contractDelivery, invoice, invoiceDelivery, workshop };
};
type Fixture = Awaited<ReturnType<typeof fixture>>;

const contractMeta = (data: Fixture): Record<string, unknown> => ({
  tenantId: data.tenant.id, bookingId: data.booking.id, contractId: data.contract.id, contractDeliveryId: data.contractDelivery.id
});
const invoiceMeta = (data: Fixture): Record<string, unknown> => ({
  tenantId: data.tenant.id, invoiceId: data.invoice.id, invoiceDeliveryId: data.invoiceDelivery.id
});
const reminderMeta = (data: Fixture): Record<string, unknown> => ({
  tenantId: data.tenant.id, stoppageId: data.stoppage.id, reminderType: "MANUAL"
});
const legacyExtraMeta = (data: Fixture): Record<string, unknown> => ({
  bookingId: data.booking.id, extraChargeId: data.extraCharge.id, type: "DAMAGE"
});

const enqueue = async (data: Fixture, type: string, meta: Record<string, unknown>, options: { noQueueTenant?: boolean; maxAttempts?: number } = {}) => {
  const row = await queue.enqueue({
    tenantId: options.noQueueTenant ? undefined : data.tenant.id, type,
    recipient: data.workshop.email!, subject: "Synthetic routing email", body: "Synthetic routing body", meta
  });
  queueIds.push(row.id);
  if (options.maxAttempts) await prisma.emailQueue.update({ where: { id: row.id }, data: { maxAttempts: options.maxAttempts } });
  return row;
};

const enqueueApprovedExtraNotice = async (
  data: Fixture, additionalMeta: Record<string, unknown> = {}, maxAttempts?: number
) => {
  await payments.notifyExtraCharge({ tenantId: data.tenant.id, extraChargeId: data.extraCharge.id, userId: data.user.id });
  const row = await prisma.emailQueue.findFirstOrThrow({ where: {
    tenantId: data.tenant.id, type: "RENTAL_EXTRA_CHARGE_NOTICE",
    meta: { path: ["extraChargeId"], equals: data.extraCharge.id }
  } });
  queueIds.push(row.id);
  return prisma.emailQueue.update({ where: { id: row.id }, data: {
    ...(Object.keys(additionalMeta).length ? { meta: { ...row.meta as Record<string, unknown>, ...additionalMeta } } : {}),
    ...(maxAttempts ? { maxAttempts } : {})
  } });
};

const assertExtraPending = async (data: Fixture) => {
  const extra = await prisma.rentalExtraCharge.findUniqueOrThrow({ where: { id: data.extraCharge.id } });
  assert.equal(extra.status, "APPROVED");
  assert.equal(extra.notifiedAt, null);
};

const assertExtraAccepted = async (data: Fixture, itemId: string) => {
  const [extra, item] = await Promise.all([
    prisma.rentalExtraCharge.findUniqueOrThrow({ where: { id: data.extraCharge.id } }),
    prisma.emailQueue.findUniqueOrThrow({ where: { id: itemId } })
  ]);
  assert.equal(extra.status, "NOTIFIED");
  assert.ok(extra.notifiedAt);
  assert.equal(extra.notifiedAt.toISOString(), (item.meta as Record<string, unknown>).providerAcceptedAt);
  assert.equal(await prisma.auditLog.count({ where: {
    tenantId: data.tenant.id, resource: "rental-extra-charge", resourceId: extra.id,
    action: "RENTAL_EXTRA_CHARGE_NOTIFIED"
  } }), 1);
};

const assertDomainUnchanged = async (data: Fixture) => {
  const contract = await prisma.bookingContract.findUniqueOrThrow({ where: { id: data.contract.id } });
  assert.equal(contract.status, "READY");
  assert.equal(contract.lastSentAt, null);
  assert.equal(contract.emailTo, null);
  assert.equal(contract.errorMessage, null);
  const contractDelivery = await prisma.bookingContractDelivery.findUniqueOrThrow({ where: { id: data.contractDelivery.id } });
  assert.equal(contractDelivery.status, "PENDING");
  assert.equal(contractDelivery.sentAt, null);
  assert.equal(contractDelivery.errorMessage, null);
  assert.equal(await prisma.bookingContractEvent.count({ where: { contractId: data.contract.id } }), 0);
  const invoice = await prisma.invoice.findUniqueOrThrow({ where: { id: data.invoice.id } });
  assert.equal(invoice.status, "GENERATED");
  assert.equal(invoice.sentAt, null);
  const invoiceDelivery = await prisma.invoiceDelivery.findUniqueOrThrow({ where: { id: data.invoiceDelivery.id } });
  assert.equal(invoiceDelivery.status, "PENDING");
  assert.equal(invoiceDelivery.sentAt, null);
  assert.equal(invoiceDelivery.errorMessage, null);
  assert.equal(invoiceDelivery.providerMessageId, null);
  const stoppage = await prisma.stoppage.findUniqueOrThrow({ where: { id: data.stoppage.id } });
  assert.equal(stoppage.status, "OPEN");
  assert.equal(stoppage.totalRemindersSent, 0);
  assert.equal(stoppage.lastReminderSentAt, null);
  assert.equal(await prisma.reminder.count({ where: { stoppageId: data.stoppage.id } }), 0);
};

describe("email queue dispatch and domain finalization follow the declared type", () => {
  before(async () => { await prisma.$connect(); });
  afterEach(async () => {
    emailSender.send = originalSend;
    const owned = { in: tenantIds };
    await prisma.emailQueue.deleteMany({ where: { id: { in: queueIds.splice(0) } } });
    await prisma.bookingContractEvent.deleteMany({ where: { tenantId: owned } });
    await prisma.bookingContractDelivery.deleteMany({ where: { tenantId: owned } });
    await prisma.bookingContract.deleteMany({ where: { tenantId: owned } });
    await prisma.invoiceDelivery.deleteMany({ where: { invoice: { tenantId: owned } } });
    await prisma.invoice.deleteMany({ where: { tenantId: owned } });
    await prisma.rentalExtraCharge.deleteMany({ where: { tenantId: owned } });
    await prisma.rentalBooking.deleteMany({ where: { tenantId: owned } });
    await prisma.rentalCustomer.deleteMany({ where: { tenantId: owned } });
    await prisma.reminder.deleteMany({ where: { tenantId: owned } });
    await prisma.stoppage.deleteMany({ where: { tenantId: owned } });
    await prisma.vehicle.deleteMany({ where: { tenantId: owned } });
    await prisma.workshop.deleteMany({ where: { tenantId: owned } });
    await prisma.site.deleteMany({ where: { tenantId: owned } });
    await prisma.user.deleteMany({ where: { tenantId: owned } });
    await prisma.auditLog.deleteMany({ where: { tenantId: owned } });
    await prisma.tenantSubscription.deleteMany({ where: { tenantId: owned } });
    await prisma.tenant.deleteMany({ where: { id: { in: tenantIds.splice(0) } } });
  });
  after(async () => { await prisma.$disconnect(); });

  it("delivers an approved canonical extra-charge notice without touching other domains", async () => {
    const data = await fixture("extra-approved");
    const item = await enqueueApprovedExtraNotice(data);
    await assertExtraPending(data);
    const sentKeys: string[] = [];
    emailSender.send = async (input) => { sentKeys.push(String(input.idempotencyKey)); return { provider: "resend", id: "synthetic-extra-message" }; };
    await queue.processPending(new Date(), { ids: [item.id] });
    assert.deepEqual(sentKeys, [`fleetum-email-queue:${item.id}`]);
    const persisted = await prisma.emailQueue.findUniqueOrThrow({ where: { id: item.id } });
    assert.equal(persisted.status, "SENT");
    assert.equal(persisted.attempts, 1);
    assert.equal(persisted.lastError, null);
    assert.equal(persisted.processingToken, null);
    assert.equal(persisted.leaseExpiresAt, null);
    await assertExtraAccepted(data, item.id);
    await assertDomainUnchanged(data);
  });

  it("backs off an extra-charge provider failure and retries the same row with the same idempotency key", async () => {
    const data = await fixture("extra-retry");
    const item = await enqueueApprovedExtraNotice(data);
    const sentKeys: string[] = [];
    emailSender.send = async (input) => {
      sentKeys.push(String(input.idempotencyKey));
      if (sentKeys.length === 1) throw new Error("synthetic extra provider outage");
      return { provider: "resend", id: "synthetic-extra-recovered" };
    };
    const firstAttemptAt = new Date();
    await queue.processPending(firstAttemptAt, { ids: [item.id] });
    const pending = await prisma.emailQueue.findUniqueOrThrow({ where: { id: item.id } });
    assert.equal(pending.status, "PENDING");
    assert.equal(pending.attempts, 1);
    assert.match(pending.lastError ?? "", /synthetic extra provider outage/);
    assert.ok(pending.nextAttemptAt.getTime() >= firstAttemptAt.getTime() + 2 * 60_000);
    assert.equal(pending.processingToken, null);
    await queue.processPending(firstAttemptAt, { ids: [item.id] });
    assert.equal(sentKeys.length, 1, "backoff must prevent early retry");
    await assertExtraPending(data);
    await assertDomainUnchanged(data);
    await prisma.emailQueue.update({ where: { id: item.id }, data: { nextAttemptAt: new Date(0) } });
    await queue.processPending(new Date(), { ids: [item.id] });
    assert.deepEqual(sentKeys, [`fleetum-email-queue:${item.id}`, `fleetum-email-queue:${item.id}`]);
    const completed = await prisma.emailQueue.findUniqueOrThrow({ where: { id: item.id } });
    assert.equal(completed.status, "SENT");
    assert.equal(completed.attempts, 2);
    await assertExtraAccepted(data, item.id);
    await assertDomainUnchanged(data);
  });

  it("finalizes an unverified legacy extra receipt without resending or mutating the extra", async () => {
    const data = await fixture("extra-receipt");
    const item = await enqueue(data, "RENTAL_EXTRA_CHARGE_NOTICE", {
      ...legacyExtraMeta(data), emailProvider: "resend", providerMessageId: "synthetic-stored-extra",
      providerAcceptedAt: new Date().toISOString()
    });
    let sends = 0;
    emailSender.send = async () => { sends += 1; throw new Error("stored receipt must not call provider"); };
    await queue.processPending(new Date(), { ids: [item.id] });
    assert.equal(sends, 0);
    const completed = await prisma.emailQueue.findUniqueOrThrow({ where: { id: item.id } });
    assert.equal(completed.status, "SENT");
    assert.ok((completed.meta as Record<string, unknown>).localFinalizationSkippedReason);
    await assertExtraPending(data);
    await assertDomainUnchanged(data);
  });

  it("finalizes a canonical extra notice with its stored provider receipt without sending again", async () => {
    const data = await fixture("extra-canonical-receipt");
    const item = await enqueueApprovedExtraNotice(data);
    const acceptedAt = new Date(Math.max(Date.now(), item.createdAt.getTime())).toISOString();
    await prisma.emailQueue.update({ where: { id: item.id }, data: { meta: {
      ...(item.meta as Record<string, unknown>),
      emailProvider: "resend", providerMessageId: "synthetic-stored-canonical-extra", providerAcceptedAt: acceptedAt
    } } });
    let sends = 0;
    emailSender.send = async () => { sends += 1; throw new Error("stored receipt must not call provider"); };
    await queue.processPending(new Date(), { ids: [item.id] });
    assert.equal(sends, 0);
    assert.equal((await prisma.emailQueue.findUniqueOrThrow({ where: { id: item.id } })).status, "SENT");
    await assertExtraAccepted(data, item.id);
    await assertDomainUnchanged(data);
  });

  for (const type of ["RENTAL_EXTRA_CHARGE_NOTICE", "SYNTHETIC_GENERIC_NOTICE"]) {
    for (const failure of [false, true]) {
      it(`${type} ignores complete contract, invoice and reminder metadata on ${failure ? "provider failure" : "success"}`, async () => {
        const data = await fixture(`overlap-${type}-${failure}`);
        const overlappingMeta = { ...contractMeta(data), ...invoiceMeta(data), ...reminderMeta(data) };
        const item = type === "RENTAL_EXTRA_CHARGE_NOTICE"
          ? await enqueueApprovedExtraNotice(data, overlappingMeta, 1)
          : await enqueue(data, type, overlappingMeta, { maxAttempts: 1 });
        let sends = 0;
        emailSender.send = async () => {
          sends += 1;
          if (failure) throw new Error("synthetic overlapping provider failure");
          return { provider: "resend", id: "synthetic-overlapping-message" };
        };
        await queue.processPending(new Date(), { ids: [item.id] });
        assert.equal(sends, 1);
        assert.equal((await prisma.emailQueue.findUniqueOrThrow({ where: { id: item.id } })).status, failure ? "FAILED" : "SENT");
        if (type === "RENTAL_EXTRA_CHARGE_NOTICE" && !failure) await assertExtraAccepted(data, item.id);
        else await assertExtraPending(data);
        await assertDomainUnchanged(data);
      });
    }
    it(`${type} ${type === "RENTAL_EXTRA_CHARGE_NOTICE" ? "blocks an unverified extra command" : "stays generic"} when only bookingId exists`, async () => {
      const data = await fixture(`partial-${type}`);
      const item = await enqueue(data, type, { bookingId: data.booking.id }, { noQueueTenant: true });
      let sends = 0;
      emailSender.send = async () => { sends += 1; return { provider: "resend", id: "synthetic-unbound-generic" }; };
      await queue.processPending(new Date(), { ids: [item.id] });
      assert.equal(sends, type === "RENTAL_EXTRA_CHARGE_NOTICE" ? 0 : 1);
      assert.equal((await prisma.emailQueue.findUniqueOrThrow({ where: { id: item.id } })).status,
        type === "RENTAL_EXTRA_CHARGE_NOTICE" ? "FAILED" : "SENT");
      await assertExtraPending(data);
      await assertDomainUnchanged(data);
    });
  }

  const sensitiveTypes = [
    { type: "BOOKING_CONTRACT", build: contractMeta, keys: ["bookingId", "contractId", "contractDeliveryId"] },
    { type: "SAAS_INVOICE_EMAIL", build: invoiceMeta, keys: ["invoiceId", "invoiceDeliveryId"] },
    { type: "REMINDER_EMAIL", build: reminderMeta, keys: ["stoppageId", "reminderType"] }
  ];
  for (const sensitive of sensitiveTypes) {
    const invalidCases = ["all-missing", "tenant-missing", "tenant-mismatch", "queue-tenant-missing", ...sensitive.keys.map((key) => `missing-${key}`)];
    for (const invalidCase of invalidCases) {
      it(`${sensitive.type} rejects ${invalidCase} before contacting the provider`, async () => {
        const data = await fixture(`invalid-${sensitive.type}-${invalidCase}`);
        const meta = invalidCase === "all-missing" ? {} : sensitive.build(data);
        if (invalidCase === "tenant-missing") delete meta.tenantId;
        if (invalidCase === "tenant-mismatch") meta.tenantId = `${runId}-foreign-tenant`;
        if (invalidCase.startsWith("missing-")) delete meta[invalidCase.slice("missing-".length)];
        const item = await enqueue(data, sensitive.type, meta, { noQueueTenant: invalidCase === "queue-tenant-missing" });
        let sends = 0;
        emailSender.send = async () => { sends += 1; return { provider: "resend", id: "invalid-sensitive-message" }; };
        await queue.processPending(new Date(), { ids: [item.id] });
        assert.equal(sends, 0, "sensitive queue types require all tenant-bound metadata before delivery");
        const persisted = await prisma.emailQueue.findUniqueOrThrow({ where: { id: item.id } });
        assert.notEqual(persisted.status, "SENT");
        assert.equal(persisted.processingToken, null);
        await assertDomainUnchanged(data);
      });
    }
    it(`${sensitive.type} rejects absent domain metadata while preserving an already stored provider receipt`, async () => {
      const data = await fixture(`invalid-receipt-${sensitive.type}`);
      const receipt = {
        emailProvider: "resend", providerMessageId: `synthetic-stored-invalid-${sensitive.type}`,
        providerAcceptedAt: new Date().toISOString()
      };
      const item = await enqueue(data, sensitive.type, receipt, { maxAttempts: 1 });
      let sends = 0;
      emailSender.send = async () => { sends += 1; throw new Error("malformed accepted command must not send again"); };
      await queue.processPending(new Date(), { ids: [item.id] });
      assert.equal(sends, 0);
      const persisted = await prisma.emailQueue.findUniqueOrThrow({ where: { id: item.id } });
      assert.equal(persisted.status, "FAILED");
      assert.equal(persisted.processingToken, null);
      assert.equal(persisted.leaseExpiresAt, null);
      const persistedMeta = (persisted.meta ?? {}) as Record<string, unknown>;
      assert.equal(persistedMeta.emailProvider, receipt.emailProvider);
      assert.equal(persistedMeta.providerMessageId, receipt.providerMessageId);
      assert.equal(persistedMeta.providerAcceptedAt, receipt.providerAcceptedAt);
      await assertDomainUnchanged(data);
    });
  }

  for (const sensitive of sensitiveTypes.filter((entry) => entry.type !== "REMINDER_EMAIL")) {
    for (const failure of [false, true]) {
      it(`valid ${sensitive.type} preserves tenant-scoped ${failure ? "terminal failure" : "success"} finalization`, async () => {
        const data = await fixture(`valid-${sensitive.type}-${failure}`);
        const item = await enqueue(data, sensitive.type, sensitive.build(data), { maxAttempts: 1 });
        let sends = 0;
        emailSender.send = async () => {
          sends += 1;
          if (failure) throw new Error("synthetic valid domain provider failure");
          return { provider: "resend", id: "synthetic-valid-domain-message" };
        };
        await queue.processPending(new Date(), { ids: [item.id] });
        assert.equal(sends, 1);
        assert.equal((await prisma.emailQueue.findUniqueOrThrow({ where: { id: item.id } })).status, failure ? "FAILED" : "SENT");
        if (sensitive.type === "BOOKING_CONTRACT") {
          assert.equal((await prisma.bookingContract.findUniqueOrThrow({ where: { id: data.contract.id } })).status, failure ? "ERROR" : "SENT");
          assert.equal((await prisma.bookingContractDelivery.findUniqueOrThrow({ where: { id: data.contractDelivery.id } })).status, failure ? "FAILED" : "SENT");
          assert.equal(await prisma.bookingContractEvent.count({ where: { contractId: data.contract.id, tenantId: data.tenant.id, type: failure ? "EMAIL_FAILED" : "EMAIL_SENT" } }), 1);
          assert.equal((await prisma.invoice.findUniqueOrThrow({ where: { id: data.invoice.id } })).status, "GENERATED");
        } else {
          assert.equal((await prisma.invoice.findUniqueOrThrow({ where: { id: data.invoice.id } })).status, failure ? "ERROR" : "SENT");
          const delivery = await prisma.invoiceDelivery.findUniqueOrThrow({ where: { id: data.invoiceDelivery.id } });
          assert.equal(delivery.status, failure ? "FAILED" : "SENT");
          assert.equal(delivery.providerMessageId, failure ? null : "synthetic-valid-domain-message");
          assert.equal((await prisma.bookingContract.findUniqueOrThrow({ where: { id: data.contract.id } })).status, "READY");
          assert.equal(await prisma.bookingContractEvent.count({ where: { contractId: data.contract.id } }), 0);
        }
        assert.equal(await prisma.reminder.count({ where: { stoppageId: data.stoppage.id } }), 0);
      });
    }
  }

  for (const sensitive of sensitiveTypes) {
    it(`${sensitive.type} ignores partial references for the other domains`, async () => {
      const data = await fixture(`valid-overlap-${sensitive.type}`);
      const unrelated = sensitive.type === "BOOKING_CONTRACT"
        ? { stoppageId: data.stoppage.id, invoiceId: data.invoice.id }
        : sensitive.type === "SAAS_INVOICE_EMAIL"
          ? { bookingId: data.booking.id, stoppageId: data.stoppage.id }
          : { bookingId: data.booking.id, invoiceId: data.invoice.id };
      const item = await enqueue(data, sensitive.type, { ...sensitive.build(data), ...unrelated });
      let sends = 0;
      emailSender.send = async () => { sends += 1; return { provider: "resend", id: "synthetic-valid-overlap" }; };
      await queue.processPending(new Date(), { ids: [item.id] });
      assert.equal(sends, 1);
      assert.equal((await prisma.emailQueue.findUniqueOrThrow({ where: { id: item.id } })).status, "SENT");
      assert.equal((await prisma.bookingContract.findUniqueOrThrow({ where: { id: data.contract.id } })).status, sensitive.type === "BOOKING_CONTRACT" ? "SENT" : "READY");
      assert.equal((await prisma.invoice.findUniqueOrThrow({ where: { id: data.invoice.id } })).status, sensitive.type === "SAAS_INVOICE_EMAIL" ? "SENT" : "GENERATED");
      assert.equal(await prisma.reminder.count({ where: { stoppageId: data.stoppage.id, success: true } }), sensitive.type === "REMINDER_EMAIL" ? 1 : 0);
      assert.equal((await prisma.stoppage.findUniqueOrThrow({ where: { id: data.stoppage.id } })).totalRemindersSent, sensitive.type === "REMINDER_EMAIL" ? 1 : 0);
    });
  }
});
