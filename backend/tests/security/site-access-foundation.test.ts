import {assertSyntheticDatabase} from "../helpers/synthetic-database.js";
import assert from "node:assert/strict";
import { before, after, describe, it } from "node:test";
import { prisma } from "../../src/infrastructure/database/prisma/client.js";
import { SiteAccessService } from "../../src/application/services/site-access-service.js";
import { bookingSiteWhere, siteResourceWhere } from "../../src/domain/policies/site-access.js";

const service = new SiteAccessService();
const tenants: string[] = [];
const ids: Record<string, string> = {};
const run = `e02-${Date.now()}`;
describe("site access foundation on synthetic PostgreSQL", () => {
  before(async () => {
    assertSyntheticDatabase({user:"fleetum_e02",database:"fleetum_e02_test",port:"61520"});
    assert.equal(process.env.NODE_ENV, "test");
    const target = new URL(process.env.DATABASE_URL!);


    for (const name of ["a", "b"]) {
      const tenant = await prisma.tenant.create({ data: { name: `Synthetic ${run}-${name}` } });
      tenants.push(tenant.id); ids[name] = tenant.id;
      for (const place of name === "a" ? ["roma", "milano", "napoli"] : ["foreign"]) {
        const site = await prisma.site.create({ data: { tenantId: tenant.id, name: place, address: "Synthetic address", city: "Synthetic city" } });
        ids[place] = site.id;
      }
    }
    for (const [name, roleKey] of [["admin", "ADMIN"], ["manager", "MANAGER"], ["operator", "OPERATOR"], ["foreign-user", "OPERATOR"]] as const) {
      const role = await prisma.role.upsert({ where: { key: roleKey }, update: {}, create: { key: roleKey, name: roleKey } });
      const user = await prisma.user.create({ data: { tenantId: name === "foreign-user" ? ids.b : ids.a, email: `${run}-${name}@example.invalid`, passwordHash: "synthetic-not-a-login-hash", firstName: "Synthetic", lastName: name,
        roles: { create: { roleId: role.id } } } }); ids[name] = user.id;
    }
    const vehicle = await prisma.vehicle.create({ data: { tenantId: ids.a, siteId: ids.roma, plate: `E02-${run}`, brand: "Synthetic", model: "Test" } }); ids.vehicle = vehicle.id;
    for (const [name, sites] of [["both", [ids.roma, ids.roma, ids.milano]], ["other", [ids.napoli, ids.napoli, ids.milano]], ["legacy", [null, null, null]]] as const) {
      const booking = await prisma.rentalBooking.create({ data: { tenantId: ids.a, vehicleId: vehicle.id, siteId: sites[0], pickupSiteId: sites[1], returnSiteId: sites[2], code: `${run}-${name}`, customerName: "Synthetic customer", pickupAt: new Date("2035-01-01T09:00:00Z"), returnAt: new Date("2035-01-03T09:00:00Z") } });
      ids[name] = booking.id;
    }
  });
  after(async () => {
    if (!tenants.length) { await prisma.$disconnect(); return; }
    await prisma.rentalBooking.deleteMany({ where: { tenantId: { in: tenants } } });
    await prisma.auditLog.deleteMany({ where: { tenantId: { in: tenants } } });
    await prisma.userRole.deleteMany({ where: { user: { tenantId: { in: tenants } } } });
    await prisma.user.deleteMany({ where: { tenantId: { in: tenants } } });
    await prisma.vehicle.deleteMany({ where: { tenantId: { in: tenants } } });
    await prisma.site.deleteMany({ where: { tenantId: { in: tenants } } });
    await prisma.tenant.deleteMany({ where: { id: { in: tenants } } });
    await prisma.$disconnect();
  });
  it("unassigned operators have no site scope, managers retain company-wide view", async () => {
    assert.deepEqual((await service.resolveForUser(ids.a, ids.operator)).siteIds, []);
    assert.equal((await service.resolveForUser(ids.a, ids.manager)).allSites, true);
  });
  it("admin assignment is transactional, tenant-bound and visible on the next resolution", async () => {
    await service.assign({ tenantId: ids.a, actorUserId: ids.admin, userId: ids.operator, siteId: ids.roma });
    assert.deepEqual((await service.resolveForUser(ids.a, ids.operator)).siteIds, [ids.roma]);
    assert.equal(await prisma.auditLog.count({ where: { tenantId: ids.a, action: "USER_SITE_ASSIGNED", resourceId: ids.operator } }), 1);
    await service.assign({ tenantId: ids.a, actorUserId: ids.admin, userId: ids.operator, siteId: ids.milano });
    assert.deepEqual((await service.resolveForUser(ids.a, ids.operator)).siteIds, [ids.milano]);
  });
  it("manager and operator cannot grant themselves site assignments", async () => {
    for (const actorUserId of [ids.manager, ids.operator]) {
      await assert.rejects(() => service.assign({ tenantId: ids.a, actorUserId, userId: ids.operator, siteId: ids.napoli }), (e: any) => e.statusCode === 403);
    }
    assert.deepEqual((await service.resolveForUser(ids.a, ids.operator)).siteIds, [ids.milano]);
  });
  it("foreign users and foreign or inactive sites cannot be assigned", async () => {
    await assert.rejects(() => service.assign({ tenantId: ids.a, actorUserId: ids.admin, userId: ids["foreign-user"], siteId: ids.roma }), (e: any) => e.statusCode === 404);
    await assert.rejects(() => service.assign({ tenantId: ids.a, actorUserId: ids.admin, userId: ids.operator, siteId: ids.foreign }), (e: any) => e.statusCode === 404);
    await prisma.site.update({ where: { id: ids.napoli }, data: { isActive: false } });
    await assert.rejects(() => service.assign({ tenantId: ids.a, actorUserId: ids.admin, userId: ids.operator, siteId: ids.napoli }), (e: any) => e.statusCode === 404);
  });
  it("database composite foreign keys reject cross-company assignments and booking sites", async () => {
    await assert.rejects(() => prisma.user.update({ where: { id: ids.operator }, data: { assignedSiteId: ids.foreign } }), (e: any) => e.code === "P2003");
    for (const field of ["siteId", "pickupSiteId", "returnSiteId"]) {
      await assert.rejects(() => prisma.rentalBooking.update({ where: { id: ids.both }, data: { [field]: ids.foreign } }), (e: any) => e.code === "P2003");
    }
  });
  it("participating-site filters include pickup/return and hide unclassified legacy records", async () => {
    await service.assign({ tenantId: ids.a, actorUserId: ids.admin, userId: ids.operator, siteId: ids.roma });
    const roma = await prisma.rentalBooking.findMany({ where: bookingSiteWhere(await service.resolveForUser(ids.a, ids.operator)), select: { id: true } });
    assert.deepEqual(roma.map(x => x.id), [ids.both]);
    await service.assign({ tenantId: ids.a, actorUserId: ids.admin, userId: ids.operator, siteId: ids.milano });
    const milano = await prisma.rentalBooking.findMany({ where: bookingSiteWhere(await service.resolveForUser(ids.a, ids.operator)), select: { id: true } });
    assert.deepEqual(new Set(milano.map(x => x.id)), new Set([ids.both, ids.other]));
    const all = await prisma.rentalBooking.findMany({ where: bookingSiteWhere(await service.resolveForUser(ids.a, ids.manager)), select: { id: true } });
    assert.equal(all.length, 3);
  });
  it("moving a vehicle does not move a booking's historical scope", async () => {
    await service.assign({ tenantId: ids.a, actorUserId: ids.admin, userId: ids.operator, siteId: ids.roma });
    await prisma.vehicle.update({ where: { id: ids.vehicle }, data: { siteId: ids.milano } });
    const scope = await service.resolveForUser(ids.a, ids.operator);
    assert.equal(await prisma.vehicle.count({ where: siteResourceWhere(scope) }), 0);
    assert.equal(await prisma.rentalBooking.count({ where: { ...bookingSiteWhere(scope), id: ids.both } }), 1);
  });

  it("manager selection validates an active same-company site and does not widen an operator", async () => {
    const selected = await service.resolveSelectedScope(ids.a, ids.manager, ids.milano);
    assert.equal(selected.allSites, false); assert.deepEqual(selected.siteIds, [ids.milano]);
    for (const site of [ids.foreign, ids.napoli, "missing-site"]) {
      await assert.rejects(() => service.resolveSelectedScope(ids.a, ids.manager, site), (e: any) => e.statusCode === 404);
    }
    await assert.rejects(() => service.resolveSelectedScope(ids.a, ids.operator, ids.milano), (e: any) => e.statusCode === 404);
    assert.deepEqual((await service.resolveSelectedScope(ids.a, ids.operator, "all")).siteIds, [ids.roma]);
    assert.equal((await service.resolveSelectedScope(ids.a, ids.operator, "all")).allSites, false);
  });
  it("role changes and suspension are read afresh rather than trusted from a prior scope", async () => {
    const manager = await prisma.role.findUniqueOrThrow({ where: { key: "MANAGER" } });
    const operator = await prisma.role.findUniqueOrThrow({ where: { key: "OPERATOR" } });
    await prisma.userRole.deleteMany({ where: { userId: ids.operator } });
    await prisma.userRole.create({ data: { userId: ids.operator, roleId: manager.id } });
    assert.equal((await service.resolveForUser(ids.a, ids.operator)).allSites, true);
    await prisma.userRole.deleteMany({ where: { userId: ids.operator } });
    await prisma.userRole.create({ data: { userId: ids.operator, roleId: operator.id } });
    assert.deepEqual((await service.resolveForUser(ids.a, ids.operator)).siteIds, [ids.roma]);
    await prisma.user.update({ where: { id: ids.operator }, data: { status: "SUSPENDED" } });
    await assert.rejects(() => service.resolveForUser(ids.a, ids.operator), (e: any) => e.statusCode === 401);
    await prisma.user.update({ where: { id: ids.operator }, data: { status: "ACTIVE" } });
  });
  it("disabling or removing an assignment does not fall back to all sites", async () => {
    await prisma.site.update({ where: { id: ids.roma }, data: { isActive: false } });
    assert.deepEqual((await service.resolveForUser(ids.a, ids.operator)).siteIds, []);
    await service.assign({ tenantId: ids.a, actorUserId: ids.admin, userId: ids.operator, siteId: null });
    assert.deepEqual((await service.resolveForUser(ids.a, ids.operator)).siteIds, []);
  });
});
