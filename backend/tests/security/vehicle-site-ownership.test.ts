import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { after, afterEach, before, describe, it } from "node:test";
import express from "express";
import { ManageVehiclesUseCases } from "../../src/application/usecases/vehicles/manage-vehicles-usecases.js";
import { ImportMasterDataUseCase } from "../../src/application/usecases/master-data/import-master-data-usecase.js";
import { SendReminderUseCase } from "../../src/application/usecases/reminders/send-reminder-usecase.js";
import { VehicleProfitabilityReportService } from "../../src/application/services/vehicle-profitability-report-service.js";
import { PrivacyComplianceService } from "../../src/application/services/privacy-compliance-service.js";
import { LicensePolicyService } from "../../src/application/services/license-policy-service.js";
import { GetDashboardStatsUseCase } from "../../src/application/usecases/stats/get-dashboard-stats-usecase.js";
import { prisma } from "../../src/infrastructure/database/prisma/client.js";
import { runReportsCronCycle } from "../../src/infrastructure/cron/reports-cron.js";
import { EmailQueueService } from "../../src/infrastructure/email/email-queue-service.js";
import { emailSender } from "../../src/infrastructure/email/email-sender.js";
import { PrismaNotificationsRepository } from "../../src/infrastructure/repositories/prisma-notifications-repository.js";
import { PrismaReminderRepository } from "../../src/infrastructure/repositories/prisma-reminder-repository.js";
import { PrismaSiteRepository } from "../../src/infrastructure/repositories/prisma-site-repository.js";
import { PrismaStoppageOpsRepository } from "../../src/infrastructure/repositories/prisma-stoppage-ops-repository.js";
import { PrismaStoppageRepository } from "../../src/infrastructure/repositories/prisma-stoppage-repository.js";
import { PrismaVehicleRepository } from "../../src/infrastructure/repositories/prisma-vehicle-repository.js";
import { PrismaAuditLogRepository } from "../../src/infrastructure/repositories/prisma-audit-log-repository.js";
import { storageProvider } from "../../src/infrastructure/storage/storage-provider.js";
import { MasterDataController } from "../../src/interfaces/http/controllers/master-data-controller.js";
import { RentalBookingsController } from "../../src/interfaces/http/controllers/rental-bookings-controller.js";
import { RentalPricingController } from "../../src/interfaces/http/controllers/rental-pricing-controller.js";
import { uploadsRoutes } from "../../src/interfaces/http/routes/uploads-routes.js";

const runId = `vehicle-site-owner-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const tenantIds: string[] = [];
const vehicles = new PrismaVehicleRepository();
const sites = new PrismaSiteRepository();
const useCases = new ManageVehiclesUseCases(vehicles);
const importer = new ImportMasterDataUseCase();
const stoppages = new PrismaStoppageRepository();
const ops = new PrismaStoppageOpsRepository();
const notifications = new PrismaNotificationsRepository();
const originalSend = emailSender.send;
const dayMs = 86_400_000;
let sequence = 0;
let uploadServer: http.Server;
let uploadBaseUrl = "";
const response = () => ({
  statusCode: 200, body: undefined as any,
  status(code: number) { this.statusCode = code; return this; },
  json(body: unknown) { this.body = body; return this; },
  send(body?: unknown) { this.body = body; return this; },
  setHeader() { return this; }
});
const request = (a: Fixture, id = "", body: Record<string, unknown> = {}, query: Record<string, unknown> = {}) => ({
  auth: { tenantId: a.tenant.id, userId: a.user.id, roles: ["ADMIN"], permissions: ["vehicles:read", "vehicles:write"] },
  params: { id }, body, query
} as any);
const bookingController = () => new RentalBookingsController();
const masterController = () => new MasterDataController({} as any, {} as any, useCases, importer);

const fixture = async (suffix: string) => {
  const marker = `SYNTHETIC_${suffix.toUpperCase()}_${sequence++}`;
  const tenant = await prisma.tenant.create({ data: { id: `${runId}-${suffix}-${sequence}`, name: marker } });
  tenantIds.push(tenant.id);
  const site = await prisma.site.create({ data: { tenantId: tenant.id, name: `${marker}_SITE`, address: "Synthetic", city: "Synthetic" } });
  const vehicle = await prisma.vehicle.create({ data: {
    tenantId: tenant.id, siteId: site.id, plate: `${marker}_PLATE`, brand: marker, model: `${marker}_MODEL`, revisionDueAt: new Date()
  } });
  const user = await prisma.user.create({ data: {
    tenantId: tenant.id, email: `${suffix}-${sequence}@example.test`, passwordHash: "synthetic-unused-hash", firstName: marker, lastName: "Synthetic"
  } });
  const workshop = await prisma.workshop.create({ data: {
    tenantId: tenant.id, name: `${marker}_WORKSHOP`, email: `${suffix}-${sequence}-workshop@example.test`
  } });
  return { tenant, site, vehicle, user, workshop, marker };
};
type Fixture = Awaited<ReturnType<typeof fixture>>;
const pair = async () => ({ a: await fixture("owner-a"), b: await fixture("foreign-b") });
const createInput = (a: Fixture): Record<string, unknown> => ({
  siteId: a.site.id, plate: `SYNTHETIC_NEW_${sequence++}`, brand: "Synthetic", model: "Synthetic"
});
const csv = (count = 1) => Buffer.from(`plate,brand,model\n${Array.from({ length: count }, () => `SYNTHETIC_IMPORT_${sequence++},Synthetic,Synthetic`).join("\n")}\n`);
const assert4xx = async (work: () => Promise<unknown>) => {
  await assert.rejects(work, (error: unknown) => {
    assert.ok(error instanceof Error);
    const status = (error as any).statusCode;
    assert.ok(Number.isInteger(status) && status >= 400 && status < 500, `expected explicit 4xx, got ${String(status)}`);
    return true;
  });
};
const snapshot = async () => {
  const own = { in: [...tenantIds] };
  return JSON.stringify({
    sites: await prisma.site.findMany({ where: { tenantId: own }, orderBy: { id: "asc" } }),
    vehicles: await prisma.vehicle.findMany({ where: { tenantId: own }, orderBy: { id: "asc" } }),
    bookings: await prisma.rentalBooking.findMany({ where: { tenantId: own }, orderBy: { id: "asc" } }),
    pricingSnapshots: await prisma.rentalBookingPricingSnapshot.findMany({ where: { tenantId: own }, orderBy: { id: "asc" } }),
    bookingNotes: await prisma.rentalBookingNote.findMany({ where: { tenantId: own }, orderBy: { id: "asc" } }),
    maintenances: await prisma.vehicleMaintenance.findMany({ where: { tenantId: own }, orderBy: { id: "asc" } }),
    priceLists: await prisma.rentalPriceList.findMany({ where: { tenantId: own }, orderBy: { id: "asc" } }),
    photos: await prisma.vehiclePhoto.findMany({ where: { vehicle: { tenantId: own } }, orderBy: { id: "asc" } }),
    booklets: await prisma.vehicleBooklet.findMany({ where: { tenantId: own }, orderBy: { id: "asc" } }),
    maintenanceAttachments: await prisma.vehicleMaintenanceAttachment.findMany({ where: { tenantId: own }, orderBy: { id: "asc" } }),
    audits: await prisma.auditLog.findMany({ where: { tenantId: own }, orderBy: { id: "asc" } }),
    stoppages: await prisma.stoppage.findMany({ where: { tenantId: own }, orderBy: { id: "asc" } }),
    events: await prisma.stoppageEvent.findMany({ where: { tenantId: own }, orderBy: { id: "asc" } }),
    reminders: await prisma.reminder.findMany({ where: { tenantId: own }, orderBy: { id: "asc" } }),
    queued: await prisma.emailQueue.findMany({ where: { tenantId: own }, orderBy: { id: "asc" } })
  });
};
const assertNoMutation = async (work: () => Promise<unknown>) => {
  const initial = await snapshot();
  await assert4xx(work);
  assert.equal(await snapshot(), initial, "denial must not change either tenant or persist side effects");
};
const corruptVehicle = async (a: Fixture, b: Fixture) => prisma.vehicle.create({ data: {
  tenantId: a.tenant.id, siteId: b.site.id, plate: `${b.marker}_CORRUPT_${sequence++}`, brand: b.marker, model: "Synthetic legacy", revisionDueAt: new Date()
} });
const createStoppage = async (a: Fixture, vehicleId = a.vehicle.id, siteId = a.site.id) => prisma.stoppage.create({ data: {
  tenantId: a.tenant.id, siteId, vehicleId, workshopId: a.workshop.id, createdByUserId: a.user.id,
  assignedToUserId: a.user.id, reason: `Synthetic site ownership ${sequence++}`, openedAt: new Date(Date.now() - 3 * dayMs),
  reminderAfterDays: 1, workshopEmailSnapshot: a.workshop.email
} });
const bookingFixture = async () => {
  const { a, b } = await pair();
  const invalidVehicle = await corruptVehicle(a, b);
  const customer = await prisma.rentalCustomer.create({ data: { tenantId: a.tenant.id, firstName: "Synthetic", lastName: "Customer" } });
  const pickupAt = new Date(Date.now() + dayMs);
  const returnAt = new Date(Date.now() + 2 * dayMs);
  const valid = await prisma.rentalBooking.create({ data: {
    tenantId: a.tenant.id, vehicleId: a.vehicle.id, customerId: customer.id, createdByUserId: a.user.id,
    code: `SYNTHETIC_BOOKING_${sequence++}`, customerName: "Synthetic Customer", status: "CONFIRMED", pickupAt, returnAt
  } });
  const invalid = await prisma.rentalBooking.create({ data: {
    tenantId: a.tenant.id, vehicleId: invalidVehicle.id, customerId: customer.id, createdByUserId: a.user.id,
    code: `${b.marker}_BOOKING_${sequence++}`, customerName: `${b.marker}_CUSTOMER`, status: "CONFIRMED", pickupAt: new Date(pickupAt.getTime() + 60_000), returnAt
  } });
  const contract = await prisma.bookingContract.create({ data: {
    tenantId: a.tenant.id, bookingId: valid.id, title: "Synthetic owned contract", content: "Synthetic", status: "READY"
  } });
  const invalidContract = await prisma.bookingContract.create({ data: {
    tenantId: a.tenant.id, bookingId: invalid.id, title: b.marker, content: b.marker, status: "READY"
  } });
  return { a, b, invalidVehicle, customer, valid, invalid, contract, invalidContract };
};
const pricingFixture = async (suffix: string) => {
  const a = await fixture(suffix);
  await prisma.vehicle.update({ where: { id: a.vehicle.id }, data: { currentKm: 1000 } });
  const pickupAt = new Date("2027-03-10T08:00:00.000Z");
  const booking = await prisma.rentalBooking.create({ data: {
    tenantId: a.tenant.id, vehicleId: a.vehicle.id, createdByUserId: a.user.id,
    code: `SYNTHETIC_CLOSE_PRICE_${sequence++}`, customerName: "Synthetic Pricing", status: "IN_RENT",
    pickupAt, returnAt: new Date(pickupAt.getTime() + 2 * dayMs), pickupKm: 1000, returnKm: 1120
  } });
  const priceList = await prisma.rentalPriceList.create({ data: {
    tenantId: a.tenant.id, name: "Synthetic agreed price", baseRateUnit: "DAILY", baseRateAmount: 50, vatRate: 0, discountPercent: 0
  } });
  await bookingController().updatePricing(request(a, booking.id, { priceListId: priceList.id, estimatedKm: 100 }), response() as any);
  return { a, booking, priceList };
};
const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
};
const waitBounded = async <T>(promise: Promise<T>, label: string, timeoutMs = 3500): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([promise, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`Timed out waiting for ${label}`)), timeoutMs);
    })]);
  } finally { if (timer) clearTimeout(timer); }
};
const withStorageProbe = async (work: (calls: string[]) => Promise<void>) => {
  const originalExists = storageProvider.exists;
  const originalRead = storageProvider.read;
  const originalDelete = storageProvider.delete;
  const calls: string[] = [];
  storageProvider.exists = async () => { calls.push("exists"); return true; };
  storageProvider.read = async () => { calls.push("read"); return Buffer.from("Synthetic file contents"); };
  storageProvider.delete = async () => { calls.push("delete"); };
  try { await work(calls); }
  finally { storageProvider.exists = originalExists; storageProvider.read = originalRead; storageProvider.delete = originalDelete; }
};
const uploadRequest = async (a: Fixture, route: string, method = "GET") => fetch(`${uploadBaseUrl}${route}`, {
  method, headers: { "x-synthetic-tenant": a.tenant.id, "x-synthetic-user": a.user.id }
});

describe("vehicle site ownership at write boundaries and legacy projections", { concurrency: false }, () => {
  before(async () => {
    await prisma.$connect();
    const app = express();
    // Exercise the real upload router and its permission guards. The synthetic
    // identity is injected at this isolated boundary; the existing full HTTP
    // integration suite covers authentication/CSRF separately.
    app.use((req, _res, next) => {
      const tenantId = String(req.headers["x-synthetic-tenant"] ?? "");
      assert.ok(tenantIds.includes(tenantId), "HTTP harness accepts only this suite's synthetic tenants");
      req.auth = { tenantId, userId: String(req.headers["x-synthetic-user"]), roles: ["ADMIN"], permissions: ["vehicles:read", "vehicles:write"] } as any;
      next();
    });
    app.use(uploadsRoutes());
    app.use((error: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      res.status(Number(error.statusCode) || 500).json({ code: error.code ?? "ERROR" });
    });
    uploadServer = http.createServer(app);
    await new Promise<void>((resolve) => { uploadServer.listen(0, "127.0.0.1", resolve); });
    uploadBaseUrl = `http://127.0.0.1:${(uploadServer.address() as AddressInfo).port}`;
  });
  afterEach(async () => {
    emailSender.send = originalSend;
    const own = { in: [...tenantIds] };
    await prisma.emailQueue.deleteMany({ where: { tenantId: own } });
    await prisma.reminder.deleteMany({ where: { OR: [{ tenantId: own }, { stoppage: { tenantId: own } }] } });
    await prisma.stoppageEvent.deleteMany({ where: { OR: [{ tenantId: own }, { stoppage: { tenantId: own } }] } });
    await prisma.stoppagePhoto.deleteMany({ where: { stoppage: { tenantId: own } } });
    await prisma.stoppage.deleteMany({ where: { tenantId: own } });
    await prisma.vehicleMaintenanceAttachment.deleteMany({ where: { tenantId: own } });
    await prisma.vehicleMaintenance.deleteMany({ where: { tenantId: own } });
    await prisma.vehiclePhoto.deleteMany({ where: { vehicle: { tenantId: own } } });
    await prisma.vehicleBooklet.deleteMany({ where: { tenantId: own } });
    await prisma.bookingContractDelivery.deleteMany({ where: { tenantId: own } });
    await prisma.bookingContract.deleteMany({ where: { tenantId: own } });
    await prisma.rentalBookingNote.deleteMany({ where: { tenantId: own } });
    await prisma.rentalBookingPricingSnapshot.deleteMany({ where: { tenantId: own } });
    await prisma.rentalBooking.deleteMany({ where: { tenantId: own } });
    await prisma.rentalCustomer.deleteMany({ where: { tenantId: own } });
    await prisma.rentalPriceList.deleteMany({ where: { tenantId: own } });
    await prisma.vehicle.deleteMany({ where: { tenantId: own } });
    await prisma.workshop.deleteMany({ where: { tenantId: own } });
    await prisma.site.deleteMany({ where: { tenantId: own } });
    await prisma.user.deleteMany({ where: { tenantId: own } });
    await prisma.tenantSubscription.deleteMany({ where: { tenantId: own } });
    await prisma.scheduledReportCursor.deleteMany({ where: { tenantId: own } });
    await prisma.auditLog.deleteMany({ where: { tenantId: own } });
    await prisma.tenant.deleteMany({ where: { id: { in: tenantIds.splice(0) } } });
  });
  after(async () => {
    if (uploadServer) await new Promise<void>((resolve, reject) => uploadServer.close((error) => error ? reject(error) : resolve()));
    await prisma.$disconnect();
  });

  for (const condition of ["foreign", "missing", "deleted"] as const) {
    for (const operation of ["create", "update"] as const) {
      for (const boundary of ["repository", "usecase"] as const) {
        it(`${boundary} ${operation} rejects a ${condition} site with no persisted mutation`, async () => {
          const { a, b } = await pair();
          const deleted = condition === "deleted" ? await prisma.site.create({ data: {
            tenantId: a.tenant.id, name: "Synthetic deleted site", address: "Synthetic", city: "Synthetic", deletedAt: new Date()
          } }) : null;
          const siteId = condition === "foreign" ? b.site.id : condition === "missing" ? `${runId}-missing-site` : deleted!.id;
          const input = operation === "create" ? { ...createInput(a), siteId } : { siteId, brand: "Must not persist" };
          const target = boundary === "repository" ? vehicles : useCases;
          await assertNoMutation(() => operation === "create" ? target.create(a.tenant.id, input) : target.update(a.tenant.id, a.vehicle.id, input));
        });
      }
    }
  }

  for (const operation of ["update", "delete"] as const) {
    for (const target of ["foreign", "missing", "corrupt"] as const) {
      it(`vehicle ${operation} rejects a ${target} target, including implicit legacy repair`, async () => {
        const { a, b } = await pair();
        const id = target === "foreign" ? b.vehicle.id : target === "missing" ? `${runId}-missing-vehicle` : (await corruptVehicle(a, b)).id;
        await assertNoMutation(() => operation === "update" ? vehicles.update(a.tenant.id, id, { siteId: a.site.id, brand: "Must not repair" }) : vehicles.delete(a.tenant.id, id));
      });
    }
  }

  for (const operation of ["create", "update"] as const) {
    it(`vehicle ${operation} permits an owned inactive site`, async () => {
      const a = await fixture(`inactive-${operation}`);
      await prisma.site.update({ where: { id: a.site.id }, data: { isActive: false } });
      const result = operation === "create" ? await useCases.create(a.tenant.id, createInput(a)) : await useCases.update(a.tenant.id, a.vehicle.id, { model: "Synthetic updated" });
      assert.equal((result as any).siteId, a.site.id);
      assert.equal((result as any).tenantId, a.tenant.id);
    });
  }

  it("owned historical soft-deleted sites remain readable, editable and deletable through the vehicle", async () => {
    const a = await fixture("historical-site");
    await sites.delete(a.tenant.id, a.site.id);
    const found = await vehicles.findById(a.tenant.id, a.vehicle.id) as any;
    assert.equal(found.site.id, a.site.id);
    assert.ok(found.site.deletedAt);
    assert.equal((await vehicles.list(a.tenant.id, { skip: 0, take: 100 })).total, 1);
    assert.equal((await useCases.update(a.tenant.id, a.vehicle.id, { currentKm: 12345 }) as any).currentKm, 12345);
    await vehicles.delete(a.tenant.id, a.vehicle.id);
    assert.ok((await prisma.vehicle.findUniqueOrThrow({ where: { id: a.vehicle.id } })).deletedAt);
  });

  for (const operation of ["create", "update"] as const) {
    for (const field of ["tenantId", "id", "createdAt", "updatedAt", "deletedAt"] as const) {
      it(`vehicle ${operation} rejects protected ${field}`, async () => {
        const { a, b } = await pair();
        const value = field === "tenantId" ? b.tenant.id : field === "id" ? `${runId}-injected-${sequence++}` : new Date();
        const input = { ...(operation === "create" ? createInput(a) : { model: "Must not persist" }), [field]: value };
        await assertNoMutation(() => operation === "create" ? vehicles.create(a.tenant.id, input) : vehicles.update(a.tenant.id, a.vehicle.id, input));
      });
    }
    it(`vehicle ${operation} rejects nested relation injection`, async () => {
      const { a, b } = await pair();
      const input = { ...(operation === "create" ? createInput(a) : {}), site: { connect: { id: b.site.id } } };
      await assertNoMutation(() => operation === "create" ? vehicles.create(a.tenant.id, input) : vehicles.update(a.tenant.id, a.vehicle.id, input));
    });
    it(`vehicle ${operation} rejects a Prisma scalar update operator`, async () => {
      const a = await fixture(`scalar-${operation}`);
      const input = { ...(operation === "create" ? createInput(a) : {}), currentKm: { increment: 999 } };
      await assertNoMutation(() => operation === "create" ? vehicles.create(a.tenant.id, input) : vehicles.update(a.tenant.id, a.vehicle.id, input));
    });
  }

  for (const operation of ["create", "update"] as const) {
    for (const field of ["tenantId", "id", "createdAt", "updatedAt", "deletedAt"] as const) {
      it(`site ${operation} rejects protected ${field}`, async () => {
        const { a, b } = await pair();
        const value = field === "tenantId" ? b.tenant.id : field === "id" ? `${runId}-injected-site-${sequence++}` : new Date();
        const input = { ...(operation === "create" ? { name: "Synthetic", address: "Synthetic", city: "Synthetic" } : { name: "Must not persist" }), [field]: value };
        await assertNoMutation(() => operation === "create" ? sites.create(a.tenant.id, input) : sites.update(a.tenant.id, a.site.id, input));
      });
    }
    it(`site ${operation} rejects nested vehicles relation injection`, async () => {
      const { a, b } = await pair();
      const input = { ...(operation === "create" ? { name: "Synthetic", address: "Synthetic", city: "Synthetic" } : {}), vehicles: { connect: { id: b.vehicle.id } } };
      await assertNoMutation(() => operation === "create" ? sites.create(a.tenant.id, input) : sites.update(a.tenant.id, a.site.id, input));
    });
    it(`site ${operation} rejects scalar field operator injection`, async () => {
      const a = await fixture(`site-operator-${operation}`);
      const input = { ...(operation === "create" ? { name: "Synthetic", address: "Synthetic", city: "Synthetic" } : {}), name: { set: "Must not persist" } };
      await assertNoMutation(() => operation === "create" ? sites.create(a.tenant.id, input) : sites.update(a.tenant.id, a.site.id, input));
    });
  }

  for (const condition of ["foreign", "missing", "deleted"] as const) {
    for (const dryRun of [true, false]) {
      it(`CSV ${dryRun ? "dry run" : "import"} rejects a ${condition} default site`, async () => {
        const { a, b } = await pair();
        if (condition === "deleted") await sites.delete(a.tenant.id, a.site.id);
        const siteId = condition === "foreign" ? b.site.id : condition === "missing" ? `${runId}-missing-import-site` : a.site.id;
        await assertNoMutation(() => importer.importVehicles(a.tenant.id, csv(2), dryRun, { defaultSiteId: siteId }));
      });
    }
  }

  for (const dryRun of [true, false]) {
    it(`CSV ${dryRun ? "dry run" : "import"} accepts an owned inactive default site`, async () => {
      const a = await fixture(`import-inactive-${dryRun}`);
      await prisma.site.update({ where: { id: a.site.id }, data: { isActive: false } });
      const result = await importer.importVehicles(a.tenant.id, csv(2), dryRun, { defaultSiteId: a.site.id });
      assert.equal(result.validRows, 2);
      assert.equal(result.inserted, dryRun ? 0 : 2);
      assert.deepEqual(result.errors, []);
      assert.equal(await prisma.vehicle.count({ where: { tenantId: a.tenant.id } }), dryRun ? 1 : 3);
    });
  }

  it("CSV import revalidates looked-up sites and rolls back the entire candidate batch", async () => {
    const a = await fixture("import-site-race");
    const other = await prisma.site.create({ data: { tenantId: a.tenant.id, name: "Synthetic import next", address: "Synthetic", city: "Synthetic" } });
    const delegate = prisma.site;
    const originalFind = delegate.findMany.bind(delegate);
    let transitioned = false;
    (delegate as any).findMany = async (args: Parameters<typeof originalFind>[0]) => {
      const rows = await originalFind(args);
      if (!transitioned && (args?.where as any)?.tenantId === a.tenant.id) {
        transitioned = true;
        await sites.delete(a.tenant.id, other.id);
      }
      return rows;
    };
    const file = Buffer.from(`plate,brand,model,site_name\nSYNTHETIC_BATCH_${sequence++},Synthetic,Synthetic,${a.site.name}\nSYNTHETIC_BATCH_${sequence++},Synthetic,Synthetic,${other.name}\n`);
    try {
      await assert4xx(() => importer.importVehicles(a.tenant.id, file, false));
      assert.equal(transitioned, true, "site deletion must occur after the lookup snapshot");
      assert.equal(await prisma.vehicle.count({ where: { tenantId: a.tenant.id } }), 1, "no earlier valid row in the batch may be inserted");
      assert.ok((await prisma.site.findUniqueOrThrow({ where: { id: other.id } })).deletedAt);
    } finally { (delegate as any).findMany = originalFind; }
  });

  it("vehicle list, counts and pagination exclude legacy vehicles whose site belongs to another tenant", async () => {
    const { a, b } = await pair();
    const invalid = await corruptVehicle(a, b);
    const listed = await vehicles.list(a.tenant.id, { skip: 0, take: 1 });
    assert.equal(listed.total, 1);
    assert.deepEqual(listed.data.map((row) => row.id), [a.vehicle.id]);
    assert.ok(!JSON.stringify(listed).includes(b.marker));
    const empty = await vehicles.list(a.tenant.id, { skip: 1, take: 1 });
    assert.equal(empty.total, 1);
    assert.deepEqual(empty.data, []);
    assert.equal(await vehicles.findById(a.tenant.id, invalid.id), null);
    assert.equal(await vehicles.findByPlate(a.tenant.id, invalid.plate), null);
  });

  it("search by foreign site name or city cannot expose or count a corrupt legacy vehicle", async () => {
    const { a, b } = await pair();
    await prisma.site.update({ where: { id: b.site.id }, data: { city: `${b.marker}_CITY` } });
    await corruptVehicle(a, b);
    for (const search of [b.site.name, `${b.marker}_CITY`, b.marker]) {
      const result = await vehicles.list(a.tenant.id, { search, skip: 0, take: 100 });
      assert.equal(result.total, 0);
      assert.deepEqual(result.data, []);
    }
  });

  for (const operation of ["create", "update"] as const) {
    for (const boundary of ["repository", "usecase"] as const) {
      it(`${boundary} ${operation} keeps a hidden corrupt legacy plate reserved without exposing that record`, async () => {
        const { a, b } = await pair();
        const invalid = await corruptVehicle(a, b);
        const input = operation === "create" ? { ...createInput(a), plate: invalid.plate } : { plate: invalid.plate };
        const target = boundary === "repository" ? vehicles : useCases;
        const initial = await snapshot();
        await assert.rejects(() => operation === "create" ? target.create(a.tenant.id, input) : target.update(a.tenant.id, a.vehicle.id, input), (error: any) => {
          assert.equal(error.statusCode, 409);
          assert.ok(!JSON.stringify(error).includes(invalid.id));
          assert.ok(!JSON.stringify(error).includes(b.marker));
          return true;
        });
        assert.equal(await snapshot(), initial);
      });
    }
  }

  it("CSV import skips a plate already reserved by a hidden corrupt legacy vehicle", async () => {
    const { a, b } = await pair();
    const invalid = await corruptVehicle(a, b);
    const initial = await snapshot();
    const result = await importer.importVehicles(a.tenant.id, Buffer.from(`plate,brand,model\n${invalid.plate},Synthetic,Synthetic\n`), false, { defaultSiteId: a.site.id });
    assert.equal(result.inserted, 0);
    assert.equal(result.validRows, 0);
    assert.ok(result.errors.some((error) => error.reason === "Targa gia esistente"));
    assert.equal(await snapshot(), initial);
  });

  it("vehicle projections exclude a legacy booklet child with a foreign tenant", async () => {
    const { a, b } = await pair();
    const invalid = await prisma.vehicleBooklet.create({ data: {
      tenantId: b.tenant.id, vehicleId: a.vehicle.id, filePath: `synthetic/${b.marker}.pdf`, fileName: `${b.marker}.pdf`, mimeType: "application/pdf", sizeBytes: 16
    } });
    const projections = [
      (await vehicles.list(a.tenant.id, { skip: 0, take: 100 })).data[0],
      await vehicles.findById(a.tenant.id, a.vehicle.id),
      await vehicles.findByPlate(a.tenant.id, a.vehicle.plate),
      await vehicles.update(a.tenant.id, a.vehicle.id, { notes: "Synthetic valid partial update" })
    ];
    for (const projection of projections) {
      assert.equal((projection as any).booklet, null);
      assert.ok(!JSON.stringify(projection).includes(invalid.id));
      assert.ok(!JSON.stringify(projection).includes(b.marker));
    }
  });

  it("vehicle projections preserve an owned historical booklet after site soft deletion", async () => {
    const a = await fixture("owned-booklet-history");
    const booklet = await prisma.vehicleBooklet.create({ data: {
      tenantId: a.tenant.id, vehicleId: a.vehicle.id, filePath: `synthetic/${a.marker}.pdf`, fileName: "synthetic.pdf", mimeType: "application/pdf", sizeBytes: 16
    } });
    await prisma.site.update({ where: { id: a.site.id }, data: { deletedAt: new Date(), isActive: false } });
    const found = await vehicles.findById(a.tenant.id, a.vehicle.id) as any;
    assert.equal(found.booklet.id, booklet.id);
    const updated = await vehicles.update(a.tenant.id, a.vehicle.id, { notes: "Synthetic historical partial update" }) as any;
    assert.equal(updated.booklet.id, booklet.id);
  });

  it("vehicle deadline notifications exclude legacy vehicles with a foreign site before take", async () => {
    const { a, b } = await pair();
    await corruptVehicle(a, b);
    const rows = await notifications.listVehicleDeadlineCandidates(a.tenant.id, 1);
    assert.deepEqual(rows.map((row) => row.id), [a.vehicle.id]);
    assert.ok(!JSON.stringify(rows).includes(b.marker));
  });

  it("profitability report excludes foreign-site legacy vehicles and rejects explicit selection", async () => {
    const { a, b } = await pair();
    const invalid = await corruptVehicle(a, b);
    const service = new VehicleProfitabilityReportService();
    const params = { dateFrom: new Date(Date.now() - 7 * dayMs), dateTo: new Date(), includeVat: true, includeCosts: true };
    const report = await service.build(a.tenant.id, params);
    assert.deepEqual(report.vehicles.map((row: any) => row.vehicleId), [a.vehicle.id]);
    assert.ok(!JSON.stringify(report).includes(b.marker));
    await assert4xx(() => service.build(a.tenant.id, { ...params, vehicleId: invalid.id }));
  });

  it("stoppage readers exclude an otherwise owned stoppage whose vehicle has a foreign site", async () => {
    const { a, b } = await pair();
    const invalidVehicle = await corruptVehicle(a, b);
    const valid = await createStoppage(a);
    const invalid = await createStoppage(a, invalidVehicle.id);
    assert.equal(await stoppages.getById(a.tenant.id, invalid.id), null);
    const result = await stoppages.list(a.tenant.id, { skip: 0, take: 1 });
    assert.equal(result.total, 1);
    assert.deepEqual(result.data.map((row) => row.id), [valid.id]);
    assert.deepEqual((await ops.listOpenStoppagesForAssignment(a.tenant.id)).map((row) => row.id), [valid.id]);
    assert.deepEqual((await ops.listCalendarRows(a.tenant.id, new Date(Date.now() - 7 * dayMs), new Date())).map((row) => row.id), [valid.id]);
    assert.deepEqual((await notifications.listOpenStoppages(a.tenant.id, 1)).map((row) => row.id), [valid.id]);
  });

  it("stoppage event append and updates reject a vehicle with a foreign site without repair", async () => {
    const { a, b } = await pair();
    const invalidVehicle = await corruptVehicle(a, b);
    const invalid = await createStoppage(a, invalidVehicle.id);
    await assertNoMutation(() => ops.createEvent({ tenantId: a.tenant.id, stoppageId: invalid.id, userId: a.user.id, type: "UPDATED", message: "Must not persist" }));
    await assertNoMutation(() => stoppages.update(a.tenant.id, invalid.id, { vehicleId: a.vehicle.id, status: "IN_PROGRESS" }));
  });

  it("a stoppage may reference a vehicle at another owned site and retain historical deleted vehicle references", async () => {
    const a = await fixture("cross-owned-site");
    const other = await prisma.site.create({ data: { tenantId: a.tenant.id, name: "Synthetic other owned site", address: "Synthetic", city: "Synthetic", isActive: false } });
    const stopped = await createStoppage(a, a.vehicle.id, other.id);
    await prisma.vehicle.update({ where: { id: a.vehicle.id }, data: { deletedAt: new Date() } });
    await sites.delete(a.tenant.id, a.site.id);
    const found = await stoppages.getById(a.tenant.id, stopped.id) as any;
    assert.equal(found.siteId, other.id);
    assert.equal(found.vehicle.siteId, a.site.id);
    const updated = await stoppages.update(a.tenant.id, stopped.id, { status: "CLOSED", closedAt: new Date() }) as any;
    assert.equal(updated.status, "CLOSED");
    assert.equal(updated.vehicle.siteId, a.site.id);
  });

  it("queued reminder guard blocks an otherwise owned stoppage whose vehicle site is foreign", async () => {
    const { a, b } = await pair();
    const invalidVehicle = await corruptVehicle(a, b);
    const stopped = await createStoppage(a, invalidVehicle.id);
    await prisma.tenantSubscription.create({ data: { tenantId: a.tenant.id, provider: "local", plan: "STARTER", status: "ACTIVE" } });
    const queue = new EmailQueueService();
    let sends = 0;
    emailSender.send = async () => { sends += 1; return { provider: "resend", id: "synthetic-must-not-send" }; };
    const queued = await queue.enqueue({ tenantId: a.tenant.id, type: "REMINDER_EMAIL", recipient: a.workshop.email!, subject: "Synthetic", body: "Synthetic",
      meta: { tenantId: a.tenant.id, stoppageId: stopped.id, reminderType: "AUTOMATIC_RETRY" } });
    await queue.processPending(new Date(), { ids: [queued.id] });
    assert.equal(sends, 0);
    const persisted = await prisma.emailQueue.findUniqueOrThrow({ where: { id: queued.id } });
    assert.equal(persisted.status, "FAILED");
    assert.equal(persisted.attempts, 0);
    assert.equal(await prisma.reminder.count({ where: { stoppageId: stopped.id, success: true } }), 0);
    assert.equal((await prisma.stoppage.findUniqueOrThrow({ where: { id: stopped.id } })).totalRemindersSent, 0);
  });

  it("manual reminder rejects a foreign-site vehicle before queueing or invoking any provider", async () => {
    const { a, b } = await pair();
    const invalidVehicle = await corruptVehicle(a, b);
    const stopped = await createStoppage(a, invalidVehicle.id);
    await prisma.tenantSubscription.create({ data: { tenantId: a.tenant.id, provider: "local", plan: "STARTER", status: "ACTIVE" } });
    const useCase = new SendReminderUseCase(stoppages, new PrismaReminderRepository(), new EmailQueueService());
    emailSender.send = async () => { throw new Error("Provider must never be invoked"); };
    await assertNoMutation(() => useCase.manualEmail(a.tenant.id, stopped.id));
  });

  it("booking list, pagination, search and KPIs exclude vehicles with a foreign site", async () => {
    const { a, b, valid } = await bookingFixture();
    const res = response();
    await bookingController().list(request(a, "", {}, { pageSize: "1" }), res as any);
    assert.equal(res.body.total, 1);
    assert.deepEqual(res.body.data.map((row: any) => row.id), [valid.id]);
    assert.equal(res.body.kpis.active, 1);
    assert.ok(!JSON.stringify(res.body).includes(b.marker));
    const second = response();
    await bookingController().list(request(a, "", {}, { page: "2", pageSize: "1" }), second as any);
    assert.equal(second.body.total, 1);
    assert.deepEqual(second.body.data, []);
    const searched = response();
    await bookingController().list(request(a, "", {}, { search: b.marker }), searched as any);
    assert.equal(searched.body.total, 0);
    assert.deepEqual(searched.body.data, []);
  });

  for (const method of ["getById", "quickDetail", "getPricing", "getContract"] as const) {
    it(`booking ${method} denies an owned booking pointing to a foreign-site vehicle`, async () => {
      const { a, invalid } = await bookingFixture();
      await assertNoMutation(() => bookingController()[method](request(a, invalid.id), response() as any));
    });
  }

  it("contract PDF context refuses a foreign-site vehicle before rendering or storage", async () => {
    const { a, invalid } = await bookingFixture();
    await assertNoMutation(() => (bookingController() as any).getContractOrThrow(a.tenant.id, invalid.id));
  });

  it("contract monitoring preserves ownership while filtering by site or searching vehicle fields", async () => {
    const { a, b, valid } = await bookingFixture();
    const controller = bookingController();
    const res = response();
    await controller.listContractsMonitoring(request(a), res as any);
    assert.equal(res.body.total, 1);
    assert.ok(JSON.stringify(res.body.data).includes(valid.id));
    assert.ok(!JSON.stringify(res.body).includes(b.marker));
    for (const query of [{ siteId: b.site.id }, { search: b.marker }]) {
      const filtered = response();
      await controller.listContractsMonitoring(request(a, "", {}, query), filtered as any);
      assert.equal(filtered.body.total, 0);
      assert.deepEqual(filtered.body.data, []);
    }
  });

  it("customer registry SQL counts and latest rental cannot include a foreign-site legacy vehicle", async () => {
    const { a, b, customer, valid } = await bookingFixture();
    const res = response();
    await bookingController().listCustomerRegistry(request(a), res as any);
    const row = res.body.data.find((item: any) => item.id === customer.id);
    assert.equal(row.bookingsTotal, 1);
    assert.equal(row.contractsTotal, 1);
    assert.equal(row._count.bookings, 1);
    assert.equal(row.lastRentalCode, valid.code);
    assert.ok(!JSON.stringify(res.body).includes(b.marker));
    const profile = response();
    const req = request(a);
    req.params = { customerId: customer.id };
    await bookingController().getCustomerProfile(req, profile as any);
    assert.equal(profile.body.stats.bookingsTotal, 1);
    assert.equal(profile.body.stats.lastRentalCode, valid.code);
    assert.ok(!JSON.stringify(profile.body).includes(b.marker));
  });

  for (const method of ["suggestVehicles", "dayAvailability", "monthAvailability"] as const) {
    it(`rental ${method} excludes foreign-site vehicles from candidates and counts`, async () => {
      const { a, b } = await bookingFixture();
      const query = method === "suggestVehicles" ? { q: "SYNTHETIC" }
        : method === "dayAvailability" ? { date: new Date().toISOString().slice(0, 10) }
          : { month: new Date().toISOString().slice(0, 7) };
      const res = response();
      await bookingController()[method](request(a, "", {}, query), res as any);
      assert.equal(res.body.data.length, 1);
      assert.ok(!JSON.stringify(res.body).includes(b.marker));
      if (method !== "suggestVehicles") assert.equal(res.body.summary.totalVehicles, 1);
    });
  }

  it("historical booking and contract reads retain owned deleted vehicles and sites", async () => {
    const { a, valid, contract } = await bookingFixture();
    await prisma.vehicle.update({ where: { id: a.vehicle.id }, data: { deletedAt: new Date() } });
    await prisma.site.update({ where: { id: a.site.id }, data: { deletedAt: new Date(), isActive: false } });
    const detail = response();
    await bookingController().getById(request(a, valid.id), detail as any);
    assert.equal(detail.body.id, valid.id);
    assert.equal(detail.body.vehicle.id, a.vehicle.id);
    const contractResponse = response();
    await bookingController().getContract(request(a, valid.id), contractResponse as any);
    assert.equal(contractResponse.body.id, contract.id);
    const context = await (bookingController() as any).getContractOrThrow(a.tenant.id, valid.id);
    assert.equal(context.booking.vehicle.id, a.vehicle.id);
  });

  it("maintenance list and CSV export filter corrupt vehicle parents before counts and pagination", async () => {
    const { a, b } = await pair();
    const invalidVehicle = await corruptVehicle(a, b);
    const valid = await prisma.vehicleMaintenance.create({ data: { tenantId: a.tenant.id, vehicleId: a.vehicle.id, maintenanceType: "Synthetic owned", performedAt: new Date() } });
    await prisma.vehicleMaintenance.create({ data: { tenantId: a.tenant.id, vehicleId: invalidVehicle.id, maintenanceType: b.marker, performedAt: new Date() } });
    const controller = masterController();
    const res = response();
    await controller.listVehicleMaintenances(request(a, "", {}, { pageSize: "1" }), res as any);
    assert.equal(res.body.total, 1);
    assert.deepEqual(res.body.data.map((row: any) => row.id), [valid.id]);
    assert.ok(!JSON.stringify(res.body).includes(b.marker));
    const exported = response();
    await controller.exportVehicleMaintenancesCsv(request(a), exported as any);
    assert.ok(exported.body.includes(a.vehicle.plate));
    assert.ok(!exported.body.includes(b.marker));
    const filtered = response();
    await controller.listVehicleMaintenances(request(a, "", {}, { search: b.marker }), filtered as any);
    assert.equal(filtered.body.total, 0);
    assert.deepEqual(filtered.body.data, []);
  });

  for (const method of ["createVehicleMaintenance", "updateVehicleMaintenance", "deleteVehicleMaintenance"] as const) {
    it(`${method} denies a foreign-site vehicle without changing either vehicle or maintenance`, async () => {
      const { a, b } = await pair();
      const invalidVehicle = await corruptVehicle(a, b);
      const invalid = await prisma.vehicleMaintenance.create({ data: { tenantId: a.tenant.id, vehicleId: invalidVehicle.id, maintenanceType: "Synthetic", performedAt: new Date() } });
      const body = method === "createVehicleMaintenance" ? { vehicleId: invalidVehicle.id, maintenanceType: "Synthetic", performedAt: new Date(), kmAtService: 12345 }
        : { vehicleId: a.vehicle.id, maintenanceType: "Must not repair", kmAtService: 12345 };
      await assertNoMutation(() => masterController()[method](request(a, invalid.id, body), response() as any));
    });
  }

  it("historical maintenance reads retain an owned deleted vehicle with an inactive deleted site", async () => {
    const a = await fixture("maintenance-history");
    const valid = await prisma.vehicleMaintenance.create({ data: { tenantId: a.tenant.id, vehicleId: a.vehicle.id, maintenanceType: "Synthetic history", performedAt: new Date() } });
    await prisma.vehicle.update({ where: { id: a.vehicle.id }, data: { deletedAt: new Date() } });
    await prisma.site.update({ where: { id: a.site.id }, data: { deletedAt: new Date(), isActive: false } });
    const res = response();
    await masterController().listVehicleMaintenances(request(a), res as any);
    assert.equal(res.body.total, 1);
    assert.deepEqual(res.body.data.map((row: any) => row.id), [valid.id]);
  });

  it("deadline controller excludes foreign-site vehicles before the candidate limit", async () => {
    const { a, b } = await pair();
    await corruptVehicle(a, b);
    const res = response();
    await masterController().listVehicleDeadlines(request(a, "", {}, { includeAll: "true", limit: "1" }), res as any);
    assert.deepEqual(res.body.data.map((row: any) => row.vehicleId), [a.vehicle.id]);
    assert.ok(!JSON.stringify(res.body).includes(b.marker));
  });

  it("pricing list ownership permits nullable global refs but excludes a foreign-site vehicle", async () => {
    const { a, b } = await pair();
    const invalidVehicle = await corruptVehicle(a, b);
    const valid = await prisma.rentalPriceList.create({ data: { tenantId: a.tenant.id, name: "Synthetic Global", scope: "GLOBAL", baseRateAmount: 25 } });
    await prisma.rentalPriceList.create({ data: { tenantId: a.tenant.id, name: b.marker, scope: "VEHICLE", vehicleId: invalidVehicle.id, baseRateAmount: 999 } });
    const res = response();
    await new RentalPricingController().listLists(request(a, "", {}, { pageSize: "1" }), res as any);
    assert.equal(res.body.total, 1);
    assert.deepEqual(res.body.data.map((row: any) => row.id), [valid.id]);
    assert.ok(!JSON.stringify(res.body).includes(b.marker));
    const searched = response();
    await new RentalPricingController().listLists(request(a, "", {}, { search: b.marker }), searched as any);
    assert.equal(searched.body.total, 0);
    assert.deepEqual(searched.body.data, []);
  });

  it("pricing creation cannot assign a tenant vehicle whose site belongs to another tenant", async () => {
    const { a, b } = await pair();
    const invalidVehicle = await corruptVehicle(a, b);
    await assertNoMutation(() => new RentalPricingController().createList(request(a, "", {
      name: "Synthetic vehicle price", scope: "VEHICLE", vehicleId: invalidVehicle.id, baseRateAmount: 50
    }), response() as any));
  });

  it("quote preview refuses a legacy price list pointing to a foreign-site vehicle", async () => {
    const { a, b } = await pair();
    const invalidVehicle = await corruptVehicle(a, b);
    const invalid = await prisma.rentalPriceList.create({ data: { tenantId: a.tenant.id, name: b.marker, scope: "VEHICLE", vehicleId: invalidVehicle.id, baseRateAmount: 999 } });
    await assertNoMutation(() => new RentalPricingController().previewQuote(request(a, "", {
      priceListId: invalid.id, pickupAt: new Date(), returnAt: new Date(Date.now() + dayMs)
    }), response() as any));
  });

  it("privacy export excludes corrupt vehicle bookings and retains owned deleted history", async () => {
    const { a, b, customer, valid } = await bookingFixture();
    await prisma.rentalBooking.update({ where: { id: valid.id }, data: { deletedAt: new Date() } });
    await prisma.vehicle.update({ where: { id: a.vehicle.id }, data: { deletedAt: new Date() } });
    await prisma.site.update({ where: { id: a.site.id }, data: { deletedAt: new Date(), isActive: false } });
    const data = await new PrivacyComplianceService().exportCustomerData({ tenantId: a.tenant.id, customerId: customer.id });
    assert.deepEqual(data.data.bookings.map((row) => row.id), [valid.id]);
    assert.ok(!JSON.stringify(data).includes(b.marker));
    const audited = await prisma.auditLog.findFirstOrThrow({ where: { tenantId: a.tenant.id, action: "DATA_SUBJECT_EXPORT" } });
    assert.equal((audited.details as any).bookings, 1);
  });

  it("dashboard rental vehicle counts, booking feeds and contract KPIs ignore foreign-site legacy vehicles", async () => {
    const { a, b } = await bookingFixture();
    const data = await new GetDashboardStatsUseCase().dashboardOverview(a.tenant.id);
    assert.equal(data.booking.kpis.totalRentalVehicles, 1);
    assert.equal(data.booking.kpis.activeBookings, 1);
    assert.equal(data.booking.contractKpis.toSend, 1);
    assert.ok(!JSON.stringify(data).includes(b.marker));
  });

  it("scheduled executive reports count only vehicles with owned sites in ORM and SQL summaries", async () => {
    const { a, b } = await pair();
    const invalidVehicle = await corruptVehicle(a, b);
    await prisma.vehicle.updateMany({ where: { id: { in: [a.vehicle.id, invalidVehicle.id] } }, data: { currentKm: 100, maintenanceIntervalKm: 5000 } });
    await prisma.tenantSubscription.create({ data: { tenantId: a.tenant.id, provider: "local", plan: "PRO", status: "ACTIVE" } });
    const now = new Date();
    now.setSeconds(0, 0);
    const setting = await prisma.auditLog.create({ data: {
      tenantId: a.tenant.id, resource: "reports", action: "SETTINGS_REPORTS", createdAt: new Date(now.getTime() - dayMs),
      details: { enabled: true, frequency: "daily", hour: now.getHours(), minute: now.getMinutes(), reportStyle: "EXECUTIVE", recipients: ["synthetic-report@example.test"] }
    } });
    await prisma.scheduledReportCursor.create({ data: { tenantId: a.tenant.id, settingsAuditLogId: setting.id, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone, nextRunAt: now } });
    await runReportsCronCycle(new EmailQueueService(), new LicensePolicyService(new PrismaAuditLogRepository()), now);
    const row = await prisma.emailQueue.findFirstOrThrow({ where: { tenantId: a.tenant.id, type: "SCHEDULED_REPORT" } });
    assert.equal(row.status, "PENDING", "report may only enqueue a synthetic command");
    assert.ok(row.body.includes("Veicoli monitorati: 1"));
    assert.ok(row.body.includes("Veicoli con km valorizzato: 1"));
    assert.ok(!row.body.includes(b.marker));
  });

  it("concurrent operational close and pricing edit serialize without a booking/snapshot deadlock", { timeout: 15_000 }, async () => {
    const { a, booking } = await pricingFixture("pricing-close-race");
    const nextPrice = await prisma.rentalPriceList.create({ data: {
      tenantId: a.tenant.id, name: "Synthetic revised price", baseRateUnit: "DAILY", baseRateAmount: 75, vatRate: 0, discountPercent: 0
    } });
    const controller = bookingController();
    const reachedSnapshot = deferred();
    const resumeTransition = deferred();
    const savedTransaction = prisma.$transaction;
    const transact = savedTransaction.bind(prisma);
    let transitionPid = 0;
    let paused = false;
    type Outcome = { ok: true; value: unknown } | { ok: false; error: any };
    let closing: Promise<Outcome> | undefined;
    let pricing: Promise<Outcome> | undefined;
    (prisma as any).$transaction = (input: any, options?: any) => {
      // Array transactions keep their real query order. The interactive close
      // pauses after its Booking lock and immediately before its Snapshot write.
      if (typeof input !== "function") return (transact as any)(input, options);
      return (transact as any)(async (tx: any) => {
        const delegate = tx.rentalBookingPricingSnapshot;
        const originalUpdate = delegate.updateMany.bind(delegate);
        delegate.updateMany = async (args: any) => {
          if (!paused && args.where?.bookingId === booking.id) {
            paused = true;
            const pid = await tx.$queryRaw`SELECT pg_backend_pid() AS pid`;
            transitionPid = Number(pid[0].pid);
            reachedSnapshot.resolve();
            await resumeTransition.promise;
          }
          return originalUpdate(args);
        };
        try { return await input(tx); }
        finally { delegate.updateMany = originalUpdate; }
      }, options);
    };
    const settle = (work: Promise<unknown>): Promise<Outcome> => work.then((value) => ({ ok: true, value }), (error: any) => ({ ok: false, error }));
    try {
      closing = settle(controller.transition(request(a, booking.id, { toStatus: "CLOSED" }), response() as any));
      await waitBounded(reachedSnapshot.promise, "close reaching its Snapshot write with Booking locked");
      pricing = settle(controller.updatePricing(request(a, booking.id, { priceListId: nextPrice.id, actualKm: 120 }), response() as any));
      const deadline = Date.now() + 1500;
      let competingLockObserved = false;
      while (Date.now() < deadline) {
        const waiting = await prisma.$queryRaw<Array<{ pid: number }>>`
          SELECT activity.pid
          FROM pg_stat_activity AS activity
          WHERE activity.datname = current_database()
            AND activity.wait_event_type = 'Lock'
            AND ${transitionPid}::integer = ANY(pg_blocking_pids(activity.pid))
            AND (activity.query LIKE '%RentalBooking%' OR activity.query LIKE '%pg_advisory_xact_lock%')
        `;
        if (waiting.length) { competingLockObserved = true; break; }
        await new Promise((resolve) => { setTimeout(resolve, 20); });
      }
      assert.equal(competingLockObserved, true, "pricing must reach a real PostgreSQL lock wait behind the paused close");
      resumeTransition.resolve();
      const [closed, priced] = await waitBounded(Promise.all([closing, pricing]), "concurrent controller settlements", 8000);
      assert.ok(closed.ok, closed.ok ? "" : `operational close failed: ${closed.error.code ?? "unknown"} ${closed.error.message}`);
      if (!priced.ok) {
        assert.equal(priced.error.statusCode, 409, `unexpected pricing database error: ${priced.error.code ?? "unknown"}`);
        assert.equal(priced.error.code, "BOOKING_CHANGED");
      }
      const persisted = await prisma.rentalBooking.findUniqueOrThrow({ where: { id: booking.id }, include: { pricingSnapshot: true, notes: true } });
      const vehicle = await prisma.vehicle.findUniqueOrThrow({ where: { id: a.vehicle.id } });
      assert.equal(persisted.status, "CLOSED");
      assert.equal(vehicle.currentKm, 1120);
      assert.equal(persisted.pricingSnapshot?.actualKm, 120);
      assert.equal(persisted.finalTotal, persisted.pricingSnapshot?.finalTotal);
      assert.equal(persisted.expectedTotal, persisted.pricingSnapshot?.expectedTotal);
      assert.equal(persisted.finalTotal, priced.ok ? 150 : 100);
      assert.equal(persisted.notes.filter((note) => note.message.startsWith("Stato prenotazione:")).length, 1);
      assert.equal(persisted.notes.filter((note) => note.message.startsWith("Pricing aggiornato:")).length, priced.ok ? 2 : 1);
    } finally {
      resumeTransition.resolve();
      (prisma as any).$transaction = savedTransaction;
      if (closing) await closing;
      if (pricing) await pricing;
    }
  });

  it("late mileage persistence failure rolls back close status, pricing snapshot and transition note together", async () => {
    const { a, booking } = await pricingFixture("close-mileage-failure");
    const suffix = `${Date.now()}_${sequence++}`;
    const functionName = `synthetic_vehicle_km_failure_${suffix}`;
    const triggerName = `synthetic_vehicle_km_trigger_${suffix}`;
    assert.match(a.vehicle.id, /^[a-z0-9]+$/i);
    let triggerCreated = false;
    try {
      // A fixture-only PostgreSQL constraint failure tests an actual late write
      // failure after status and pricing were modified, without mocking queries.
      await prisma.$executeRawUnsafe(`CREATE FUNCTION "${functionName}"() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
          IF NEW."id" = '${a.vehicle.id}' THEN
            RAISE EXCEPTION 'synthetic mileage persistence rejection' USING ERRCODE = '23514';
          END IF;
          RETURN NEW;
        END;
      $$`);
      await prisma.$executeRawUnsafe(`CREATE TRIGGER "${triggerName}" BEFORE UPDATE ON "Vehicle" FOR EACH ROW EXECUTE FUNCTION "${functionName}"()`);
      triggerCreated = true;
      const initial = await snapshot();
      await assert.rejects(() => bookingController().transition(request(a, booking.id, { toStatus: "CLOSED" }), response() as any));
      assert.equal(await snapshot(), initial, "status, monetary snapshot, vehicle mileage and notes must all roll back");
    } finally {
      if (triggerCreated) await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS "${triggerName}" ON "Vehicle"`);
      await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS "${functionName}"()`);
    }
  });

  it("legitimate operational close preserves pricing and atomically records mileage plus one transition note", async () => {
    const { a, booking } = await pricingFixture("close-pricing-legitimate");
    const res = response();
    await bookingController().transition(request(a, booking.id, { toStatus: "CLOSED" }), res as any);
    assert.equal(res.body.status, "CLOSED");
    const persisted = await prisma.rentalBooking.findUniqueOrThrow({ where: { id: booking.id }, include: { pricingSnapshot: true, notes: true } });
    assert.equal(persisted.finalTotal, 100);
    assert.equal(persisted.pricingSnapshot?.finalTotal, 100);
    assert.equal(persisted.pricingSnapshot?.actualKm, 120);
    assert.equal((await prisma.vehicle.findUniqueOrThrow({ where: { id: a.vehicle.id } })).currentKm, 1120);
    assert.equal(persisted.notes.filter((note) => note.message.startsWith("Stato prenotazione:")).length, 1);
  });

  for (const type of ["photo", "booklet", "maintenance-attachment"] as const) {
    for (const method of ["GET", "DELETE"] as const) {
      it(`upload ${type} ${method} refuses a corrupt vehicle parent before storage or metadata mutation`, async () => {
        const { a, b } = await pair();
        const invalidVehicle = await corruptVehicle(a, b);
        const file = { filePath: `synthetic/${runId}-${sequence++}.png`, fileName: "synthetic.png", mimeType: "image/png", sizeBytes: 16 };
        let id: string;
        if (type === "photo") id = (await prisma.vehiclePhoto.create({ data: { vehicleId: invalidVehicle.id, ...file } })).id;
        else if (type === "booklet") id = (await prisma.vehicleBooklet.create({ data: { tenantId: a.tenant.id, vehicleId: invalidVehicle.id, ...file } })).id;
        else {
          const maintenance = await prisma.vehicleMaintenance.create({ data: { tenantId: a.tenant.id, vehicleId: invalidVehicle.id, maintenanceType: "Synthetic", performedAt: new Date() } });
          id = (await prisma.vehicleMaintenanceAttachment.create({ data: { tenantId: a.tenant.id, maintenanceId: maintenance.id, ...file } })).id;
        }
        const prefix = type === "photo" ? "vehicle-photos" : type === "booklet" ? "vehicle-booklets" : "vehicle-maintenance-attachments";
        const initial = await snapshot();
        await withStorageProbe(async (calls) => {
          const res = await uploadRequest(a, `/${prefix}/${id}${method === "GET" ? "/file" : ""}`, method);
          assert.equal(res.status, 404);
          assert.deepEqual(calls, [], "denied metadata must not invoke storage existence, read or deletion");
          assert.equal(await snapshot(), initial, "denial must not append audits or remove file metadata");
        });
      });
    }
  }

  for (const type of ["photo", "booklet", "maintenance-attachment"] as const) {
    it(`${type} upload rejects a corrupt parent before parsing or file side effects`, async () => {
      const { a, b } = await pair();
      const invalidVehicle = await corruptVehicle(a, b);
      let path: string;
      if (type === "photo") path = `/vehicles/${invalidVehicle.id}/photos`;
      else if (type === "booklet") path = `/vehicles/${invalidVehicle.id}/booklet`;
      else {
        const maintenance = await prisma.vehicleMaintenance.create({ data: { tenantId: a.tenant.id, vehicleId: invalidVehicle.id, maintenanceType: "Synthetic", performedAt: new Date() } });
        path = `/vehicle-maintenances/${maintenance.id}/attachments`;
      }
      const initial = await snapshot();
      await withStorageProbe(async (calls) => {
        // No real file is supplied: a missing-file 400 would prove that the
        // invalid parent reached the upload handler instead of its 404 guard.
        const res = await uploadRequest(a, path, "POST");
        assert.equal(res.status, 404);
        assert.deepEqual(calls, []);
        assert.equal(await snapshot(), initial);
      });
    });
  }

  for (const type of ["photo", "booklet", "maintenance-attachment"] as const) {
    it(`historical ${type} download and deletion retain owned soft-deleted vehicle/site references`, async () => {
      const a = await fixture(`file-history-${type}`);
      const file = { filePath: `synthetic/${runId}-${sequence++}.png`, fileName: "synthetic.png", mimeType: "image/png", sizeBytes: 16 };
      let id: string;
      if (type === "photo") id = (await prisma.vehiclePhoto.create({ data: { vehicleId: a.vehicle.id, ...file } })).id;
      else if (type === "booklet") id = (await prisma.vehicleBooklet.create({ data: { tenantId: a.tenant.id, vehicleId: a.vehicle.id, ...file } })).id;
      else {
        const maintenance = await prisma.vehicleMaintenance.create({ data: { tenantId: a.tenant.id, vehicleId: a.vehicle.id, maintenanceType: "Synthetic", performedAt: new Date(), deletedAt: new Date() } });
        id = (await prisma.vehicleMaintenanceAttachment.create({ data: { tenantId: a.tenant.id, maintenanceId: maintenance.id, ...file } })).id;
      }
      await prisma.vehicle.update({ where: { id: a.vehicle.id }, data: { deletedAt: new Date() } });
      await prisma.site.update({ where: { id: a.site.id }, data: { deletedAt: new Date(), isActive: false } });
      const prefix = type === "photo" ? "vehicle-photos" : type === "booklet" ? "vehicle-booklets" : "vehicle-maintenance-attachments";
      await withStorageProbe(async (calls) => {
        const download = await uploadRequest(a, `/${prefix}/${id}/file`);
        assert.equal(download.status, 200);
        assert.equal(await download.text(), "Synthetic file contents");
        assert.deepEqual(calls.slice(0, 2), ["exists", "read"]);
        const deleted = await uploadRequest(a, `/${prefix}/${id}`, "DELETE");
        assert.equal(deleted.status, 204);
      });
    });
  }

  for (const operation of ["create", "update"] as const) {
    it(`vehicle ${operation} waits for a concurrent site soft deletion and then rejects the new link`, async () => {
      const a = await fixture(`race-${operation}`);
      const candidate = await prisma.site.create({ data: { tenantId: a.tenant.id, name: "Synthetic next site", address: "Synthetic", city: "Synthetic" } });
      let release!: () => void;
      let ready!: () => void;
      const hold = new Promise<void>((resolve) => { release = resolve; });
      const locked = new Promise<void>((resolve) => { ready = resolve; });
      const deletion = prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "Site" WHERE "id" = ${candidate.id} FOR UPDATE`;
        await tx.site.update({ where: { id: candidate.id }, data: { deletedAt: new Date() } });
        ready();
        await hold;
      }, { maxWait: 3000, timeout: 5000 });
      let outcome: Promise<{ value?: unknown; error?: unknown }> | undefined;
      try {
        await Promise.race([locked, deletion.then(() => { throw new Error("Lock holder finished too soon"); })]);
        const input = operation === "create" ? { ...createInput(a), siteId: candidate.id } : { siteId: candidate.id };
        outcome = (operation === "create" ? vehicles.create(a.tenant.id, input) : vehicles.update(a.tenant.id, a.vehicle.id, input))
          .then((value) => ({ value }), (error: unknown) => ({ error }));
        await new Promise((resolve) => { setTimeout(resolve, 50); });
        release();
        await deletion;
        const result = await outcome;
        assert.ok(result.error, "candidate site must be revalidated after its deletion commits");
        const status = (result.error as any).statusCode;
        assert.ok(Number.isInteger(status) && status >= 400 && status < 500);
        assert.equal(await prisma.vehicle.count({ where: { tenantId: a.tenant.id } }), 1);
        assert.equal((await prisma.vehicle.findUniqueOrThrow({ where: { id: a.vehicle.id } })).siteId, a.site.id);
      } finally { release(); await deletion; if (outcome) await outcome; }
    });
  }
});
