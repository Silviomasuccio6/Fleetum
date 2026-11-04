import {fileURLToPath} from "node:url";
import {assertSyntheticDatabase} from "../helpers/synthetic-database.js";
import assert from "node:assert/strict";
import {execFile} from "node:child_process";
import {promisify} from "node:util";
import {tmpdir} from "node:os";
import {join} from "node:path";
import { after, before, describe, it } from "node:test";
import fs from "node:fs/promises";
import { storageProvider } from "../../src/infrastructure/storage/storage-provider.js";
import type http from "node:http";
import type { AddressInfo } from "node:net";
import { SiteAccessReconciliationService } from "../../src/application/services/site-access-reconciliation-service.js";
import { dispatchContractEmail } from "../../src/infrastructure/email/contract-email-dispatch.js";
import { dispatchScheduledReport } from "../../src/infrastructure/email/scheduled-report-dispatch.js";
import { dispatchReminderEmail } from "../../src/infrastructure/email/reminder-email-dispatch.js";
import { dispatchExtraChargeNotice } from "../../src/infrastructure/email/extra-charge-notice.js";
import { runWithSiteAccess } from "../../src/infrastructure/auth/site-access-context.js";
import { LicensePolicyService } from "../../src/application/services/license-policy-service.js";
import { EmailQueueService } from "../../src/infrastructure/email/email-queue-service.js";
import { PrismaAuditLogRepository } from "../../src/infrastructure/repositories/prisma-audit-log-repository.js";
import { runReportsCronCycle } from "../../src/infrastructure/cron/reports-cron.js";
import { createApp, createPlatformApp } from "../../src/app.js";
import { prisma } from "../../src/infrastructure/database/prisma/client.js";
import { signTenantAccessToken } from "../helpers/http-auth.js";

const ids: Record<string, string> = {}, tokens: Record<string, string> = {};
const tenantIds: string[] = [];
const run = `site-rollout-${Date.now()}`;
let server: http.Server | undefined, base = "";
const call = (who: string, route: string, options: { method?: string; body?: object; site?: string; revision?: string } = {}) => fetch(base + route, {
  method: options.method ?? "GET", headers: { Authorization: `Bearer ${tokens[who]}`, ...(options.body ? { "Content-Type": "application/json" } : {}), ...(options.site ? { "X-Fleetum-Site": options.site } : {}), ...(options.revision ? { "X-Fleetum-Site-Revision": options.revision } : {}) },
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

describe("E02 complete tenant application without an injected test scope", () => {
  before(async () => {
    assertSyntheticDatabase({user:"fleetum_e02_rollout",database:"fleetum_e02_rollout_test",port:"61531",uploadPrefix:"/private/tmp/fleetum-e02-rollout-uploads-"});
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
    // Exercise the product router itself: no test middleware injects authority.
    const app = createApp();
    server = app.listen(0, "127.0.0.1"); await new Promise<void>(resolve => server!.once("listening", resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  });
  after(async () => {
    if (server?.listening) await new Promise<void>((resolve,reject) => server!.close(e => e ? reject(e) : resolve()));
    if (tenantIds.length) {
      const where = { tenantId: { in: tenantIds } };
      await prisma.emailQueue.deleteMany({where}); await prisma.scheduledReportCursor.deleteMany({where}); await prisma.calendarEvent.deleteMany({where}); await prisma.bookingContract.deleteMany({where}); await prisma.rentalBookingNote.deleteMany({ where }); await prisma.auditLog.deleteMany({ where });
      await prisma.rentalBookingCreateRequest.deleteMany({ where }); await prisma.rentalBooking.deleteMany({ where });
      await prisma.rentalCustomerAttachment.deleteMany({ where }); await prisma.rentalCustomer.deleteMany({ where });
      await prisma.vehicleMaintenance.deleteMany({ where }); await prisma.vehiclePhoto.deleteMany({where:{vehicle:{tenantId:{in:tenantIds}}}}); await prisma.vehicle.deleteMany({ where });
      await prisma.refreshSession.deleteMany({ where }); await prisma.userRole.deleteMany({ where: { user: where } }); await prisma.user.deleteMany({ where });
      await prisma.site.deleteMany({ where }); await prisma.tenantSubscription.deleteMany({ where }); await prisma.tenant.deleteMany({ where: { id: { in: tenantIds } } });
    }
    await prisma.$disconnect();
    if(process.env.UPLOAD_DIR?.startsWith("/private/tmp/fleetum-e02-rollout-uploads-")) await fs.rm(process.env.UPLOAD_DIR,{recursive:true,force:true});
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
    await prisma.userRole.deleteMany({where:{userId:ids.managerUser}});await prisma.userRole.create({data:{userId:ids.managerUser,roleId:ids.MANAGER}});
    await prisma.user.update({where:{id:ids.romeUser},data:{assignedSiteId:ids.roma}});
  });
  it("declares active enforcement only with product-level middleware in place", async()=>{
    const response=await call("rome","/auth/site-access");assert.equal(response.status,200);const ctx=(await response.json()as any).data;assert.equal(ctx.enforced,true);
    const rows=await call("rome","/rental-bookings",{revision:ctx.revision,site:ids.roma});assert.equal(rows.status,200);assert.equal(rows.headers.get("x-fleetum-site-revision"),ctx.revision);assert.equal(rows.headers.get("x-fleetum-site-view"),ids.roma);
  });
  it("rejects a stale view before reads or writes and does not mutate the target",async()=>{
    const response=await call("rome","/rental-bookings",{revision:"synthetic-stale",site:ids.roma});assert.equal(response.status,409);assert.equal((await response.json()as any).error,"SITE_CONTEXT_STALE");
    const before=await prisma.rentalBooking.findUniqueOrThrow({where:{id:ids.localBooking}});
    assert.equal((await call("rome",`/rental-bookings/${ids.localBooking}`,{method:"PATCH",body:{internalNotes:"MUST_NOT_WRITE"},site:ids.roma,revision:"synthetic-stale"})).status,409);
    const after=await prisma.rentalBooking.findUniqueOrThrow({where:{id:ids.localBooking}});assert.equal(after.updatedAt.getTime(),before.updatedAt.getTime());assert.notEqual(after.internalNotes,"MUST_NOT_WRITE");
  });
  it("applies a reassignment on the next protected request despite an unchanged access token",async()=>{
    const ctx=(await json("rome","/auth/site-access")).data;
    await prisma.user.update({where:{id:ids.romeUser},data:{assignedSiteId:ids.milano}});
    try{
      const old=await call("rome","/rental-bookings",{site:ids.roma,revision:ctx.revision});assert.equal(old.status,409);
      const current=await json("rome","/rental-bookings");assert.equal(current.total,1);assert.equal(current.data[0].id,ids.crossBooking);
      assert.equal((await call("rome",`/rental-bookings/${ids.localBooking}`)).status,404);
    }finally{await prisma.user.update({where:{id:ids.romeUser},data:{assignedSiteId:ids.roma}});}
  });
  it("accepts the explicit empty operator view without granting the aggregate",async()=>{
    const rows=await call("unassigned","/rental-bookings",{site:"none"});assert.equal(rows.status,200);assert.equal((await rows.json()as any).total,0);assert.equal(rows.headers.get("x-fleetum-site-view"),"none");
    assert.equal((await call("manager","/rental-bookings",{site:"none"})).status,400);
  });
  it("rejects malformed selectors and leaves public health and own authentication independent",async()=>{
    assert.equal((await call("manager","/rental-bookings",{site:"x".repeat(129)})).status,400);
    const health=await call("manager","/health",{site:"x".repeat(129),revision:"stale"});assert.equal(health.status,200);assert.equal(health.headers.get("x-fleetum-site-revision"),null);
    assert.equal((await call("unassigned","/auth/me",{site:"none"})).status,200);
  });
  it("keeps simultaneous tenant scopes independent",async()=>{
    const rows=await Promise.all(Array.from({length:12},(_,i)=>json("manager","/rental-bookings",i%2?ids.napoli:ids.roma)));
    rows.forEach((row,i)=>{assert.equal(row.total,i%2?1:2);assert.ok(!row.data.some((b:any)=>b.id===(i%2?ids.localBooking:ids.napoliBooking)));});
  });
  it("binds the revision to the exact account even with identical roles and update times",async()=>{
    const original=await prisma.user.findUniqueOrThrow({where:{id:ids.adminUser}}),other=await prisma.user.create({data:{tenantId:ids.a,email:run+"-same-authority@example.invalid",firstName:"Synthetic",lastName:"Same authority",passwordHash:"unused-synthetic",updatedAt:original.updatedAt,roles:{create:{roleId:ids.ADMIN}}}});
    const session=await prisma.refreshSession.create({data:{tenantId:ids.a,userId:other.id,tokenHash:run+"-same-authority",expiresAt:new Date(Date.now()+3600000)}});tokens.sameAuthority=signTenantAccessToken({tenantId:ids.a,userId:other.id,sessionId:session.id});
    assert.equal(other.updatedAt.getTime(),original.updatedAt.getTime());const a=(await json("admin","/auth/site-access")).data,b=(await json("sameAuthority","/auth/site-access")).data;assert.notEqual(a.revision,b.revision);
    assert.equal((await call("sameAuthority","/rental-bookings",{revision:a.revision,site:"all"})).status,409);
  });
  it("invalidates the browser revision after permission changes within the same role",async()=>{
    const old=(await json("rome","/auth/site-access")).data;const permission=await prisma.permission.findUniqueOrThrow({where:{key:"vehicles:read"}});const key={roleId:ids.OPERATOR,permissionId:permission.id};
    await prisma.rolePermission.delete({where:{roleId_permissionId:key}});
    try{const current=(await json("rome","/auth/site-access")).data;assert.notEqual(current.revision,old.revision);assert.equal((await call("rome","/rental-bookings",{site:ids.roma,revision:old.revision})).status,409);assert.equal((await call("rome","/rental-bookings",{site:ids.roma,revision:current.revision})).status,403);}finally{await prisma.rolePermission.create({data:key});}
  });
  it("exposes the scope confirmation to an allowed cross-origin browser",async()=>{
    const response=await fetch(base+"/rental-bookings",{headers:{Authorization:`Bearer ${tokens.rome}`,Origin:"http://localhost:5173"}});
    assert.equal(response.status,200);assert.equal(response.headers.get("access-control-allow-origin"),"http://localhost:5173");
    const exposed=response.headers.get("access-control-expose-headers")?.toLowerCase()??"";assert.ok(exposed.includes("x-fleetum-site-revision"));assert.ok(exposed.includes("x-fleetum-site-view"));
  });
  const reconciliation=new SiteAccessReconciliationService();
  it("inventories legacy data without personal fields or guessed booking sites",async()=>{
    const first=await reconciliation.plan(ids.a,ids.adminUser),again=await reconciliation.plan(ids.a,ids.adminUser);
    assert.equal(first.planHash,again.planHash);assert.ok(first.bookings.some(row=>row.id===ids.legacyBooking));assert.ok(first.users.some(row=>row.id===ids.unassignedUser));
    const text=JSON.stringify(first);for(const value of["UNCLASSIFIED_PRIVATE","@example.invalid","passwordHash","customerName","description"])assert.ok(!text.includes(value),value);
    await prisma.vehicle.update({where:{id:ids.romaVehicle},data:{siteId:ids.napoli}});try{assert.equal((await reconciliation.plan(ids.a,ids.adminUser)).planHash,first.planHash);}finally{await prisma.vehicle.update({where:{id:ids.romaVehicle},data:{siteId:ids.roma}});}
    assert.equal((await prisma.rentalBooking.findUniqueOrThrow({where:{id:ids.legacyBooking}})).siteId,null);
  });
  it("limits reconciliation to the active tenant administrator and full company view",async()=>{
    for(const who of["rome","manager","foreign"])await assert.rejects(reconciliation.plan(ids.a,ids[who+"User"]),(e:any)=>e.status===403||e.statusCode===403);
    await assert.rejects(runWithSiteAccess({tenantId:ids.a,canViewAllSites:true,allSites:false,siteIds:[ids.roma]},()=>reconciliation.plan(ids.a,ids.adminUser)),/tutte le sedi/);
  });
  it("rejects a changed plan rather than applying old mappings",async()=>{
    const plan=await reconciliation.plan(ids.a,ids.adminUser);await prisma.user.update({where:{id:ids.unassignedUser},data:{firstName:"Synthetic changed"}});
    try{await assert.rejects(reconciliation.apply(ids.a,ids.adminUser,{expectedPlanHash:plan.planHash,users:[{id:ids.unassignedUser,siteId:ids.roma}]}),(e:any)=>e.code==="SITE_RECONCILIATION_PLAN_CHANGED");assert.equal((await prisma.user.findUniqueOrThrow({where:{id:ids.unassignedUser}})).assignedSiteId,null);}finally{await prisma.user.update({where:{id:ids.unassignedUser},data:{firstName:"Synthetic"}});}
  });
  it("rolls back earlier mappings and their audits when a later row is invalid",async()=>{
    const plan=await reconciliation.plan(ids.a,ids.adminUser),audits=await prisma.auditLog.count({where:{tenantId:ids.a}});
    await assert.rejects(reconciliation.apply(ids.a,ids.adminUser,{expectedPlanHash:plan.planHash,users:[{id:ids.unassignedUser,siteId:ids.roma}],events:[{id:"synthetic-missing-event",confirmedPersonal:true}]}));
    assert.equal((await prisma.user.findUniqueOrThrow({where:{id:ids.unassignedUser}})).assignedSiteId,null);assert.equal(await prisma.auditLog.count({where:{tenantId:ids.a}}),audits);
  });
  it("rejects foreign and inactive destination sites with no booking attribution",async()=>{
    for(const site of[ids.foreignSite,ids.milano]){
      if(site===ids.milano)await prisma.site.update({where:{id:site},data:{isActive:false}});
      try{const plan=await reconciliation.plan(ids.a,ids.adminUser);await assert.rejects(reconciliation.apply(ids.a,ids.adminUser,{expectedPlanHash:plan.planHash,bookings:[{id:ids.legacyBooking,siteId:site,pickupSiteId:site,returnSiteId:site}]}));}finally{if(site===ids.milano)await prisma.site.update({where:{id:site},data:{isActive:true}});}
    }
    assert.equal((await prisma.rentalBooking.findUniqueOrThrow({where:{id:ids.legacyBooking}})).siteId,null);
  });
  it("never rewrites an existing historical attribution in a partially classified booking",async()=>{
    const row=await prisma.rentalBooking.create({data:{tenantId:ids.a,vehicleId:ids.romaVehicle,customerName:"Synthetic partial",code:run+"-partial",siteId:ids.roma,pickupAt:new Date("2036-02-01"),returnAt:new Date("2036-02-02")}});
    const plan=await reconciliation.plan(ids.a,ids.adminUser);await assert.rejects(reconciliation.apply(ids.a,ids.adminUser,{expectedPlanHash:plan.planHash,bookings:[{id:row.id,siteId:ids.napoli,pickupSiteId:ids.napoli,returnSiteId:ids.napoli}]}),(e:any)=>e.code==="SITE_RECONCILIATION_EXISTING_ATTRIBUTION");assert.equal((await prisma.rentalBooking.findUniqueOrThrow({where:{id:row.id}})).siteId,ids.roma);
  });
  it("applies only explicit historical sites and exposes a handover to both involved branches",async()=>{
    await prisma.vehicle.update({where:{id:ids.romaVehicle},data:{siteId:ids.napoli}});
    const before=await prisma.rentalBooking.findUniqueOrThrow({where:{id:ids.legacyBooking}}),plan=await reconciliation.plan(ids.a,ids.adminUser);
    const manifest={expectedPlanHash:plan.planHash,users:[{id:ids.unassignedUser,siteId:ids.roma}],bookings:[{id:ids.legacyBooking,siteId:ids.roma,pickupSiteId:ids.roma,returnSiteId:ids.milano}]};
    try{const result=await reconciliation.apply(ids.a,ids.adminUser,manifest);assert.deepEqual(result.counts,{users:1,bookings:1,events:0,quarantined:0});
      const after=await prisma.rentalBooking.findUniqueOrThrow({where:{id:before.id}});assert.equal(after.siteId,ids.roma);assert.equal(after.returnSiteId,ids.milano);assert.equal(after.vehicleId,before.vehicleId);assert.equal(after.expectedTotal,before.expectedTotal);assert.equal(after.customerId,before.customerId);
      for(const who of["rome","milan"])assert.equal((await call(who,`/rental-bookings/${before.id}/quick`)).status,200);assert.equal((await call("naples",`/rental-bookings/${before.id}/quick`)).status,404);
      await assert.rejects(reconciliation.apply(ids.a,ids.adminUser,manifest),(e:any)=>e.code==="SITE_RECONCILIATION_PLAN_CHANGED");
    }finally{await prisma.vehicle.update({where:{id:ids.romaVehicle},data:{siteId:ids.roma}});}
  });
  it("classifies a legacy personal event only after an explicit confirmation and keeps its owner",async()=>{
    const row=await prisma.calendarEvent.create({data:{tenantId:ids.a,userId:ids.romeUser,title:"Synthetic private legacy event",startAt:new Date("2035-01-01"),endAt:new Date("2035-01-02"),type:"TASK"}});
    const plan=await reconciliation.plan(ids.a,ids.adminUser,{events:[row.id]});assert.equal(plan.events.length,1);assert.equal(plan.bookings.length,0);
    await assert.rejects(reconciliation.apply(ids.a,ids.adminUser,{expectedPlanHash:plan.planHash,selection:{events:[row.id]},events:[{id:row.id,confirmedPersonal:false}]}));
    await reconciliation.apply(ids.a,ids.adminUser,{expectedPlanHash:plan.planHash,selection:{events:[row.id]},events:[{id:row.id,confirmedPersonal:true}]});
    assert.equal((await prisma.calendarEvent.findUniqueOrThrow({where:{id:row.id}})).userId,ids.romeUser);assert.equal(await prisma.auditLog.count({where:{tenantId:ids.a,userId:ids.romeUser,resourceId:row.id,action:"CALENDAR_SOURCE_V1"}}),1);
  });
  it("quarantines only selected unclaimed legacy commands and preserves receipt recovery",async()=>{
    const make=async(suffix:string,meta:object={},claimed=false)=>prisma.emailQueue.create({data:{tenantId:ids.a,type:"BOOKING_CONTRACT",recipient:"synthetic@example.invalid",subject:"Synthetic",body:"Synthetic",meta,processingToken:claimed?"synthetic-expired-claim":null,leaseExpiresAt:claimed?new Date(0):null}});
    const pending=await make("pending"),accepted=await make("accepted",{emailProvider:"resend",providerMessageId:"synthetic-accepted"}),claimed=await make("claimed",{},true);
    for(const row of[accepted,claimed]){const plan=await reconciliation.plan(ids.a,ids.adminUser,{queue:[row.id]});await assert.rejects(reconciliation.apply(ids.a,ids.adminUser,{expectedPlanHash:plan.planHash,selection:{queue:[row.id]},quarantineQueue:[row.id]}));assert.equal((await prisma.emailQueue.findUniqueOrThrow({where:{id:row.id}})).status,"PENDING");}
    const plan=await reconciliation.plan(ids.a,ids.adminUser,{queue:[pending.id]});await reconciliation.apply(ids.a,ids.adminUser,{expectedPlanHash:plan.planHash,selection:{queue:[pending.id]},quarantineQueue:[pending.id]});
    const after=await prisma.emailQueue.findUniqueOrThrow({where:{id:pending.id}});assert.equal(after.status,"FAILED");assert.equal(after.lastError,"SITE_LEGACY_REVIEW_REQUIRED");
  });
  it("blocks all four legacy dispatch paths before any provider invocation",async()=>{
    let sent=0;const deliver=async()=>{sent++;return{provider:"console"as const,id:"synthetic-never"};};const now=()=>new Date();
    const contract={id:"synthetic-legacy-contract",tenantId:ids.a,meta:{},recipient:"synthetic@example.invalid",subject:"Synthetic",body:"Synthetic"};
    await assert.rejects(dispatchContractEmail(contract,"synthetic",now,60000,deliver),/SITE_LEGACY_REVIEW_REQUIRED/);
    for(const type of["SCHEDULED_REPORT","REMINDER_EMAIL","RENTAL_EXTRA_CHARGE_NOTICE"]){
      const row=await prisma.emailQueue.create({data:{tenantId:ids.a,type,recipient:"synthetic@example.invalid",subject:"Synthetic",body:"Synthetic",meta:type==="REMINDER_EMAIL"?{reminderType:"MANUAL"}:{},processingToken:"synthetic-claim",leaseExpiresAt:new Date(Date.now()+60000)}});
      const fn=type==="SCHEDULED_REPORT"?dispatchScheduledReport:type==="REMINDER_EMAIL"?dispatchReminderEmail:dispatchExtraChargeNotice;
      assert.equal(await fn(row as any,"synthetic-claim",now,60000,deliver),null);const after=await prisma.emailQueue.findUniqueOrThrow({where:{id:row.id}});assert.equal(after.status,"FAILED");assert.ok(after.lastError?.includes("SITE_LEGACY_REVIEW_REQUIRED"));
    }
    assert.equal(sent,0);
  });
  it("pauses legacy report generation and visibly requires a fresh authorized confirmation",async()=>{
    const slot=new Date();slot.setDate(slot.getDate()+1);slot.setHours(8,0,0,0);
    const payload={enabled:true,recipients:["synthetic-report@example.invalid"],frequency:"daily",hour:8,minute:0,reportStyle:"BASIC"};
    const setting=await prisma.auditLog.create({data:{tenantId:ids.a,userId:ids.adminUser,resource:"reports",action:"SETTINGS_REPORTS",details:payload}});
    await prisma.scheduledReportCursor.create({data:{tenantId:ids.a,settingsAuditLogId:setting.id,timeZone:Intl.DateTimeFormat().resolvedOptions().timeZone,nextRunAt:slot}});
    const before=await prisma.emailQueue.count({where:{tenantId:ids.a,type:"SCHEDULED_REPORT"}});
    await runReportsCronCycle(new EmailQueueService(),new LicensePolicyService(new PrismaAuditLogRepository()),new Date(slot.getTime()+1000));
    assert.equal(await prisma.emailQueue.count({where:{tenantId:ids.a,type:"SCHEDULED_REPORT"}}),before);assert.equal((await prisma.scheduledReportCursor.findUniqueOrThrow({where:{tenantId:ids.a}})).lastSkipReason,"SITE_LEGACY_REVIEW_REQUIRED");
    const settings=await json("admin","/settings/reports");assert.equal(settings.siteConfirmationRequired,true);assert.ok(!("__siteAuthorization"in settings));
    assert.equal((await call("admin","/settings/reports",{method:"PUT",body:payload})).status,200);
    const confirmed=await json("admin","/settings/reports");assert.ok(!confirmed.siteConfirmationRequired);assert.ok(!("__siteAuthorization"in confirmed));
    await runReportsCronCycle(new EmailQueueService(),new LicensePolicyService(new PrismaAuditLogRepository()),new Date(slot.getTime()+1000));
    const pending=await prisma.emailQueue.findFirst({where:{tenantId:ids.a,type:"SCHEDULED_REPORT",status:"PENDING",recipient:"synthetic-report@example.invalid"},orderBy:{createdAt:"desc"}});assert.ok(pending);assert.equal((pending.meta as any).companyReportAuthorization.userId,ids.adminUser);
  });
  it("keeps Platform health independent of tenant site selectors and CORS confirmations",async()=>{
    const platform=createPlatformApp().listen(0,"127.0.0.1");await new Promise<void>(resolve=>platform.once("listening",resolve));
    try{const address=platform.address()as AddressInfo;const response=await fetch(`http://127.0.0.1:${address.port}/platform-api/health`,{headers:{Origin:"http://localhost:5174","X-Fleetum-Site":"not-a-tenant-site","X-Fleetum-Site-Revision":"stale"}});assert.equal(response.status,200);assert.equal(response.headers.get("x-fleetum-site-revision"),null);assert.ok(!(response.headers.get("access-control-expose-headers")??"").includes("Fleetum-Site"));}finally{await new Promise<void>(resolve=>platform.close(()=>resolve()));}
  });
  it("runs the maintenance CLI in read-only mode and applies an explicit private manifest",async()=>{
    const member=await prisma.user.create({data:{tenantId:ids.a,email:run+"-cli@example.invalid",firstName:"Synthetic CLI",lastName:"Synthetic",passwordHash:"unused-synthetic",roles:{create:{roleId:ids.OPERATOR}}}});
    const directory=await fs.mkdtemp(join(tmpdir(),`${run}-cli-`));
    const planPath=join(directory,"plan.json"),manifestPath=join(directory,"manifest.json"),receiptPath=join(directory,"receipt.json");
    const cli=["--import","tsx",fileURLToPath(new URL("../../src/scripts/reconcile-site-access.ts",import.meta.url)),"--tenant",ids.a,"--actor",ids.adminUser],execute=promisify(execFile);
    try{
      await execute(process.execPath,[...cli,"--output",planPath],{env:process.env,timeout:15000});
      const plan=JSON.parse(await fs.readFile(planPath,"utf8"));assert.ok(plan.users.some((row:any)=>row.id===member.id));assert.equal((await fs.stat(planPath)).mode&0o077,0);
      assert.equal((await prisma.user.findUniqueOrThrow({where:{id:member.id}})).assignedSiteId,null);
      await fs.writeFile(manifestPath,JSON.stringify({expectedPlanHash:plan.planHash,users:[{id:member.id,siteId:ids.roma}]}),{mode:0o600});
      await execute(process.execPath,[...cli,"--apply",manifestPath,"--output",receiptPath],{env:process.env,timeout:15000});
      assert.equal(JSON.parse(await fs.readFile(receiptPath,"utf8")).counts.users,1);assert.equal((await prisma.user.findUniqueOrThrow({where:{id:member.id}})).assignedSiteId,ids.roma);
      const receipt=await fs.readFile(receiptPath,"utf8");await assert.rejects(execute(process.execPath,[...cli,"--apply",manifestPath,"--output",receiptPath],{env:process.env,timeout:15000}));assert.equal(await fs.readFile(receiptPath,"utf8"),receipt);
    }finally{await fs.rm(directory,{recursive:true,force:true});}
  });
  it("refuses truncated inventories and supports an explicitly selected reconciliation batch",async()=>{
    const entries=Array.from({length:501},(_,i)=>({id:run+"-batch-"+String(i).padStart(3,"0"),tenantId:ids.a,userId:ids.romeUser,title:"Synthetic batch event",startAt:new Date("2035-04-01"),endAt:new Date("2035-04-02"),type:"TASK"as const}));await prisma.calendarEvent.createMany({data:entries});
    const full=await reconciliation.plan(ids.a,ids.adminUser);assert.equal(full.complete,false);await assert.rejects(reconciliation.apply(ids.a,ids.adminUser,{expectedPlanHash:full.planHash,events:[{id:entries[0].id,confirmedPersonal:true}]}),(e:any)=>e.code==="SITE_RECONCILIATION_PLAN_INCOMPLETE");
    const selection={events:[entries[0].id]},batch=await reconciliation.plan(ids.a,ids.adminUser,selection);assert.equal(batch.complete,true);assert.equal(batch.events.length,1);
    await reconciliation.apply(ids.a,ids.adminUser,{expectedPlanHash:batch.planHash,selection,events:[{id:entries[0].id,confirmedPersonal:true}]});assert.equal(await prisma.auditLog.count({where:{tenantId:ids.a,action:"CALENDAR_SOURCE_V1",resourceId:{in:entries.map(row=>row.id)}}}),1);
  });
});
