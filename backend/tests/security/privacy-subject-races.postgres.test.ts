import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";
import express from "express";
import { RentalBookingsController } from "../../src/interfaces/http/controllers/rental-bookings-controller.js";
import { AppError } from "../../src/shared/errors/app-error.js";
import { PrivacyComplianceService } from "../../src/application/services/privacy-compliance-service.js";
import { prisma } from "../../src/infrastructure/database/prisma/client.js";
import { storageProvider } from "../../src/infrastructure/storage/storage-provider.js";
import { uploadsRoutes } from "../../src/interfaces/http/routes/uploads-routes.js";
import { env } from "../../src/shared/config/env.js";

const marker = `privacy-subject-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const tenantIds: string[] = [];
const physicalKeys = new Set<string>();
const originalTransaction = prisma.$transaction.bind(prisma);
const originalCustomerFindFirst = prisma.rentalCustomer.findFirst.bind(prisma);
const originalWrite = storageProvider.writeNewFromFile.bind(storageProvider);
const originalDelete = storageProvider.delete.bind(storageProvider);
const barrier = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
};
const bounded = async <T>(promise: Promise<T>, label: string): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([promise, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`Timed out waiting for ${label}`)), 4500);
    })]);
  } finally { if (timer) clearTimeout(timer); }
};
let server: http.Server;
let base: string;
let databaseHarnessStarted = false;
const service = new PrivacyComplianceService();
const fixture = async () => {
  const tenant = await prisma.tenant.create({ data: { name: marker } });
  tenantIds.push(tenant.id);
  const user = await prisma.user.create({ data: {
    tenantId: tenant.id, firstName: "Synthetic", lastName: "User",
    email: `${tenant.id}@example.test`, passwordHash: "synthetic-unused-hash"
  } });
  const customer = await prisma.rentalCustomer.create({ data: {
    tenantId: tenant.id, firstName: "Synthetic", lastName: "Subject", email: "shared@example.test", drivingLicenseNumber: "SYNTHETIC-123"
  } });
  return { tenant, user, customer };
};
type Fixture = Awaited<ReturnType<typeof fixture>>;
const anonymize = (f: Fixture, deleteAttachments = true) => service.anonymizeCustomer({
  tenantId: f.tenant.id, userId: f.user.id, customerId: f.customer.id,
  confirmation: "ANONYMIZE_CUSTOMER", legalBasis: "Synthetic verified request", deleteAttachments
});
const upload = async (f: Fixture, customerId = f.customer.id) => {
  const form = new FormData();
  form.append("files", new Blob(["%PDF-1.7\nSynthetic privacy attachment\n%%EOF"], { type: "application/pdf" }), "synthetic.pdf");
  return fetch(`${base}/rental-customers/${customerId}/attachments`, {
    method: "POST", body: form,
    headers: { "x-synthetic-tenant": f.tenant.id, "x-synthetic-user": f.user.id },
    signal: AbortSignal.timeout(10000)
  });
};
const download = async (f: Fixture, id: string) => fetch(`${base}/rental-customer-attachments/${id}/file`, {
  headers: { "x-synthetic-tenant": f.tenant.id, "x-synthetic-user": f.user.id }
});

describe("privacy subject export and attachment commit races on temporary PostgreSQL", { concurrency: false }, () => {
  before(async () => {
    assert.equal(process.env.NODE_ENV, "test");
    assert.equal(process.env.RUN_TENANT_ISOLATION_TESTS, "1", "Run only through the temporary database gate");
    const database = new URL(env.DATABASE_URL);
    assert.ok(["postgres:", "postgresql:"].includes(database.protocol));
    assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(database.hostname), "Database must be loopback only");
    assert.equal(database.pathname, "/fleetum_ci", "Database must be the gate's synthetic fleetum_ci database");
    assert.equal(storageProvider.name, "local");
    assert.match(env.UPLOAD_DIR, /^(?:\/private\/tmp|\/tmp|\/private\/var\/folders)\//, "Use a temporary synthetic storage directory");
    await prisma.$connect();
    databaseHarnessStarted = true;
    const app = express();
    app.use((req, _res, next) => {
      const tenantId = String(req.headers["x-synthetic-tenant"] ?? "");
      assert.ok(tenantIds.includes(tenantId), "Only this suite's synthetic tenants may reach the harness");
      req.auth = { tenantId, userId: String(req.headers["x-synthetic-user"]), roles: ["ADMIN"], permissions: ["vehicles:write", "vehicles:read"] } as any;
      next();
    });
    app.use(uploadsRoutes());
    app.use((error: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      res.status(error.statusCode ?? 500).json({ code: error.code ?? "ERROR" });
    });
    server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    storageProvider.writeNewFromFile = async (key, path, metadata) => {
      physicalKeys.add(key);
      await originalWrite(key, path, metadata);
    };
  });
  after(async () => {
    (prisma as any).$transaction = originalTransaction;
    (prisma.rentalCustomer as any).findFirst = originalCustomerFindFirst;
    storageProvider.writeNewFromFile = originalWrite;
    storageProvider.delete = originalDelete;
    if (server) await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    if (!databaseHarnessStarted) return;
    for (const key of physicalKeys) await originalDelete(key);
    const own = { in: tenantIds };
    await prisma.emailQueue.deleteMany({ where: { tenantId: own } });
    await prisma.bookingContractDelivery.deleteMany({ where: { tenantId: own } });
    await prisma.bookingContract.deleteMany({ where: { tenantId: own } });
    await prisma.rentalCustomerAttachment.deleteMany({ where: { tenantId: own } });
    await prisma.storedFileObject.deleteMany({ where: { tenantId: own } });
    await prisma.rentalBooking.deleteMany({ where: { tenantId: own } });
    await prisma.rentalCustomer.deleteMany({ where: { tenantId: own } });
    await prisma.vehicle.deleteMany({ where: { tenantId: own } });
    await prisma.site.deleteMany({ where: { tenantId: own } });
    await prisma.auditLog.deleteMany({ where: { tenantId: own } });
    await prisma.user.deleteMany({ where: { tenantId: own } });
    await prisma.tenant.deleteMany({ where: { id: own } });
    await prisma.$disconnect();
  });

  it("shared customer/user/internal addresses do not export credentials or other subjects' mail", async () => {
    const a = await fixture();
    const b = await fixture();
    const other = await prisma.rentalCustomer.create({ data: {
      tenantId: a.tenant.id, firstName: "Other", lastName: "Subject", email: a.customer.email
    } });
    await prisma.user.update({ where: { id: a.user.id }, data: { email: `${marker}-shared@example.test` } });
    await prisma.rentalCustomer.update({ where: { id: a.customer.id }, data: { email: `${marker}-shared@example.test` } });
    await prisma.rentalCustomer.update({ where: { id: other.id }, data: { email: `${marker}-shared@example.test` } });
    const site = await prisma.site.create({ data: { tenantId: a.tenant.id, name: marker, address: "Synthetic", city: "Synthetic" } });
    const vehicle = await prisma.vehicle.create({ data: { tenantId: a.tenant.id, siteId: site.id, plate: marker, brand: "Test", model: "Test" } });
    const document = async (customerId: string) => {
      const booking = await prisma.rentalBooking.create({ data: {
        tenantId: a.tenant.id, customerId, vehicleId: vehicle.id, code: `${marker}-${customerId}`,
        customerName: "Synthetic", customerEmail: `${marker}-shared@example.test`,
        pickupAt: new Date("2032-01-01T00:00:00Z"), returnAt: new Date("2032-01-02T00:00:00Z")
      } });
      const contract = await prisma.bookingContract.create({ data: { tenantId: a.tenant.id, bookingId: booking.id, title: "Synthetic", content: "Synthetic" } });
      const delivery = await prisma.bookingContractDelivery.create({ data: {
        tenantId: a.tenant.id, bookingId: booking.id, contractId: contract.id,
        recipient: "internal@example.test", subject: "Synthetic contract", body: "Synthetic customer contract"
      } });
      return { bookingId: booking.id, contractId: contract.id, contractDeliveryId: delivery.id };
    };
    const ownMeta = await document(a.customer.id);
    const otherMeta = await document(other.id);
    const createMail = (type: string, body: string, meta?: Record<string, string>, tenantId = a.tenant.id, recipient = `${marker}-shared@example.test`) => prisma.emailQueue.create({
      data: { tenantId, type, recipient, subject: `Subject ${body}`, body, meta, lastError: `Error ${body}` }
    });
    const ownQueue = await createMail("BOOKING_CONTRACT", "RAW_OWN_QUEUE_BODY", ownMeta);
    await createMail("BOOKING_CONTRACT", "UNRELATED_SHARED_MAIL", otherMeta);
    await createMail("BOOKING_CONTRACT", "UNRELATED_INTERNAL_MAIL", otherMeta, a.tenant.id, "internal@example.test");
    await createMail("BOOKING_CONTRACT", "FOREIGN_TENANT_MAIL", ownMeta, b.tenant.id);
    await createMail("PASSWORD_RESET", "RESET_SECRET_SENTINEL", ownMeta);
    await createMail("USER_INVITATION", "INVITE_SECRET_SENTINEL", ownMeta);
    await createMail("BOOKING_CONTRACT", "AMBIGUOUS_UNLINKED_MAIL");
    await createMail("BOOKING_CONTRACT", "CONFLICTING_LINKED_MAIL", { ...ownMeta, contractDeliveryId: otherMeta.contractDeliveryId });
    const result = await service.exportCustomerData({ tenantId: a.tenant.id, userId: a.user.id, customerId: a.customer.id });
    assert.deepEqual(result.data.communications.emailQueue.map((mail) => mail.id), [ownQueue.id]);
    const serialized = JSON.stringify(result);
    for (const sentinel of ["RAW_OWN_QUEUE_BODY", "UNRELATED_SHARED_MAIL", "UNRELATED_INTERNAL_MAIL", "FOREIGN_TENANT_MAIL", "RESET_SECRET_SENTINEL", "INVITE_SECRET_SENTINEL", "AMBIGUOUS_UNLINKED_MAIL", "CONFLICTING_LINKED_MAIL"]) {
      assert.equal(serialized.includes(sentinel), false, `${sentinel} must remain outside the subject export`);
    }
    assert.ok(result.securityExclusions);
  });

  for (const cleanupFails of [false, true]) {
    it(`anonymization wins after upload precheck: late commit rejected; compensation ${cleanupFails ? "is durably retryable" : "removes the file"}`, async () => {
      const f = await fixture();
      const written = barrier();
      const resume = barrier();
      let newKey = "";
      storageProvider.writeNewFromFile = async (key, path, metadata) => {
        physicalKeys.add(key);
        await originalWrite(key, path, metadata);
        newKey = key;
        written.resolve();
        await bounded(resume.promise, "release late upload");
      };
      if (cleanupFails) storageProvider.delete = async () => { throw new Error("Synthetic storage outage"); };
      const pending = upload(f);
      try {
        await bounded(written.promise, "physical write after ownership precheck");
        await anonymize(f);
        resume.resolve();
        const response = await pending;
        assert.equal(response.status, 404);
        assert.equal((await response.json() as any).code, "CUSTOMER_NOT_FOUND");
        assert.equal(await prisma.rentalCustomerAttachment.count({ where: { tenantId: f.tenant.id, customerId: f.customer.id } }), 0);
        assert.equal(await prisma.storedFileObject.count({ where: { tenantId: f.tenant.id, deletedAt: null } }), 0);
        const tombstones = await prisma.storedFileObject.findMany({ where: { tenantId: f.tenant.id } });
        assert.equal(tombstones.length, cleanupFails ? 1 : 0);
        if (cleanupFails) {
          assert.equal(tombstones[0].storageKey, newKey);
          assert.ok(tombstones[0].deletedAt);
          assert.equal(tombstones[0].resourceId, f.customer.id);
        }
        assert.equal(await storageProvider.exists(newKey), cleanupFails);
      } finally {
        resume.resolve();
        await pending.catch(() => undefined);
        storageProvider.delete = originalDelete;
        storageProvider.writeNewFromFile = async (key, path, metadata) => { physicalKeys.add(key); await originalWrite(key, path, metadata); };
      }
    });
  }

  it("upload wins before erasure transaction: every removed relationship receives a storage tombstone", async () => {
    const f = await fixture();
    const sibling = await prisma.rentalCustomer.create({ data: { tenantId: f.tenant.id, firstName: "Sibling", lastName: "Subject" } });
    assert.equal((await upload(f, sibling.id)).status, 201);
    const siblingAttachment = await prisma.rentalCustomerAttachment.findFirstOrThrow({ where: { tenantId: f.tenant.id, customerId: sibling.id } });
    const entered = barrier();
    const resume = barrier();
    let captured = false;
    (prisma as any).$transaction = async (...args: any[]) => {
      if (!captured) { captured = true; entered.resolve(); await bounded(resume.promise, "release erasure transaction"); }
      return (originalTransaction as any)(...args);
    };
    const pending = anonymize(f);
    try {
      await bounded(entered.promise, "erasure transaction start");
      assert.equal((await upload(f)).status, 201);
      const attachment = await prisma.rentalCustomerAttachment.findFirstOrThrow({ where: { tenantId: f.tenant.id, customerId: f.customer.id } });
      storageProvider.delete = async (key) => { if (key === attachment.filePath) throw new Error("Synthetic deletion outage"); await originalDelete(key); };
      resume.resolve();
      assert.equal((await pending).attachmentsDeleted, 1);
      assert.equal(await prisma.rentalCustomerAttachment.count({ where: { tenantId: f.tenant.id, customerId: f.customer.id } }), 0);
      const metadata = await prisma.storedFileObject.findFirstOrThrow({ where: { tenantId: f.tenant.id, storageKey: attachment.filePath } });
      assert.ok(metadata.deletedAt, "A physical failure must retain a tombstone for retry");
      assert.equal(await storageProvider.exists(attachment.filePath), true);
      assert.equal((await download(f, attachment.id)).status, 404);
      assert.equal((await download(f, siblingAttachment.id)).status, 200);
      assert.equal((await prisma.storedFileObject.findFirstOrThrow({ where: { tenantId: f.tenant.id, storageKey: siblingAttachment.filePath } })).deletedAt, null);
    } finally { resume.resolve(); await pending.catch(() => undefined); (prisma as any).$transaction = originalTransaction; storageProvider.delete = originalDelete; }
  });

  it("erasure wins before a pending customer edit: no PII can be reintroduced", async () => {
    const f = await fixture();
    const entered = barrier();
    const resume = barrier();
    let captured = false;
    const pauseFirstBoundary = async () => {
      if (!captured) { captured = true; entered.resolve(); await bounded(resume.promise, "release pending customer edit"); }
    };
    // On the historical controller this pauses the active precheck after its
    // read. On the fenced controller it pauses before the transaction lock.
    (prisma.rentalCustomer as any).findFirst = async (args: any) => {
      const observed = await originalCustomerFindFirst(args);
      await pauseFirstBoundary();
      return observed;
    };
    (prisma as any).$transaction = async (...args: any[]) => {
      await pauseFirstBoundary();
      return (originalTransaction as any)(...args);
    };
    const controller = new RentalBookingsController({ enqueue: async () => assert.fail("No provider/email") } as any);
    let response: unknown;
    const pending = controller.updateCustomer({ auth: { tenantId: f.tenant.id }, params: { customerId: f.customer.id },
      body: { email: "late-restored@example.test", firstName: "Late synthetic" }
    } as any, { json: (value: unknown) => { response = value; } } as any)
      .then(() => ({ error: undefined as unknown }), (error: unknown) => ({ error }));
    try {
      await bounded(entered.promise, "customer edit boundary before write");
      await anonymize(f);
      resume.resolve();
      const outcome = await pending;
      assert.ok(outcome.error instanceof AppError);
      assert.equal(outcome.error.code, "CUSTOMER_NOT_FOUND");
      assert.equal(outcome.error.statusCode, 404);
      assert.equal(response, undefined, "An erased subject cannot be returned by the pending edit");
      const erased = await prisma.rentalCustomer.findUniqueOrThrow({ where: { id: f.customer.id } });
      assert.ok(erased.deletedAt);
      assert.equal(erased.email, null);
      assert.equal(erased.firstName, "Cliente");
      assert.equal(erased.drivingLicenseNumber, "");
    } finally {
      resume.resolve(); await pending;
      (prisma as any).$transaction = originalTransaction;
      (prisma.rentalCustomer as any).findFirst = originalCustomerFindFirst;
    }
  });

  it("a legitimate customer edit completed before erasure is accepted and its PII is subsequently erased", async () => {
    const f = await fixture();
    const entered = barrier();
    const resume = barrier();
    let captured = false;
    (prisma as any).$transaction = async (...args: any[]) => {
      if (!captured) { captured = true; entered.resolve(); await bounded(resume.promise, "release customer erasure"); }
      return (originalTransaction as any)(...args);
    };
    const pending = anonymize(f);
    try {
      await bounded(entered.promise, "erasure boundary before lock");
      const controller = new RentalBookingsController({ enqueue: async () => assert.fail("No provider/email") } as any);
      let response: any;
      await controller.updateCustomer({ auth: { tenantId: f.tenant.id }, params: { customerId: f.customer.id },
        body: { email: "updated-before-erasure@example.test", firstName: "Updated synthetic" }
      } as any, { json: (value: unknown) => { response = value; } } as any);
      assert.equal(response.email, "updated-before-erasure@example.test");
      assert.equal(response.firstName, "Updated synthetic");
      assert.equal((await prisma.rentalCustomer.findUniqueOrThrow({ where: { id: f.customer.id } })).deletedAt, null);
      resume.resolve();
      await pending;
      const erased = await prisma.rentalCustomer.findUniqueOrThrow({ where: { id: f.customer.id } });
      assert.ok(erased.deletedAt);
      assert.equal(erased.email, null);
      assert.equal(erased.firstName, "Cliente");
      assert.equal(erased.drivingLicenseNumber, "");
    } finally { resume.resolve(); await pending.catch(() => undefined); (prisma as any).$transaction = originalTransaction; }
  });

  it("explicit deleteAttachments=false preserves existing files while preventing new uploads", async () => {
    const f = await fixture();
    assert.equal((await upload(f)).status, 201);
    const attachment = await prisma.rentalCustomerAttachment.findFirstOrThrow({ where: { tenantId: f.tenant.id, customerId: f.customer.id } });
    assert.equal((await anonymize(f, false)).attachmentsDeleted, 0);
    assert.equal((await download(f, attachment.id)).status, 200);
    assert.equal((await upload(f)).status, 404);
    assert.equal((await prisma.storedFileObject.findFirstOrThrow({ where: { tenantId: f.tenant.id, storageKey: attachment.filePath } })).deletedAt, null);
  });
});
