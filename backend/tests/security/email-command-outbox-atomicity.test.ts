import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { InvoiceService } from "../../src/application/services/invoice-service.js";
import { prisma } from "../../src/infrastructure/database/prisma/client.js";
import { EmailQueueService } from "../../src/infrastructure/email/email-queue-service.js";
import { RentalBookingsController } from "../../src/interfaces/http/controllers/rental-bookings-controller.js";
import { emailQueueCronService, handlePublicDemoRequest } from "../../src/interfaces/http/routes/index.js";
import { AppError } from "../../src/shared/errors/app-error.js";
import { privacyHash } from "../../src/shared/utils/privacy-hash.js";

const runId = `email-command-outbox-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const response = () => ({
  statusCode: 200,
  headers: {} as Record<string, string>,
  body: null as unknown,
  status(code: number) {
    this.statusCode = code;
    return this;
  },
  json(payload: unknown) {
    this.body = payload;
    return this;
  },
  setHeader(name: string, value: string) {
    this.headers[name] = String(value);
  }
});

describe("email command outbox atomicity", () => {
  before(async () => {
    await prisma.$connect();
  });

  after(async () => {
    await prisma.websiteEvent.deleteMany({
      where: { visitorId: privacyHash(`${runId}-visitor`) }
    });
    await prisma.demoLead.deleteMany({ where: { source: runId } });
    const tenants = await prisma.tenant.findMany({
      where: { name: { startsWith: runId } },
      select: { id: true }
    });
    const tenantIds = tenants.map((tenant) => tenant.id);
    if (tenantIds.length) {
      await prisma.invoiceEmailRequest.deleteMany({ where: { tenantId: { in: tenantIds } } });
      await prisma.bookingContractEmailRequest.deleteMany({ where: { tenantId: { in: tenantIds } } });
      await prisma.emailQueue.deleteMany({ where: { tenantId: { in: tenantIds } } });
      await prisma.auditLog.deleteMany({ where: { tenantId: { in: tenantIds } } });
      await prisma.bookingContractEvent.deleteMany({ where: { tenantId: { in: tenantIds } } });
      await prisma.bookingContractDelivery.deleteMany({ where: { tenantId: { in: tenantIds } } });
      await prisma.bookingContract.deleteMany({ where: { tenantId: { in: tenantIds } } });
      await prisma.rentalBooking.deleteMany({ where: { tenantId: { in: tenantIds } } });
      await prisma.rentalCustomer.deleteMany({ where: { tenantId: { in: tenantIds } } });
      await prisma.vehicle.deleteMany({ where: { tenantId: { in: tenantIds } } });
      await prisma.site.deleteMany({ where: { tenantId: { in: tenantIds } } });
      await prisma.invoice.deleteMany({ where: { tenantId: { in: tenantIds } } });
      await prisma.tenant.deleteMany({ where: { id: { in: tenantIds } } });
    }
    await prisma.emailQueue.deleteMany({
      where: {
        type: "PUBLIC_DEMO_REQUEST",
        meta: { path: ["source"], equals: runId }
      }
    });
    await prisma.$disconnect();
  });

  it("creates one contract delivery and one queue row for concurrent retries, and rolls back enqueue failures", async () => {
    const tenant = await prisma.tenant.create({ data: { name: `${runId}-contract` } });
    const site = await prisma.site.create({
      data: { tenantId: tenant.id, name: "Synthetic Site", address: "Synthetic Address", city: "Roma" }
    });
    const vehicle = await prisma.vehicle.create({
      data: { tenantId: tenant.id, siteId: site.id, plate: `CT${Date.now()}`, brand: "Test", model: "Vehicle" }
    });
    const customer = await prisma.rentalCustomer.create({
      data: {
        tenantId: tenant.id,
        firstName: "Mario",
        lastName: "Rossi",
        email: `${runId}@example.test`
      }
    });
    const booking = await prisma.rentalBooking.create({
      data: {
        tenantId: tenant.id,
        vehicleId: vehicle.id,
        customerId: customer.id,
        code: `BK-${runId}`,
        customerName: "Mario Rossi",
        customerEmail: customer.email,
        pickupAt: new Date("2031-01-10T09:00:00.000Z"),
        returnAt: new Date("2031-01-12T09:00:00.000Z")
      }
    });
    const contract = await prisma.bookingContract.create({
      data: {
        tenantId: tenant.id,
        bookingId: booking.id,
        title: "Contratto sintetico",
        content: "Contenuto sintetico",
        emailSubject: "Contratto sintetico",
        emailBody: "Body sintetico"
      }
    });
    const realQueue = new EmailQueueService();
    const controller = new RentalBookingsController({
      enqueue: realQueue.enqueue.bind(realQueue),
      processPending: async () => ({ processed: 0 })
    } as any);
    (controller as any).tenantProfileService = {
      contractBranding: async () => ({ companyName: "Fleetum Test", companyEmail: "reply@example.test" })
    };
    (controller as any).getContractOrThrow = async () => ({
      ...contract,
      booking: {
        ...booking,
        customer,
        vehicle,
        customerName: booking.customerName,
        customerEmail: booking.customerEmail
      }
    });
    (controller as any).buildContractPdf = async () => Buffer.from("synthetic-contract-pdf");
    (controller as any).logContractEvent = async () => undefined;

    const key = `contract-${runId}`;
    const request = {
      auth: { tenantId: tenant.id },
      params: { id: booking.id },
      headers: { "x-idempotency-key": key },
      body: {}
    } as any;
    const [first, second] = [response(), response()];
    await Promise.all([
      controller.sendContractEmail(request, first as any),
      controller.sendContractEmail(request, second as any)
    ]);

    assert.equal(await prisma.bookingContractDelivery.count({ where: { contractId: contract.id } }), 1);
    assert.equal(await prisma.bookingContractEmailRequest.count({ where: { tenantId: tenant.id } }), 1);
    assert.equal(await prisma.emailQueue.count({ where: { tenantId: tenant.id, type: "BOOKING_CONTRACT" } }), 1);
    assert.deepEqual([first.statusCode, second.statusCode].sort(), [200, 201]);
    assert.ok(first.headers["Idempotency-Replayed"] === "true" || second.headers["Idempotency-Replayed"] === "true");

    const deliveryCount = await prisma.bookingContractDelivery.count({ where: { contractId: contract.id } });
    const failingController = new RentalBookingsController({
      enqueue: async () => {
        throw new Error("synthetic enqueue failure");
      },
      processPending: async () => ({ processed: 0 })
    } as any);
    (failingController as any).tenantProfileService = (controller as any).tenantProfileService;
    (failingController as any).getContractOrThrow = (controller as any).getContractOrThrow;
    (failingController as any).buildContractPdf = (controller as any).buildContractPdf;
    (failingController as any).logContractEvent = async () => undefined;
    await assert.rejects(() => failingController.sendContractEmail({
      ...request,
      headers: { "x-idempotency-key": `contract-failure-${runId}` }
    }, response() as any), /synthetic enqueue failure/);
    assert.equal(await prisma.bookingContractDelivery.count({ where: { contractId: contract.id } }), deliveryCount);
  });

  it("creates invoice delivery, queue and command ledger atomically and replays concurrent retries", async () => {
    const tenant = await prisma.tenant.create({ data: { name: `${runId}-invoice` } });
    const invoice = await prisma.invoice.create({
      data: {
        tenantId: tenant.id,
        invoiceNumber: `INV-${runId}`,
        issueDate: new Date("2031-02-01T00:00:00.000Z"),
        dueDate: new Date("2031-02-28T00:00:00.000Z"),
        periodStart: new Date("2031-01-01T00:00:00.000Z"),
        periodEnd: new Date("2031-01-31T23:59:59.999Z"),
        subtotal: 100,
        taxRate: 22,
        taxAmount: 22,
        total: 122,
        billingName: "Synthetic Billing",
        billingEmail: `${runId}@example.test`
      }
    });
    const invoiceFixture = {
      ...invoice,
      tenant: { id: tenant.id, name: tenant.name },
      items: [],
      deliveries: []
    };
    const realQueue = new EmailQueueService();
    const service = new InvoiceService({
      enqueue: realQueue.enqueue.bind(realQueue),
      processPending: async () => ({ processed: 0 })
    } as any);
    (service as any).findInvoice = async () => invoiceFixture;
    (service as any).renderPdf = async () => Buffer.from("synthetic-invoice-pdf");
    const input = {
      invoiceId: invoice.id,
      actorUserId: "synthetic-platform-admin",
      sourceIp: "203.0.113.20",
      idempotencyKey: `invoice-${runId}`
    };

    const [first, second] = await Promise.all([service.sendEmail(input), service.sendEmail(input)]);
    assert.equal(await prisma.invoiceDelivery.count({ where: { invoiceId: invoice.id } }), 1);
    assert.equal(await prisma.invoiceEmailRequest.count({ where: { tenantId: tenant.id } }), 1);
    assert.equal(await prisma.emailQueue.count({ where: { tenantId: tenant.id, type: "SAAS_INVOICE_EMAIL" } }), 1);
    assert.equal([first.replayed, second.replayed].filter(Boolean).length, 1);

    const deliveryCount = await prisma.invoiceDelivery.count({ where: { invoiceId: invoice.id } });
    const failingService = new InvoiceService({
      enqueue: async () => {
        throw new Error("synthetic invoice enqueue failure");
      },
      processPending: async () => ({ processed: 0 })
    } as any);
    (failingService as any).findInvoice = async () => invoiceFixture;
    (failingService as any).renderPdf = async () => Buffer.from("synthetic-invoice-pdf");
    await assert.rejects(() => failingService.sendEmail({
      ...input,
      idempotencyKey: `invoice-failure-${runId}`
    }), /synthetic invoice enqueue failure/);
    assert.equal(await prisma.invoiceDelivery.count({ where: { invoiceId: invoice.id } }), deliveryCount);
  });

  it("creates one demo lead and outbox row, rejects changed replays, and rolls back enqueue failures", async () => {
    const originalProcessPending = emailQueueCronService.processPending;
    const originalEnqueue = emailQueueCronService.enqueue;
    (emailQueueCronService as any).processPending = async () => ({ processed: 0 });
    const key = `demo-${runId}`;
    const body = {
      companyName: "Autonoleggio Sintetico",
      fullName: "Mario Rossi",
      email: `${runId}@example.test`,
      fleetSize: "11-30",
      source: runId,
      visitorId: `${runId}-visitor`,
      consentAnalytics: true
    };
    const request = {
      body,
      ip: "203.0.113.30",
      headers: { "user-agent": "Synthetic Browser", "x-idempotency-key": key }
    } as any;

    try {
      const [first, second] = [response(), response()];
      await Promise.all([
        handlePublicDemoRequest(request, first as any),
        handlePublicDemoRequest(request, second as any)
      ]);
      const lead = await prisma.demoLead.findUniqueOrThrow({ where: { idempotencyKey: key } });
      assert.ok(lead.emailQueueId);
      assert.equal(await prisma.demoLead.count({ where: { idempotencyKey: key } }), 1);
      assert.equal(await prisma.emailQueue.count({ where: { id: lead.emailQueueId! } }), 1);
      assert.equal(await prisma.websiteEvent.count({ where: { visitorId: privacyHash(`${runId}-visitor`) } }), 1);
      assert.ok(first.headers["Idempotency-Replayed"] === "true" || second.headers["Idempotency-Replayed"] === "true");

      await assert.rejects(
        () => handlePublicDemoRequest({ ...request, body: { ...body, companyName: "Payload diverso" } }, response() as any),
        (error: unknown) => error instanceof AppError && error.code === "IDEMPOTENCY_KEY_REUSED"
      );

      (emailQueueCronService as any).enqueue = async () => {
        throw new Error("synthetic demo enqueue failure");
      };
      const failedKey = `demo-failure-${runId}`;
      await assert.rejects(() => handlePublicDemoRequest({
        ...request,
        headers: { ...request.headers, "x-idempotency-key": failedKey },
        body: { ...body, email: `failure-${runId}@example.test` }
      }, response() as any), /synthetic demo enqueue failure/);
      assert.equal(await prisma.demoLead.count({ where: { idempotencyKey: failedKey } }), 0);
      assert.equal(await prisma.websiteEvent.count({ where: { visitorId: privacyHash(`${runId}-visitor`) } }), 1);
    } finally {
      (emailQueueCronService as any).enqueue = originalEnqueue;
      (emailQueueCronService as any).processPending = originalProcessPending;
    }
  });
});
