import assert from "node:assert/strict";
import test from "node:test";
import { InvoiceService } from "../src/application/services/invoice-service.js";
import { prisma } from "../src/infrastructure/database/prisma/client.js";
import {
  emailQueueCronService,
  handlePublicDemoRequest
} from "../src/interfaces/http/routes/index.js";

const date = new Date("2026-09-24T09:00:00.000Z");

const invoiceFixture = (deliveries: any[] = []) => ({
  id: "invoice_pending",
  tenantId: "tenant_1",
  invoiceNumber: "FLT-2026-00001",
  issueDate: date,
  dueDate: new Date("2026-10-08T09:00:00.000Z"),
  periodStart: new Date("2026-09-01T00:00:00.000Z"),
  periodEnd: new Date("2026-09-30T23:59:59.999Z"),
  status: "GENERATED",
  currency: "EUR",
  subtotal: 100,
  taxRate: 22,
  taxAmount: 22,
  total: 122,
  billingName: "Autonoleggio Demo",
  billingVatNumber: null,
  billingTaxCode: null,
  billingAddress: null,
  billingEmail: "billing@example.com",
  billingPec: null,
  billingSdi: null,
  notes: null,
  pdfFilePath: null,
  createdAt: date,
  updatedAt: date,
  sentAt: null,
  deletedAt: null,
  tenant: { id: "tenant_1", name: "Tenant Demo" },
  items: [],
  deliveries
});

test("invoice email keeps a leased queue item pending without terminal writes", async () => {
  const queuePayloads: any[] = [];
  const service = new InvoiceService({
    enqueue: async (payload: unknown) => {
      queuePayloads.push(payload);
      return { id: "queue_pending" };
    },
    processPending: async () => ({ processed: 0 })
  } as any);

  const pendingDelivery = {
    id: "delivery_pending",
    invoiceId: "invoice_pending",
    channel: "EMAIL",
    recipient: "billing@example.com",
    status: "PENDING",
    provider: null,
    providerMessageId: null,
    errorMessage: null,
    sentAt: null,
    createdAt: date
  };
  let findInvoiceCalls = 0;
  (service as any).findInvoice = async () => {
    findInvoiceCalls += 1;
    return invoiceFixture(findInvoiceCalls === 1 ? [] : [pendingDelivery]);
  };
  (service as any).renderPdf = async () => Buffer.from("pdf");
  (service as any).invoiceEmailHtml = () => "<p>invoice</p>";

  const originalTransaction = prisma.$transaction;
  const originalDeliveryUpdate = prisma.invoiceDelivery.update;
  const originalInvoiceUpdate = prisma.invoice.update;
  const originalQueueFindUnique = prisma.emailQueue.findUnique;
  const originalAuditCreate = prisma.auditLog.create;
  const auditRows: any[] = [];
  let terminalWrites = 0;

  const invoiceTransactionClient = {
    $queryRaw: async () => [{ locked: "1" }],
    invoiceEmailRequest: {
      findUnique: async () => null,
      create: async () => ({ id: "invoice_request_pending" })
    },
    invoiceDelivery: { create: async () => pendingDelivery }
  };
  (prisma as any).$transaction = async (callback: (tx: typeof invoiceTransactionClient) => unknown) =>
    callback(invoiceTransactionClient);
  (prisma.invoiceDelivery as any).update = async () => {
    terminalWrites += 1;
    throw new Error("The queue worker owns delivery finalization");
  };
  (prisma.invoice as any).update = async () => {
    terminalWrites += 1;
    throw new Error("The queue worker owns invoice finalization");
  };
  (prisma.emailQueue as any).findUnique = async () => ({
    status: "PENDING",
    lastError: null,
    meta: {}
  });
  (prisma.auditLog as any).create = async (input: unknown) => {
    auditRows.push(input);
    return { id: "audit_1" };
  };

  try {
    const result = await service.sendEmail({
      invoiceId: "invoice_pending",
      actorUserId: "platform_admin",
      sourceIp: "127.0.0.1",
      idempotencyKey: "invoice-email-pending"
    });

    assert.equal(result.data.status, "GENERATED");
    assert.equal(result.data.deliveries[0]?.status, "PENDING");
    assert.equal(queuePayloads.length, 1);
    assert.equal(terminalWrites, 0);
    assert.equal(auditRows.length, 1);
    assert.equal(auditRows[0].data.action, "PLATFORM_INVOICE_EMAIL_QUEUED");
    assert.equal(auditRows[0].data.details.error, null);
  } finally {
    (prisma as any).$transaction = originalTransaction;
    (prisma.invoiceDelivery as any).update = originalDeliveryUpdate;
    (prisma.invoice as any).update = originalInvoiceUpdate;
    (prisma.emailQueue as any).findUnique = originalQueueFindUnique;
    (prisma.auditLog as any).create = originalAuditCreate;
  }
});

test("public demo accepts a leased queue item as an in-flight delivery", async () => {
  const originalTransaction = prisma.$transaction;
  const originalLeadUpdate = prisma.demoLead.update;
  const originalQueueFindUnique = prisma.emailQueue.findUnique;
  const originalEnqueue = emailQueueCronService.enqueue;
  const originalProcessPending = emailQueueCronService.processPending;
  let leadUpdate: any = null;

  const demoTransactionClient = {
    $queryRaw: async () => [{ locked: "1" }],
    demoLead: {
      findUnique: async () => null,
      create: async () => ({ id: "lead_pending", createdAt: date }),
      update: async (input: any) => ({ id: input.where.id, ...input.data })
    },
    websiteEvent: { create: async () => ({ id: "event_pending" }) }
  };
  (prisma as any).$transaction = async (callback: (tx: typeof demoTransactionClient) => unknown) =>
    callback(demoTransactionClient);
  (prisma.demoLead as any).update = async (input: unknown) => {
    leadUpdate = input;
    return { id: "lead_pending" };
  };
  (prisma.emailQueue as any).findUnique = async () => ({
    status: "PENDING",
    lastError: null,
    meta: {}
  });
  (emailQueueCronService as any).enqueue = async () => ({ id: "queue_demo_pending" });
  (emailQueueCronService as any).processPending = async () => ({ processed: 0 });

  const response = {
    statusCode: 200,
    body: null as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
    setHeader() {
      return undefined;
    }
  };

  try {
    await handlePublicDemoRequest({
      body: {
        companyName: "Autonoleggio Demo",
        fullName: "Mario Rossi",
        email: "mario.rossi@example.com",
        fleetSize: "11-30",
        source: "fleetum.it/demo"
      },
      ip: "127.0.0.1",
      headers: { "user-agent": "test", "x-idempotency-key": "demo-email-pending" }
    } as any, response as any);

    assert.equal(response.statusCode, 202);
    assert.equal((response.body as any).ok, true);
    assert.equal((response.body as any).delivery.status, "PENDING");
    assert.equal((response.body as any).delivery.provider, null);
    assert.equal(leadUpdate.data.emailDeliveryStatus, "PENDING");
  } finally {
    (prisma as any).$transaction = originalTransaction;
    (prisma.demoLead as any).update = originalLeadUpdate;
    (prisma.emailQueue as any).findUnique = originalQueueFindUnique;
    (emailQueueCronService as any).enqueue = originalEnqueue;
    (emailQueueCronService as any).processPending = originalProcessPending;
  }
});
