import assert from "node:assert/strict";
import { after, afterEach, before, describe, it } from "node:test";
import { prisma } from "../../src/infrastructure/database/prisma/client.js";
import { EmailQueueService } from "../../src/infrastructure/email/email-queue-service.js";
import { emailSender } from "../../src/infrastructure/email/email-sender.js";

const runId = `email-atomicity-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const queueIds: string[] = [];
const invoiceIds: string[] = [];
const tenantIds: string[] = [];
const originalSend = emailSender.send;

const enqueue = async (suffix: string) => {
  const item = await new EmailQueueService().enqueue({
    tenantId: runId,
    type: `ATOMICITY_${suffix}`,
    recipient: `${suffix.toLowerCase()}@example.test`,
    subject: `Test ${suffix}`,
    body: "Synthetic queue test"
  });
  queueIds.push(item.id);
  return item;
};

const enqueueInvoice = async (suffix: string, options: { invalidDeliveryId?: boolean; maxAttempts?: number } = {}) => {
  const tenant = await prisma.tenant.create({ data: { name: `Email Queue ${runId} ${suffix}` } });
  tenantIds.push(tenant.id);
  const invoice = await prisma.invoice.create({
    data: {
      tenantId: tenant.id,
      invoiceNumber: `QUEUE-${runId}-${suffix}`,
      issueDate: new Date("2030-01-01T00:00:00.000Z"),
      dueDate: new Date("2030-01-31T00:00:00.000Z"),
      periodStart: new Date("2029-12-01T00:00:00.000Z"),
      periodEnd: new Date("2029-12-31T00:00:00.000Z"),
      subtotal: 100,
      taxRate: 22,
      taxAmount: 22,
      total: 122,
      billingName: "Synthetic Billing",
      billingEmail: `${suffix.toLowerCase()}@example.test`
    }
  });
  invoiceIds.push(invoice.id);
  const delivery = await prisma.invoiceDelivery.create({
    data: { invoiceId: invoice.id, recipient: `${suffix.toLowerCase()}@example.test` }
  });
  const item = await new EmailQueueService().enqueue({
    tenantId: tenant.id,
    type: "SAAS_INVOICE_EMAIL",
    recipient: `${suffix.toLowerCase()}@example.test`,
    subject: `Invoice ${suffix}`,
    body: "Synthetic invoice queue test",
    meta: {
      tenantId: tenant.id,
      invoiceId: invoice.id,
      invoiceDeliveryId: options.invalidDeliveryId ? `missing-${delivery.id}` : delivery.id
    }
  });
  queueIds.push(item.id);
  if (options.maxAttempts) {
    await prisma.emailQueue.update({ where: { id: item.id }, data: { maxAttempts: options.maxAttempts } });
  }
  return { tenant, invoice, delivery, item };
};

describe("email queue atomic claims", () => {
  before(async () => {
    await prisma.$connect();
  });

  afterEach(async () => {
    emailSender.send = originalSend;
    await prisma.emailQueue.deleteMany({ where: { id: { in: queueIds.splice(0) } } });
    await prisma.invoiceDelivery.deleteMany({ where: { invoiceId: { in: invoiceIds } } });
    await prisma.invoice.deleteMany({ where: { id: { in: invoiceIds.splice(0) } } });
    await prisma.tenant.deleteMany({ where: { id: { in: tenantIds.splice(0) } } });
  });

  after(async () => {
    await prisma.$disconnect();
  });

  it("lets only one concurrent worker send a pending row", async () => {
    const item = await enqueue("CONCURRENT");
    let sendCalls = 0;
    let releaseSend!: () => void;
    let signalEntered!: () => void;
    const entered = new Promise<void>((resolve) => {
      signalEntered = resolve;
    });
    const blocked = new Promise<void>((resolve) => {
      releaseSend = resolve;
    });

    emailSender.send = async () => {
      sendCalls += 1;
      signalEntered();
      await blocked;
      return { provider: "resend", id: "logical-email-1" };
    };

    const service = new EmailQueueService();
    const first = service.processPending(new Date(), { ids: [item.id], take: 1 });
    await entered;
    const competitors = await Promise.all(
      Array.from({ length: 7 }, () => service.processPending(new Date(), { ids: [item.id], take: 1 }))
    );
    assert.ok(competitors.every((result) => result.processed === 0));
    const whileLeased = await prisma.emailQueue.findUniqueOrThrow({ where: { id: item.id } });
    assert.equal(whileLeased.status, "PENDING");
    assert.ok(whileLeased.processingToken);
    assert.ok(whileLeased.leaseExpiresAt);
    releaseSend();
    const firstResult = await first;

    assert.equal(sendCalls, 1);
    assert.equal(firstResult.processed + competitors.reduce((sum, result) => sum + result.processed, 0), 1);
    const persisted = await prisma.emailQueue.findUniqueOrThrow({ where: { id: item.id } });
    assert.equal(persisted.status, "SENT");
    assert.equal(persisted.attempts, 1);
    assert.equal(persisted.processingToken, null);
    assert.equal(persisted.leaseExpiresAt, null);
  });

  it("recovers an expired lease without taking over an active lease", async () => {
    const expired = await enqueue("EXPIRED");
    const active = await enqueue("ACTIVE");
    const now = new Date();
    await prisma.emailQueue.update({
      where: { id: expired.id },
      data: {
        processingToken: "abandoned-worker",
        processingStartedAt: new Date(now.getTime() - 20 * 60 * 1000),
        leaseExpiresAt: new Date(now.getTime() - 5 * 60 * 1000)
      }
    });
    await prisma.emailQueue.update({
      where: { id: active.id },
      data: {
        processingToken: "active-worker",
        processingStartedAt: now,
        leaseExpiresAt: new Date(now.getTime() + 5 * 60 * 1000)
      }
    });

    const sentIds: string[] = [];
    emailSender.send = async (input) => {
      sentIds.push(String(input.idempotencyKey));
      return { provider: "resend", id: "recovered-email" };
    };

    const result = await new EmailQueueService().processPending(now, { ids: [expired.id, active.id] });
    assert.equal(result.processed, 1);
    assert.deepEqual(sentIds, [`fleetum-email-queue:${expired.id}`]);
    assert.equal((await prisma.emailQueue.findUniqueOrThrow({ where: { id: expired.id } })).status, "SENT");
    assert.equal((await prisma.emailQueue.findUniqueOrThrow({ where: { id: active.id } })).status, "PENDING");
  });

  it("rolls back SENT and retries only local finalization after the provider accepted", async () => {
    const { item, invoice, delivery, tenant } = await enqueueInvoice("FINALIZER_ROLLBACK", { invalidDeliveryId: true });
    const providerCalls: string[] = [];
    emailSender.send = async (input) => {
      providerCalls.push(String(input.idempotencyKey));
      return { provider: "resend", id: "provider-deduplicated-email" };
    };

    await new EmailQueueService().processPending(new Date(), { ids: [item.id] });

    const afterFailure = await prisma.emailQueue.findUniqueOrThrow({ where: { id: item.id } });
    assert.equal(afterFailure.status, "PENDING");
    assert.equal(afterFailure.attempts, 1);
    assert.equal(afterFailure.processingToken, null);
    assert.equal((await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } })).status, "GENERATED");
    assert.equal((await prisma.invoiceDelivery.findUniqueOrThrow({ where: { id: delivery.id } })).status, "PENDING");

    await prisma.emailQueue.update({
      where: { id: item.id },
      data: {
        nextAttemptAt: new Date(0),
        meta: {
          ...((afterFailure.meta ?? {}) as Record<string, unknown>),
          tenantId: tenant.id,
          invoiceId: invoice.id,
          invoiceDeliveryId: delivery.id
        }
      }
    });
    await new EmailQueueService().processPending(new Date(), { ids: [item.id] });

    assert.equal(providerCalls.length, 1);
    assert.equal(providerCalls[0], `fleetum-email-queue:${item.id}`);
    const persisted = await prisma.emailQueue.findUniqueOrThrow({ where: { id: item.id } });
    assert.equal(persisted.status, "SENT");
    assert.equal(persisted.attempts, 2);
    assert.equal((await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } })).status, "SENT");
    const persistedDelivery = await prisma.invoiceDelivery.findUniqueOrThrow({ where: { id: delivery.id } });
    assert.equal(persistedDelivery.status, "SENT");
    assert.equal(persistedDelivery.providerMessageId, "provider-deduplicated-email");
  });

  it("keeps queue and invoice finalization consistent after a lost commit acknowledgement", async () => {
    const { item, invoice, delivery } = await enqueueInvoice("LOST_ACK");
    const providerCalls: string[] = [];
    emailSender.send = async (input) => {
      providerCalls.push(String(input.idempotencyKey));
      return { provider: "resend", id: "provider-lost-ack-email" };
    };

    const client = prisma as typeof prisma & { $transaction: typeof prisma.$transaction };
    const originalTransaction = client.$transaction.bind(client);
    let loseAcknowledgement = true;
    (client as any).$transaction = async (...args: unknown[]) => {
      const result = await (originalTransaction as any)(...args);
      if (loseAcknowledgement && typeof args[0] === "function") {
        loseAcknowledgement = false;
        throw new Error("synthetic lost commit acknowledgement");
      }
      return result;
    };

    try {
      await new EmailQueueService().processPending(new Date(), { ids: [item.id] });
    } finally {
      (client as any).$transaction = originalTransaction;
    }

    assert.equal(providerCalls.length, 1);
    assert.equal((await prisma.emailQueue.findUniqueOrThrow({ where: { id: item.id } })).status, "SENT");
    assert.equal((await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } })).status, "SENT");
    assert.equal((await prisma.invoiceDelivery.findUniqueOrThrow({ where: { id: delivery.id } })).status, "SENT");

    const replay = await new EmailQueueService().processPending(new Date(), { ids: [item.id] });
    assert.equal(replay.processed, 0);
    assert.equal(providerCalls.length, 1);
  });

  it("keeps retryable failures pending and uses minute-based backoff before terminal failure", async () => {
    const { item, invoice, delivery } = await enqueueInvoice("RETRY_STATE", { maxAttempts: 2 });
    emailSender.send = async () => {
      throw new Error("synthetic provider outage");
    };

    const firstAttemptAt = new Date();
    await new EmailQueueService().processPending(firstAttemptAt, { ids: [item.id] });

    const retryable = await prisma.emailQueue.findUniqueOrThrow({ where: { id: item.id } });
    assert.equal(retryable.status, "PENDING");
    assert.equal(retryable.attempts, 1);
    assert.ok(retryable.nextAttemptAt.getTime() - firstAttemptAt.getTime() >= 2 * 60 * 1000);
    assert.ok(retryable.nextAttemptAt.getTime() - firstAttemptAt.getTime() < 3 * 60 * 1000);
    assert.equal((await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } })).status, "GENERATED");
    const retryableDelivery = await prisma.invoiceDelivery.findUniqueOrThrow({ where: { id: delivery.id } });
    assert.equal(retryableDelivery.status, "PENDING");
    assert.match(retryableDelivery.errorMessage ?? "", /provider outage/);

    await prisma.emailQueue.update({ where: { id: item.id }, data: { nextAttemptAt: new Date(0) } });
    await new EmailQueueService().processPending(new Date(), { ids: [item.id] });

    const terminal = await prisma.emailQueue.findUniqueOrThrow({ where: { id: item.id } });
    assert.equal(terminal.status, "FAILED");
    assert.equal(terminal.attempts, 2);
    assert.equal((await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } })).status, "ERROR");
    assert.equal((await prisma.invoiceDelivery.findUniqueOrThrow({ where: { id: delivery.id } })).status, "FAILED");
  });

  it("refetches attempts after claim so a takeover cannot exceed maxAttempts", async () => {
    const item = await enqueue("TAKEOVER_ATTEMPTS");
    await prisma.emailQueue.update({ where: { id: item.id }, data: { maxAttempts: 2 } });
    emailSender.send = async () => {
      throw new Error("synthetic terminal provider outage");
    };

    const delegate = prisma.emailQueue as typeof prisma.emailQueue & { updateMany: typeof prisma.emailQueue.updateMany };
    const originalUpdateMany = delegate.updateMany.bind(delegate);
    let oldOwnerReleased = false;
    (delegate as any).updateMany = async (args: Parameters<typeof originalUpdateMany>[0]) => {
      if (!oldOwnerReleased && args.data && "processingToken" in args.data && args.data.processingToken) {
        oldOwnerReleased = true;
        await prisma.emailQueue.update({
          where: { id: item.id },
          data: { attempts: { increment: 1 }, processingToken: null, processingStartedAt: null, leaseExpiresAt: null }
        });
      }
      return originalUpdateMany(args);
    };

    try {
      await new EmailQueueService().processPending(new Date(), { ids: [item.id] });
    } finally {
      (delegate as any).updateMany = originalUpdateMany;
    }

    const persisted = await prisma.emailQueue.findUniqueOrThrow({ where: { id: item.id } });
    assert.equal(oldOwnerReleased, true);
    assert.equal(persisted.attempts, 2);
    assert.equal(persisted.status, "FAILED");
  });
});
