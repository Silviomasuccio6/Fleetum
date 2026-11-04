import {assertSyntheticDatabase} from "../helpers/synthetic-database.js";
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import fs from "node:fs/promises";
import { storageProvider } from "../../src/infrastructure/storage/storage-provider.js";
import type http from "node:http";
import type { AddressInfo } from "node:net";
import { createApp } from "../../src/app.js";
import { prisma } from "../../src/infrastructure/database/prisma/client.js";
import { requireAuth } from "../../src/interfaces/http/middlewares/auth.js";
import { SiteAccessService } from "../../src/application/services/site-access-service.js";
import { runWithSiteAccess } from "../../src/infrastructure/auth/site-access-context.js";
import { signTenantAccessToken } from "../helpers/http-auth.js";

const ids: Record<string, string> = {}, tokens: Record<string, string> = {};
const tenantIds: string[] = [];
const run = `site-core-${Date.now()}`;
let server: http.Server | undefined, base = "";
const call = (who: string, route: string, options: { method?: string; body?: object; site?: string } = {}) => fetch(base + route, {
  method: options.method ?? "GET", headers: { Authorization: `Bearer ${tokens[who]}`, ...(options.body ? { "Content-Type": "application/json" } : {}), ...(options.site ? { "X-Fleetum-Site": options.site } : {}) },
  ...(options.body ? { body: JSON.stringify(options.body) } : {})
});
const json = async (who: string, route: string, site?: string) => {
  const response = await call(who, route, { site });
  assert.equal(response.status, 200, await response.clone().text()); return response.json() as Promise<any>;
};
const forbiddenText = (value: unknown) => {
  const text = JSON.stringify(value);
  for (const secret of [ids.napoliBooking, "NAPOLI_PRIVATE", ids.foreignBooking, "FOREIGN_PRIVATE"]) assert.ok(!text.includes(secret), secret);
};

describe("E02 core HTTP with freshly resolved site context on synthetic PostgreSQL", () => {
  before(async () => {
    assertSyntheticDatabase({user:"fleetum_e02_core",database:"fleetum_e02_core_test",port:"61522",uploadPrefix:"/private/tmp/fleetum-e02-core-uploads-"});
    assert.equal(process.env.NODE_ENV, "test"); assert.equal(process.env.DOTENV_CONFIG_PATH, "/dev/null"); assert.equal(storageProvider.name, "local");
    const target = new URL(process.env.DATABASE_URL!);



    for (const key of ["ADMIN", "MANAGER", "OPERATOR"]) {
      ids[key] = (await prisma.role.upsert({ where: { key }, update: {}, create: { key, name: key } })).id;
      for (const permissionKey of ["vehicles:read", "vehicles:write", "sites:read"]) {
        const permission = await prisma.permission.upsert({ where: { key: permissionKey }, update: {}, create: { key: permissionKey, description: "Synthetic" } });
        await prisma.rolePermission.upsert({ where: { roleId_permissionId: { roleId: ids[key], permissionId: permission.id } }, update: {}, create: { roleId: ids[key], permissionId: permission.id } });
      }
    }
    for (const tenant of ["a", "b"]) {
      ids[tenant] = (await prisma.tenant.create({ data: { name: `Synthetic ${run}-${tenant}` } })).id; tenantIds.push(ids[tenant]);
      await prisma.tenantSubscription.create({ data: { tenantId: ids[tenant], provider: "test", plan: "ENTERPRISE", status: "ACTIVE", seats: 20 } });
    }
    for (const [name, tenant] of [["roma", "a"], ["milano", "a"], ["napoli", "a"], ["foreignSite", "b"]]) {
      ids[name] = (await prisma.site.create({ data: { tenantId: ids[tenant], name, address: "Synthetic", city: "Synthetic" } })).id;
      ids[name+"Vehicle"] = (await prisma.vehicle.create({ data: { tenantId: ids[tenant], siteId: ids[name], plate: `${run}-${name}`, brand: "Synthetic", model: "Synthetic", currentKm: 10000 } })).id;
    }
    for (const [name, role, tenant, site] of [["rome", "OPERATOR", "a", ids.roma], ["milan", "OPERATOR", "a", ids.milano], ["naples", "OPERATOR", "a", ids.napoli], ["unassigned", "OPERATOR", "a", null], ["manager", "MANAGER", "a", null], ["admin", "ADMIN", "a", null], ["foreign", "ADMIN", "b", null]] as const) {
      const user = await prisma.user.create({ data: { tenantId: ids[tenant], email: `${run}-${name}@example.invalid`, firstName: "Synthetic", lastName: name, passwordHash: "synthetic-only", assignedSiteId: site, roles: { create: { roleId: ids[role] } } } }); ids[name+"User"] = user.id;
      const session = await prisma.refreshSession.create({ data: { tenantId: ids[tenant], userId: user.id, tokenHash: `${run}-${name}`, expiresAt: new Date(Date.now()+3600000) } });
      tokens[name] = signTenantAccessToken({ tenantId: ids[tenant], userId: user.id, sessionId: session.id });
    }
    ids.customer = (await prisma.rentalCustomer.create({ data: { tenantId: ids.a, firstName: "Shared", lastName: "Synthetic" } })).id;
    ids.noBookingsCustomer = (await prisma.rentalCustomer.create({ data: { tenantId: ids.a, firstName: "NoBookings", lastName: "Synthetic" } })).id;
    for (const [name, tenant, vehicle, site, destination, code] of [
      ["cross", "a", "roma", ids.roma, ids.milano, "ROME_MILAN"], ["local", "a", "roma", ids.roma, ids.roma, "ROME_LOCAL"],
      ["napoli", "a", "napoli", ids.napoli, ids.napoli, "NAPOLI_PRIVATE"], ["legacy", "a", "roma", null, null, "UNCLASSIFIED_PRIVATE"],
      ["foreign", "b", "foreignSite", ids.foreignSite, ids.foreignSite, "FOREIGN_PRIVATE"]
    ] as const) {
      ids[name+"Booking"] = (await prisma.rentalBooking.create({ data: { tenantId: ids[tenant], vehicleId: ids[vehicle+"Vehicle"], customerId: tenant === "a" ? ids.customer : null, customerName: code, code: `${run}-${code}`, status: "CONFIRMED", siteId: site, pickupSiteId: site, returnSiteId: destination, pickupAt: new Date(name === "legacy" ? "2035-02-11T09:00:00Z" : name === "local" ? "2035-02-05T09:00:00Z" : "2035-02-01T09:00:00Z"), returnAt: new Date(name === "legacy" ? "2035-02-12T09:00:00Z" : name === "local" ? "2035-02-06T09:00:00Z" : "2035-02-03T09:00:00Z"), expectedTotal: 122 } })).id;
    }
    for(const name of ["cross","local","napoli"]) await prisma.bookingContract.create({data:{tenantId:ids.a,bookingId:ids[name+"Booking"],title:name,content:name,status:"DRAFT"}});
    for (const [name, bookingId] of [["shared", null], ["rome-doc", ids.localBooking], ["NAPOLI_PRIVATE", ids.napoliBooking]] as const) ids[name+"Attachment"] = (await prisma.rentalCustomerAttachment.create({ data: { tenantId: ids.a, customerId: ids.customer, bookingId, filePath: `synthetic/${name}.pdf`, fileName: `${name}.pdf`, mimeType: "application/pdf", sizeBytes: 10 } })).id;
    for (const name of ["roma", "napoli"]) ids[name+"Maintenance"] = (await prisma.vehicleMaintenance.create({ data: { tenantId: ids.a, vehicleId: ids[name+"Vehicle"], maintenanceType: `${name}_MAINTENANCE`, performedAt: new Date("2035-01-01"), cost: 15 } })).id;
    await storageProvider.write("synthetic/shared.pdf", Buffer.from("%PDF-1.4\nSynthetic shared document"));
    await storageProvider.write("synthetic/NAPOLI_PRIVATE.pdf", Buffer.from("%PDF-1.4\nSynthetic private document"));
    for (const name of ["roma", "napoli"]) ids[name+"Photo"] = (await prisma.vehiclePhoto.create({data:{vehicleId:ids[name+"Vehicle"],filePath:`synthetic/${name}.png`,fileName:`${name}.png`,mimeType:"image/png",sizeBytes:10}})).id;
    // Exercise product middleware directly, without injecting a test scope.
    const app=createApp();
    server = app.listen(0, "127.0.0.1"); await new Promise<void>(resolve => server!.once("listening", resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  });
  after(async () => {
    if (server?.listening) await new Promise<void>((resolve,reject) => server!.close(e => e ? reject(e) : resolve()));
    if (tenantIds.length) {
      const where = { tenantId: { in: tenantIds } };
      await prisma.calendarEvent.deleteMany({where}); await prisma.bookingContract.deleteMany({where}); await prisma.rentalBookingNote.deleteMany({ where }); await prisma.auditLog.deleteMany({ where });
      await prisma.rentalBookingCreateRequest.deleteMany({ where }); await prisma.rentalBooking.deleteMany({ where });
      await prisma.rentalCustomerAttachment.deleteMany({ where }); await prisma.rentalCustomer.deleteMany({ where });
      await prisma.vehicleMaintenance.deleteMany({ where }); await prisma.vehiclePhoto.deleteMany({where:{vehicle:{tenantId:{in:tenantIds}}}}); await prisma.vehicle.deleteMany({ where });
      await prisma.refreshSession.deleteMany({ where }); await prisma.userRole.deleteMany({ where: { user: where } }); await prisma.user.deleteMany({ where });
      await prisma.site.deleteMany({ where }); await prisma.tenantSubscription.deleteMany({ where }); await prisma.tenant.deleteMany({ where: { id: { in: tenantIds } } });
    }
    await prisma.$disconnect();
    if(process.env.UPLOAD_DIR?.startsWith("/private/tmp/fleetum-e02-core-uploads-")) await fs.rm(process.env.UPLOAD_DIR,{recursive:true,force:true});
  });
  it("limits booking rows, totals and KPIs while search and forged query filters cannot expand access", async () => {
    const list = await json("rome", "/rental-bookings?pageSize=100&siteId="+ids.napoli); assert.equal(list.total, 2); assert.equal(list.kpis.active, 2); forbiddenText(list);
    assert.equal((await json("rome", "/rental-bookings?search=NAPOLI_PRIVATE")).total, 0);
    assert.equal((await json("milan", "/rental-bookings")).total, 1);
    assert.equal((await json("unassigned", "/rental-bookings")).total, 0);
  });
  it("keeps manager aggregation and restricts selected-site views without accepting an operator all grant", async () => {
    assert.equal((await json("manager", "/rental-bookings")).total, 4);
    assert.equal((await json("manager", "/rental-bookings", ids.milano)).total, 1);
    assert.equal((await json("rome", "/rental-bookings", "all")).total, 2);
    assert.equal((await call("rome", "/rental-bookings", {site:ids.napoli})).status, 404);
  });
  it("guards details, quick view and pricing before returning outside-site data", async () => {
    for (const suffix of ["", "/quick", "/pricing", "/contract"]) assert.equal((await call("rome", `/rental-bookings/${ids.napoliBooking}${suffix}`)).status, 404, suffix);
    assert.equal((await call("milan", `/rental-bookings/${ids.crossBooking}/quick`)).status, 200);
    assert.equal((await call("rome", `/rental-bookings/${ids.legacyBooking}`)).status, 404);
    assert.equal((await call("foreign", `/rental-bookings/${ids.crossBooking}`)).status, 404);
  });
  it("rejects outside-site changes without notes, audit or parent mutations", async () => {
    const before = await prisma.rentalBooking.findUniqueOrThrow({ where:{id:ids.napoliBooking} });
    assert.equal((await call("rome", `/rental-bookings/${ids.napoliBooking}`, {method:"PATCH",body:{internalNotes:"SHOULD_NOT_WRITE"}})).status,404);
    assert.equal((await call("rome", `/rental-bookings/${ids.napoliBooking}/notes`, {method:"POST",body:{message:"SHOULD_NOT_WRITE"}})).status,404);
    const after = await prisma.rentalBooking.findUniqueOrThrow({ where:{id:ids.napoliBooking} }); assert.equal(after.updatedAt.getTime(),before.updatedAt.getTime());
    assert.equal(await prisma.rentalBookingNote.count({where:{tenantId:ids.a,bookingId:ids.napoliBooking}}),0);
    assert.equal((await call("milan", `/rental-bookings/${ids.crossBooking}/notes`, {method:"POST",body:{message:"Synthetic allowed handover note"}})).status,201);
  });
  it("shares the customer registry but limits booking counts, latest references and customer timelines", async () => {
    const list = await json("rome", "/rental-customers?pageSize=100"); assert.equal(list.total,2); forbiddenText(list); assert.ok(!JSON.stringify(list).includes("UNCLASSIFIED_PRIVATE"));
    const customer = list.data.find((row:any) => row.id===ids.customer); assert.equal(customer._count.bookings,2); assert.equal(customer.bookingsTotal,2);
    const profile = await json("milan", `/rental-customers/${ids.customer}`); assert.equal(profile._count.bookings,1); assert.equal(profile.attachments.length,1); forbiddenText(profile);
    const history = await json("rome", `/rental-customers/${ids.customer}/bookings`); assert.equal(history.total,2); forbiddenText(history);
  });
  it("scopes vehicle lookup and search and cannot transfer or create a vehicle into another site", async () => {
    const rows = await json("rome", "/master-data/vehicles?pageSize=100"); assert.equal(rows.total,1); assert.equal(rows.data[0].id,ids.romaVehicle);
    assert.equal((await json("rome", "/rental-bookings/suggest/vehicles?q=Synthetic&siteId="+ids.napoli)).data.length,0);
    assert.equal((await call("rome", `/master-data/vehicles/${ids.romaVehicle}`,{method:"PATCH",body:{siteId:ids.napoli}})).status,404);
    assert.equal((await call("rome", "/master-data/vehicles",{method:"POST",body:{siteId:ids.napoli,plate:"NO-WRITE",brand:"Synthetic",model:"Synthetic"}})).status,404);
    assert.equal((await prisma.vehicle.findUniqueOrThrow({where:{id:ids.romaVehicle}})).siteId,ids.roma);
    assert.equal((await call("rome",`/master-data/vehicles/${ids.romaVehicle}`,{method:"PATCH",body:{notes:"Synthetic allowed edit"}})).status,200);
  });
  it("limits maintenance lists and CSV exports and rejects mutations of a foreign-site parent", async () => {
    const rows=await json("rome","/master-data/vehicle-maintenances?pageSize=100");assert.equal(rows.total,1);assert.equal(rows.data[0].id,ids.romaMaintenance);
    const csv=await call("rome","/master-data/vehicle-maintenances/export.csv");assert.equal(csv.status,200);assert.ok(!(await csv.text()).includes("napoli_MAINTENANCE"));
    assert.equal((await call("rome",`/master-data/vehicle-maintenances/${ids.napoliMaintenance}`,{method:"DELETE"})).status,404);
  });
  it("hides unrelated booking identities in availability but keeps their vehicle busy", async () => {
    const day=await json("rome","/rental-bookings/availability/day?date=2035-02-11");assert.equal(day.summary.totalVehicles,1);assert.equal(day.summary.busyVehicles,1);assert.equal(day.data[0].isAvailable,false);assert.equal(day.data[0].bookings.length,0);assert.ok(!JSON.stringify(day).includes("UNCLASSIFIED_PRIVATE"));
    const month=await json("rome","/rental-bookings/availability/month?month=2035-02");assert.ok(!JSON.stringify(month).includes("UNCLASSIFIED_PRIVATE"));assert.equal(month.data[0].unavailableIntervals.length,1);forbiddenText(month);
  });
  it("preserves both involved sites after a vehicle transfer without exposing the destination fleet", async () => {
    await prisma.vehicle.update({where:{id:ids.romaVehicle},data:{siteId:ids.napoli}});
    try {
    assert.equal((await call("rome",`/rental-bookings/${ids.crossBooking}/quick`)).status,200);assert.equal((await call("milan",`/rental-bookings/${ids.crossBooking}/quick`)).status,200);
    assert.equal((await json("rome","/master-data/vehicles")).total,0);
    const monitoring=await json("manager","/rental-bookings/contracts?siteId="+ids.milano);assert.equal(monitoring.total,1);assert.equal(monitoring.kpis.contractsToSend,1);forbiddenText(monitoring);
    } finally { await prisma.vehicle.update({where:{id:ids.romaVehicle},data:{siteId:ids.roma}}); }
  });
  it("guards files and customer attachment IDs before touching storage or deleting outside-site records", async () => {
    let reads=0; const original=storageProvider.read, originalExists=storageProvider.exists; storageProvider.read=async key=>{reads++;return original.call(storageProvider,key);}; storageProvider.exists=async key=>{reads++;return originalExists.call(storageProvider,key);};
    try {
      assert.equal((await call("rome",`/uploads/vehicle-photos/${ids.napoliPhoto}/file`)).status,404);
      assert.equal((await call("rome",`/uploads/rental-customer-attachments/${ids.NAPOLI_PRIVATEAttachment}/file`)).status,404);assert.equal(reads,0);
      assert.equal((await call("rome",`/uploads/rental-customer-attachments/${ids.NAPOLI_PRIVATEAttachment}`,{method:"DELETE"})).status,404);
      assert.ok(await prisma.rentalCustomerAttachment.findUnique({where:{id:ids.NAPOLI_PRIVATEAttachment}}));
      const shared=await call("rome",`/uploads/rental-customer-attachments/${ids.sharedAttachment}/file`);assert.equal(shared.status,200);assert.equal(shared.headers.get("cache-control"),"private, no-store");
    } finally {storageProvider.read=original;storageProvider.exists=originalExists;}
  });
  it("cannot import new vehicles into another site in preview or commit mode", async () => {
    for(const dryRun of [true,false]) {
      const form=new FormData();form.set("file",new Blob(["targa,marca,modello,sede\nBLOCKED,Synthetic,Synthetic,napoli\n"],{type:"text/csv"}),"synthetic.csv");
      const response=await fetch(`${base}/master-data/vehicles/import?dryRun=${dryRun}`,{method:"POST",headers:{Authorization:`Bearer ${tokens.rome}`},body:form});
      assert.equal(response.status,200,await response.clone().text());const result:any=await response.json();assert.equal(result.validRows,0);assert.equal(result.inserted,0);assert.ok(result.errors.length>0);
    }
    assert.equal(await prisma.vehicle.count({where:{tenantId:ids.a,plate:"BLOCKED"}}),0);
    const allowed=new FormData();allowed.set("file",new Blob(["targa,marca,modello,sede\nALLOWED-IMPORT,Synthetic,Synthetic,roma\n"],{type:"text/csv"}),"synthetic.csv");
    const response=await fetch(base+"/master-data/vehicles/import?dryRun=false",{method:"POST",headers:{Authorization:`Bearer ${tokens.rome}`},body:allowed});assert.equal(response.status,200,await response.clone().text());assert.equal((await response.json() as any).inserted,1);
    const imported=await prisma.vehicle.findFirstOrThrow({where:{tenantId:ids.a,plate:"ALLOWED-IMPORT"}});assert.equal(imported.siteId,ids.roma);assert.equal((await call("rome",`/master-data/vehicles/${imported.id}`,{method:"DELETE"})).status,204);
  });
  it("does not erase another site deadline task when syncing the current site", async () => {
    const event=await prisma.calendarEvent.create({data:{tenantId:ids.a,userId:ids.romeUser,title:"Synthetic old task",description:`[[AUTO_VEICOLO|KM|${ids.napoliVehicle}]]`,startAt:new Date("2035-02-01"),endAt:new Date("2035-02-02"),type:"TASK"}});
    const response=await call("rome","/master-data/vehicle-deadlines/calendar-sync",{method:"POST",body:{includeSoon:false}});assert.equal(response.status,200,await response.clone().text());
    assert.ok(await prisma.calendarEvent.findUnique({where:{id:event.id}}));
  });
  it("rejects conflicting scheduling without disclosing a hidden booking code or ID", async () => {
    const response=await fetch(base+"/rental-bookings",{method:"POST",headers:{Authorization:`Bearer ${tokens.rome}`,"Content-Type":"application/json","X-Idempotency-Key":run+"-blocked"},body:JSON.stringify({vehicleId:ids.romaVehicle,customerId:ids.customer,pickupAt:"2035-02-11T10:00:00Z",returnAt:"2035-02-12T08:00:00Z",contractRequired:false})});
    assert.equal(response.status,409,await response.clone().text());const error=await response.text();assert.ok(!error.includes(ids.legacyBooking));assert.ok(!error.includes("UNCLASSIFIED_PRIVATE"));
  });
  it("isolates concurrent HTTP request contexts for different operators and manager views", async () => {
    const requests=Array.from({length:20},(_,i)=>{const who=["rome","milan","naples","unassigned"][i%4];return json(who,"/rental-bookings").then(result=>assert.equal(result.total,[2,1,1,0][i%4]));});await Promise.all(requests);
  });
  it("takes assignment, role and site deactivation into account on the next request", async () => {
    await prisma.user.update({where:{id:ids.romeUser},data:{assignedSiteId:ids.milano}});assert.equal((await json("rome","/rental-bookings")).total,1);
    await prisma.site.update({where:{id:ids.milano},data:{isActive:false}});assert.equal((await json("rome","/rental-bookings")).total,0);await prisma.site.update({where:{id:ids.milano},data:{isActive:true}});
    await prisma.userRole.deleteMany({where:{userId:ids.managerUser}});await prisma.userRole.create({data:{userId:ids.managerUser,roleId:ids.OPERATOR}});assert.equal((await json("manager","/rental-bookings")).total,0);
  });
});
