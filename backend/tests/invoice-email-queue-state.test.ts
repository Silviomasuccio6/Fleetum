import assert from "node:assert/strict";
import test from "node:test";
import { InvoiceService } from "../src/application/services/invoice-service.js";
import { prisma } from "../src/infrastructure/database/prisma/client.js";

test("invoice email keeps an in-flight leased queue item pending", async () => {
  const now = new Date("2030-01-15T12:00:00.000Z");
  const delivery = {
    id: "delivery_pending",
    invoiceId: "invoice_pending",
    channel: "EMAIL",
    recipient: "billing@example.test",
    status: "PENDING",
    provider: null,
    providerMessageId: null,
    errorMessage: null,
    sentAt: null,
    createdAt: now
  };
  const invoice = {
    id: "invoice_pending",
    tenantId: "tenant_pending",
    invoiceNumber: "FLT-2030-PENDING",
    issueDate: now,
    dueDate: new Date("2030-01-31T00:00:00.000Z"),
    periodStart: new Date("2029-12-01T00:00:00.000Z"),
    periodEnd: new Date("2029-12-31T23:59:59.999Z"),
    status: "GENERATED",
    currency: "EUR",
    subtotal: 100,
    taxRate: 22,
    taxAmount: 22,
    total: 122,
    billingName: "Synthetic Billing",
    billingVatNumber: null,
    billingTaxCode: null,
    billingAddress: null,
    billingEmail: "billing@example.test",
    billingPec: null,
    billingSdi: null,
    notes: null,
    pdfFilePath: null,
    createdAt: now,
    updatedAt: now,
    sentAt: null,
    deletedAt: null,
    tenant: { id: "tenant_pending", name: "Synthetic Tenant" },
    items: [],
    deliveries: [delivery]
  };

  const queue = {
    enqueue: async () => ({ id: "queue_pending" }),
    processPending: async () => ({ processed: 0 })
  };
  const service = new InvoiceService(queue as any);
  (service as any).findInvoice = async () => invoice;
  (service as any).renderPdf = async () => Buffer.from("synthetic-pdf");

  const originalTransaction = prisma.$transaction;
  const originalDeliveryUpdate = prisma.invoiceDelivery.update;
  const originalInvoiceUpdate = prisma.invoice.update;
  const originalQueueFindUnique = prisma.emailQueue.findUnique;
  const originalAuditCreate = prisma.auditLog.create;
  let directFinalizationCalls = 0;
  let auditAction: string | undefined;

  const transactionClient = {
    $queryRaw: async () => [{ locked: "1" }],
    invoiceEmailRequest: {
      findUnique: async () => null,
      create: async () => ({ id: "invoice_request_pending" })
    },
    invoiceDelivery: {
      create: async () => delivery
    }
  };
  (prisma as any).$transaction = async (callback: (tx: typeof transactionClient) => unknown) => callback(transactionClient);
  (prisma.invoiceDelivery as any).update = async () => {
    directFinalizationCalls += 1;
    throw new Error("The queue worker owns delivery finalization");
  };
  (prisma.invoice as any).update = async () => {
    directFinalizationCalls += 1;
    throw new Error("The queue worker owns invoice finalization");
  };
  (prisma.emailQueue as any).findUnique = async () => ({ status: "PENDING", lastError: "transient", meta: null });
  (prisma.auditLog as any).create = async (input: any) => {
    auditAction = input.data.action;
    return { id: "audit_pending", ...input.data };
  };

  try {
    const result = await service.sendEmail({
      invoiceId: invoice.id,
      actorUserId: "platform_user",
      sourceIp: "203.0.113.20",
      idempotencyKey: "invoice-email-pending"
    });

    assert.equal(result.data.status, "GENERATED");
    assert.equal(result.data.deliveries[0]?.status, "PENDING");
    assert.equal(auditAction, "PLATFORM_INVOICE_EMAIL_QUEUED");
    assert.equal(directFinalizationCalls, 0);
  } finally {
    (prisma as any).$transaction = originalTransaction;
    (prisma.invoiceDelivery as any).update = originalDeliveryUpdate;
    (prisma.invoice as any).update = originalInvoiceUpdate;
    (prisma.emailQueue as any).findUnique = originalQueueFindUnique;
    (prisma.auditLog as any).create = originalAuditCreate;
  }
});
