import {assertSyntheticDatabase} from "../helpers/synthetic-database.js";
import assert from "node:assert/strict";
import { before, after, describe, it } from "node:test";
import { prisma } from "../../src/infrastructure/database/prisma/client.js";
import { runWithSiteAccess } from "../../src/infrastructure/auth/site-access-context.js";
import { RentalBookingsController } from "../../src/interfaces/http/controllers/rental-bookings-controller.js";

const controller = new RentalBookingsController();
const ids: Record<string, string> = {};
const tenants: string[] = [];
const run = `e02-booking-${Date.now()}`;
const response = () => ({ body: null as any, headers: {} as Record<string, string>,
  setHeader(key: string, value: string) { this.headers[key] = value; },
  status(_code: number) { return this; }, json(value: unknown) { this.body = value; return this; } });
let sequence = 0;
const create = async (patch: Record<string, unknown> = {}, key?: string) => {
  sequence += 1;
  const start = new Date(Date.UTC(2035, 0, sequence * 3));
  const body = { vehicleId: ids.vehicle, customerId: ids.customer, pickupAt: start.toISOString(),
    returnAt: new Date(start.getTime() + 86400000).toISOString(), contractRequired: false, generateContract: false, ...patch };
  const res = response();
  await controller.create({ auth: { tenantId: ids.a }, body, headers: { "x-idempotency-key": key ?? `${run}-${sequence}` } } as any, res as any);
  return { body, res };
};
describe("booking site snapshot through the existing controller on synthetic PostgreSQL", () => {
  before(async () => {
    assertSyntheticDatabase({user:"fleetum_e02",database:"fleetum_e02_test",port:"61520"});
    assert.equal(process.env.NODE_ENV, "test");
    const target = new URL(process.env.DATABASE_URL!);


    for (const name of ["a", "b"]) {
      const tenant = await prisma.tenant.create({ data: { name: `Synthetic ${run}-${name}` } });
      tenants.push(tenant.id); ids[name] = tenant.id;
      for (const place of name === "a" ? ["roma", "milano", "napoli"] : ["foreign"]) {
        const site = await prisma.site.create({ data: { tenantId: tenant.id, name: place, address: "Synthetic address", city: "Synthetic city" } }); ids[place] = site.id;
      }
    }
    const vehicle = await prisma.vehicle.create({ data: { tenantId: ids.a, siteId: ids.roma, plate: run, brand: "Synthetic", model: "Test" } }); ids.vehicle = vehicle.id;
    const customer = await prisma.rentalCustomer.create({ data: { tenantId: ids.a, firstName: "Synthetic", lastName: "Shared" } }); ids.customer = customer.id;
  });
  after(async () => {
    if (!tenants.length) { await prisma.$disconnect(); return; }
    const where = { tenantId: { in: tenants } };
    await prisma.rentalBookingCreateRequest.deleteMany({ where });
    await prisma.rentalBookingNote.deleteMany({ where });
    await prisma.rentalBooking.deleteMany({ where });
    await prisma.rentalCustomer.deleteMany({ where });
    await prisma.vehicle.deleteMany({ where });
    await prisma.site.deleteMany({ where });
    await prisma.tenant.deleteMany({ where: { id: { in: tenants } } });
    await prisma.$disconnect();
  });
  it("captures all three site references even for a legacy client that omits them", async () => {
    const { res } = await create();
    assert.equal(res.body.siteId, ids.roma); assert.equal(res.body.pickupSiteId, ids.roma); assert.equal(res.body.returnSiteId, ids.roma);
  });
  it("records the return branch independently of pickup and vehicle", async () => {
    const { res } = await create({ returnSiteId: ids.milano });
    assert.equal(res.body.siteId, ids.roma); assert.equal(res.body.pickupSiteId, ids.roma); assert.equal(res.body.returnSiteId, ids.milano);
  });
  it("rejects foreign and inactive destinations without booking or idempotency residue", async () => {
    await prisma.site.update({ where: { id: ids.napoli }, data: { isActive: false } });
    const count = await prisma.rentalBooking.count({ where: { tenantId: ids.a } });
    for (const field of ["pickupSiteId", "returnSiteId"]) for (const site of [ids.foreign, ids.napoli, "missing-site"]) {
      await assert.rejects(() => create({ [field]: site }), (e: any) => e.statusCode === 404);
    }
    assert.equal(await prisma.rentalBooking.count({ where: { tenantId: ids.a } }), count);
    assert.equal(await prisma.rentalBookingCreateRequest.count({ where: { tenantId: ids.a } }), count);
  });
  it("replay keeps the original snapshot after a vehicle transfer", async () => {
    const key = `${run}-replay`;
    const { body, res } = await create({ returnSiteId: ids.milano }, key);
    await prisma.vehicle.update({ where: { id: ids.vehicle }, data: { siteId: ids.milano } });
    const replay = await create(body, key);
    assert.equal(replay.res.body.id, res.body.id); assert.equal(replay.res.body.siteId, ids.roma);
    assert.equal(replay.res.headers["Idempotency-Replayed"], "true");
  });
  it("a changed return branch cannot reuse a create command", async () => {
    const key = `${run}-changed`;
    const { body } = await create({ returnSiteId: ids.roma }, key);
    await assert.rejects(() => create({ ...body, returnSiteId: ids.milano }, key), (e: any) => e.statusCode === 409);
  });
  it("ordinary updates and vehicle reassignment preserve the historical sites", async () => {
    const { res } = await create({ pickupSiteId: ids.roma, returnSiteId: ids.milano });
    const other = await prisma.vehicle.create({ data: { tenantId: ids.a, siteId: ids.roma, plate: `${run}-other`, brand: "Synthetic", model: "Test" } });
    const updated = response();
    await controller.update({ auth: { tenantId: ids.a }, params: { id: res.body.id }, body: { vehicleId: other.id, internalNotes: "Synthetic note" } } as any, updated as any);
    assert.equal(updated.body.siteId, res.body.siteId); assert.equal(updated.body.pickupSiteId, ids.roma); assert.equal(updated.body.returnSiteId, ids.milano);
  });

  it("a resolved operator scope cannot create against another branch's vehicle", async () => {
    const before = await prisma.rentalBooking.count({ where: { tenantId: ids.a } });
    await assert.rejects(() => runWithSiteAccess({ tenantId: ids.a, canViewAllSites: false, allSites: false, siteIds: [ids.roma] },
      () => create({ pickupSiteId: ids.roma, returnSiteId: ids.milano })), (e: any) => e.statusCode === 404);
    assert.equal(await prisma.rentalBooking.count({ where: { tenantId: ids.a } }), before);
  });

  it("the site mutation guard rejects an unrelated booking and a mismatched tenant context", async () => {
    const { res } = await create({ pickupSiteId: ids.milano, returnSiteId: ids.milano });
    const update = () => controller.update({ auth: { tenantId: ids.a }, params: { id: res.body.id }, body: { internalNotes: "must not persist" } } as any, response() as any);
    await assert.rejects(() => runWithSiteAccess({ tenantId: ids.a, allSites: false, canViewAllSites: false, siteIds: [ids.roma] }, update), (e: any) => e.statusCode === 404);
    await assert.rejects(() => runWithSiteAccess({ tenantId: ids.b, allSites: true, canViewAllSites: true, siteIds: [] }, update), (e: any) => e.statusCode === 403);
    assert.equal((await prisma.rentalBooking.findUniqueOrThrow({ where: { id: res.body.id } })).internalNotes, null);
  });
  it("a foreign return branch update is atomic and leaves the booking unchanged", async () => {
    const { res } = await create({ returnSiteId: ids.roma });
    const before = await prisma.rentalBooking.findUniqueOrThrow({ where: { id: res.body.id } });
    await assert.rejects(() => controller.update({ auth: { tenantId: ids.a }, params: { id: res.body.id }, body: { returnSiteId: ids.foreign, internalNotes: "must not persist" } } as any, response() as any), (e: any) => e.statusCode === 404);
    const after = await prisma.rentalBooking.findUniqueOrThrow({ where: { id: res.body.id } });
    assert.equal(after.returnSiteId, before.returnSiteId); assert.equal(after.internalNotes, before.internalNotes); assert.equal(after.updatedAt.getTime(), before.updatedAt.getTime());
  });
});
