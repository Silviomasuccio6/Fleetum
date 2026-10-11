import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { RentalBookingsController } from "../../src/interfaces/http/controllers/rental-bookings-controller.js";
import { prisma } from "../../src/infrastructure/database/prisma/client.js";
import { EmailQueueService } from "../../src/infrastructure/email/email-queue-service.js";
import { AppError } from "../../src/shared/errors/app-error.js";

type MockResponse = {
  statusCode: number;
  headers: Record<string, string>;
  body: unknown;
  status: (code: number) => MockResponse;
  json: (payload: unknown) => MockResponse;
  setHeader: (name: string, value: string) => void;
};

const createResponse = (): MockResponse => ({
  statusCode: 200,
  headers: {},
  body: null,
  status(code) {
    this.statusCode = code;
    return this;
  },
  json(payload) {
    this.body = payload;
    return this;
  },
  setHeader(name, value) {
    this.headers[name.toLowerCase()] = String(value);
  }
});

const runId = `contract-outbox-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let tenantId = "";
let bookingAId = "";
let bookingBId = "";
let contractAId = "";
let contractBId = "";
const fixtures = new Map<string, Record<string, unknown>>();

const controllerWithQueue = (options: { failEnqueue?: boolean } = {}) => {
  const queue = new EmailQueueService();
  const controller = new RentalBookingsController({
    enqueue: async (input: Parameters<EmailQueueService["enqueue"]>[0], db: Parameters<EmailQueueService["enqueue"]>[1]) => {
      if (options.failEnqueue) throw new Error("synthetic enqueue failure");
      return queue.enqueue(input, db);
    },
    processPending: async () => ({ processed: 0 })
  } as any, {
    contractBranding: async () => ({ companyName: "Fleetum Test", companyEmail: "noreply@example.test" })
  } as any);

  (controller as any).getContractOrThrow = async (requestedTenantId: string, bookingId: string) => {
    assert.equal(requestedTenantId, tenantId);
    const fixture = fixtures.get(bookingId);
    if (!fixture) throw new Error(`Missing contract fixture ${bookingId}`);
    return fixture;
  };
  (controller as any).buildContractPdf = async () => Buffer.from("synthetic contract pdf");
  (controller as any).logContractEvent = async () => undefined;
  return controller;
};

const send = async (
  controller: RentalBookingsController,
  bookingId: string,
  idempotencyKey: string,
  body: Record<string, unknown> = {}
) => {
  const response = createResponse();
  await controller.sendContractEmail({
    auth: { tenantId, userId: "synthetic-user" },
    params: { id: bookingId },
    headers: { "x-idempotency-key": idempotencyKey },
    body
  } as any, response as any);
  return response;
};

describe("contract email transactional outbox idempotency", () => {
  before(async () => {
    await prisma.$connect();
    const tenant = await prisma.tenant.create({ data: { name: `Contract Outbox ${runId}` } });
    tenantId = tenant.id;
    const site = await prisma.site.create({
      data: { tenantId, name: `Site ${runId}`, address: "Via sintetica 1", city: "Roma" }
    });
    const vehicle = await prisma.vehicle.create({
      data: { tenantId, siteId: site.id, plate: `CO${Date.now()}`.slice(0, 12), brand: "Test", model: "Atomic" }
    });

    const bookingA = await prisma.rentalBooking.create({
      data: {
        tenantId,
        vehicleId: vehicle.id,
        code: `CONTRACT-A-${runId}`,
        customerName: "Cliente A",
        customerEmail: "cliente-a@example.test",
        pickupAt: new Date("2031-01-10T08:00:00.000Z"),
        returnAt: new Date("2031-01-11T08:00:00.000Z")
      }
    });
    const bookingB = await prisma.rentalBooking.create({
      data: {
        tenantId,
        vehicleId: vehicle.id,
        code: `CONTRACT-B-${runId}`,
        customerName: "Cliente B",
        customerEmail: "cliente-b@example.test",
        pickupAt: new Date("2031-02-10T08:00:00.000Z"),
        returnAt: new Date("2031-02-11T08:00:00.000Z")
      }
    });
    bookingAId = bookingA.id;
    bookingBId = bookingB.id;

    const contractA = await prisma.bookingContract.create({
      data: {
        tenantId,
        bookingId: bookingA.id,
        title: "Contratto A",
        content: "Contenuto contratto A",
        emailSubject: "Contratto {{booking.code}}",
        emailBody: "Gentile {{customer.fullName}}"
      }
    });
    const contractB = await prisma.bookingContract.create({
      data: {
        tenantId,
        bookingId: bookingB.id,
        title: "Contratto B",
        content: "Contenuto contratto B",
        emailSubject: "Contratto {{booking.code}}",
        emailBody: "Gentile {{customer.fullName}}"
      }
    });
    contractAId = contractA.id;
    contractBId = contractB.id;

    fixtures.set(bookingA.id, {
      ...contractA,
      booking: {
        ...bookingA,
        customer: null,
        vehicle: { plate: vehicle.plate, brand: vehicle.brand, model: vehicle.model }
      }
    });
    fixtures.set(bookingB.id, {
      ...contractB,
      booking: {
        ...bookingB,
        customer: null,
        vehicle: { plate: vehicle.plate, brand: vehicle.brand, model: vehicle.model }
      }
    });
  });

  after(async () => {
    if (tenantId) {
      await prisma.emailQueue.deleteMany({ where: { tenantId } });
      await prisma.bookingContractEmailRequest.deleteMany({ where: { tenantId } });
      await prisma.bookingContractDelivery.deleteMany({ where: { tenantId } });
      await prisma.bookingContract.deleteMany({ where: { tenantId } });
      await prisma.rentalBooking.deleteMany({ where: { tenantId } });
      await prisma.vehicle.deleteMany({ where: { tenantId } });
      await prisma.site.deleteMany({ where: { tenantId } });
      await prisma.tenant.deleteMany({ where: { id: tenantId } });
    }
    await prisma.$disconnect();
  });

  it("creates one delivery and one queue row for concurrent requests with the same tenant key", async () => {
    const controller = controllerWithQueue();
    const idempotencyKey = `${runId}-concurrent`;
    const responses = await Promise.all(
      Array.from({ length: 8 }, () => send(controller, bookingAId, idempotencyKey))
    );

    assert.equal(responses.filter((response) => response.statusCode === 201).length, 1);
    assert.equal(responses.filter((response) => response.statusCode === 200).length, 7);
    assert.equal(responses.filter((response) => response.headers["idempotency-replayed"] === "true").length, 7);

    const request = await prisma.bookingContractEmailRequest.findUniqueOrThrow({
      where: { tenantId_idempotencyKey: { tenantId, idempotencyKey } }
    });
    assert.equal(await prisma.bookingContractDelivery.count({ where: { tenantId, id: request.deliveryId } }), 1);
    assert.equal(await prisma.emailQueue.count({
      where: {
        tenantId,
        type: "BOOKING_CONTRACT",
        meta: { path: ["contractDeliveryId"], equals: request.deliveryId }
      }
    }), 1);
  });

  it("replays after a lost acknowledgement without creating another outbox item", async () => {
    const controller = controllerWithQueue();
    const idempotencyKey = `${runId}-lost-ack`;
    const first = await send(controller, bookingAId, idempotencyKey);
    const retry = await send(controller, bookingAId, idempotencyKey);

    assert.equal(first.statusCode, 201);
    assert.equal(retry.statusCode, 200);
    assert.equal(retry.headers["idempotency-replayed"], "true");
    assert.equal((retry.body as { deliveryId: string }).deliveryId, (first.body as { deliveryId: string }).deliveryId);
    assert.equal(await prisma.bookingContractEmailRequest.count({ where: { tenantId, idempotencyKey } }), 1);
  });

  it("rejects the same tenant key for changed payload or another contract", async () => {
    const controller = controllerWithQueue();
    const idempotencyKey = `${runId}-mismatch`;
    await send(controller, bookingAId, idempotencyKey, { subject: "Oggetto originale" });

    for (const attempt of [
      () => send(controller, bookingAId, idempotencyKey, { subject: "Oggetto modificato" }),
      () => send(controller, bookingBId, idempotencyKey, { subject: "Oggetto originale" })
    ]) {
      await assert.rejects(attempt, (error: unknown) => {
        assert.ok(error instanceof AppError);
        assert.equal((error as AppError).statusCode, 409);
        assert.equal((error as AppError).code, "IDEMPOTENCY_KEY_REUSED");
        return true;
      });
    }

    const persisted = await prisma.bookingContractEmailRequest.findUniqueOrThrow({
      where: { tenantId_idempotencyKey: { tenantId, idempotencyKey } },
      include: { delivery: true }
    });
    assert.equal(persisted.delivery.contractId, contractAId);
    assert.notEqual(persisted.delivery.contractId, contractBId);
  });

  it("rolls delivery back when enqueue fails and accepts a safe retry", async () => {
    const idempotencyKey = `${runId}-enqueue-rollback`;
    const before = {
      deliveries: await prisma.bookingContractDelivery.count({ where: { tenantId } }),
      queues: await prisma.emailQueue.count({ where: { tenantId } }),
      requests: await prisma.bookingContractEmailRequest.count({ where: { tenantId } })
    };

    await assert.rejects(
      () => send(controllerWithQueue({ failEnqueue: true }), bookingAId, idempotencyKey),
      /synthetic enqueue failure/
    );
    assert.deepEqual({
      deliveries: await prisma.bookingContractDelivery.count({ where: { tenantId } }),
      queues: await prisma.emailQueue.count({ where: { tenantId } }),
      requests: await prisma.bookingContractEmailRequest.count({ where: { tenantId } })
    }, before);

    const retry = await send(controllerWithQueue(), bookingAId, idempotencyKey);
    assert.equal(retry.statusCode, 201);
    assert.deepEqual({
      deliveries: await prisma.bookingContractDelivery.count({ where: { tenantId } }),
      queues: await prisma.emailQueue.count({ where: { tenantId } }),
      requests: await prisma.bookingContractEmailRequest.count({ where: { tenantId } })
    }, {
      deliveries: before.deliveries + 1,
      queues: before.queues + 1,
      requests: before.requests + 1
    });
  });
});
