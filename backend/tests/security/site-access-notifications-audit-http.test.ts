import {assertSyntheticDatabase} from "../helpers/synthetic-database.js";
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import type http from "node:http";
import type { AddressInfo } from "node:net";
import { createApp } from "../../src/app.js";
import { prisma } from "../../src/infrastructure/database/prisma/client.js";
import { requireAuth } from "../../src/interfaces/http/middlewares/auth.js";
import { SiteAccessService } from "../../src/application/services/site-access-service.js";
import { runWithSiteAccess } from "../../src/infrastructure/auth/site-access-context.js";
import { PrismaAuditLogRepository } from "../../src/infrastructure/repositories/prisma-audit-log-repository.js";
import { signTenantAccessToken } from "../helpers/http-auth.js";
import { notificationStreamReader } from "../../src/interfaces/http/utils/notification-stream-reader.js";
import { currentSiteAccess } from "../../src/infrastructure/auth/site-access-context.js";
import { EmailQueueService } from "../../src/infrastructure/email/email-queue-service.js";
import { emailSender } from "../../src/infrastructure/email/email-sender.js";
import { RentalBookingsController } from "../../src/interfaces/http/controllers/rental-bookings-controller.js";

const ids: Record<string,string> = {}, tokens: Record<string,string> = {}, tenants: string[] = [];
const run = `notifications-scope-${Date.now()}`;
let server: http.Server | undefined, base = "";
const sent: unknown[] = [], originalSend=emailSender.send;
const call = (who: string, path: string, site?: string) => fetch(base + path, { headers: {
  Authorization: `Bearer ${tokens[who]}`, ...(site ? { "X-Fleetum-Site": site } : {})
} });
const json = async (who: string, path: string, site?: string) => {
  const response = await call(who,path,site);
  assert.equal(response.status,200,await response.clone().text());
  return response.json() as Promise<any>;
};
const audit = (who: string, suffix = "", site?: string) => json(who,"/audit/logs" + suffix,site);
const absent = (value: unknown, ...markers: string[]) => {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  for (const marker of markers) assert.ok(!text.includes(marker), `unexpected ${marker}`);
};
const streamRead = async (who: string, read: ()=>Promise<unknown>, site?: string, scoped=true) => {
  const req={headers:{authorization:`Bearer ${tokens[who]}`}} as any,res={} as any;
  await new Promise<void>((resolve,reject)=>{void requireAuth(req,res,error=>error?reject(error):resolve());});
  const make=()=>notificationStreamReader(req,res,{inbox:read} as any);
  return scoped ? runWithSiteAccess(await new SiteAccessService().resolveSelectedScope(req.auth.tenantId,req.auth.userId,site),make) : make();
};
const enqueueContract=async(authorization:unknown={version:1,userId:ids.romeUser,allSites:false,siteIds:[ids.rome]},booking="local",extraMeta:Record<string,unknown>={})=>{
  const delivery=await prisma.bookingContractDelivery.create({data:{tenantId:ids.a,bookingId:ids[booking+"Booking"],contractId:ids[booking+"Contract"],channel:"EMAIL",recipient:"synthetic@example.invalid",subject:"Synthetic",body:"Synthetic"}});
  const queue=await new EmailQueueService().enqueue({tenantId:ids.a,type:"BOOKING_CONTRACT",recipient:delivery.recipient,subject:delivery.subject!,body:delivery.body!,meta:{tenantId:ids.a,bookingId:delivery.bookingId,contractId:delivery.contractId,contractDeliveryId:delivery.id,actorUserId:ids.romeUser,siteAuthorization:authorization,...extraMeta}});
  return{delivery,queue};
};

describe("E02 notifications and public audit views", () => {
  before(async () => {
    assertSyntheticDatabase({user:"fleetum_e02_notifications",database:"fleetum_e02_notifications_test",port:"61525"});
    assert.equal(process.env.NODE_ENV,"test");
    assert.equal(process.env.DOTENV_CONFIG_PATH,"/dev/null");
    const target = new URL(process.env.DATABASE_URL!);


    for (const role of ["ADMIN","MANAGER","OPERATOR"]) {
      ids[role] = (await prisma.role.upsert({where:{key:role},update:{},create:{key:role,name:role}})).id;
      for (const key of ["dashboard:read","users:read","vehicles:write"]) {
        const p = await prisma.permission.upsert({where:{key},update:{},create:{key,description:"Synthetic"}});
        ids[key] = p.id;
        await prisma.rolePermission.upsert({where:{roleId_permissionId:{roleId:ids[role],permissionId:p.id}},update:{},create:{roleId:ids[role],permissionId:p.id}});
      }
    }
    for (const name of ["a","b"]) {
      ids[name] = (await prisma.tenant.create({data:{name:`${run}-${name}`}})).id; tenants.push(ids[name]);
      await prisma.tenantSubscription.create({data:{tenantId:ids[name],provider:"local",status:"ACTIVE",plan:"ENTERPRISE",seats:30}});
    }
    for (const [name,tenant] of [["rome","a"],["milan","a"],["naples","a"],["foreign","b"]]) {
      ids[name] = (await prisma.site.create({data:{tenantId:ids[tenant],name:`SYN-${name}`,address:"Synthetic",city:"Synthetic"}})).id;
      ids[name+"Vehicle"] = (await prisma.vehicle.create({data:{tenantId:ids[tenant],siteId:ids[name],plate:`SYN-${name}`,brand:"Synthetic",model:"Synthetic",revisionDueAt:new Date(Date.now()-86400000)}})).id;
    }
    for (const [name,role,tenant,site] of [["rome","OPERATOR","a",ids.rome],["milan","OPERATOR","a",ids.milan],["unassigned","OPERATOR","a",null],["manager","MANAGER","a",null],["foreign","ADMIN","b",null]] as const) {
      const user = await prisma.user.create({data:{tenantId:ids[tenant],email:`${run}-${name}@example.invalid`,firstName:"Synthetic",lastName:name,passwordHash:"synthetic-unused",assignedSiteId:site,roles:{create:{roleId:ids[role]}}}});
      ids[name+"User"] = user.id;
      const session = await prisma.refreshSession.create({data:{tenantId:ids[tenant],userId:user.id,tokenHash:`${run}-${name}`,expiresAt:new Date(Date.now()+3600000)}});
      ids[name+"Session"] = session.id;
      tokens[name] = signTenantAccessToken({tenantId:ids[tenant],userId:user.id,sessionId:session.id});
    }
    for (const name of ["rome","milan"]) {
      ids[name+"Invite"] = (await prisma.user.create({data:{tenantId:ids.a,email:`${run}-${name}-invite@example.invalid`,firstName:"Synthetic",lastName:`${name}-invite`,passwordHash:"synthetic-unused",status:"INVITED",assignedSiteId:ids[name]}})).id;
      const workshop = await prisma.workshop.create({data:{tenantId:ids.a,name:`SYN-${name}`}});
      ids[name+"Stop"] = (await prisma.stoppage.create({data:{tenantId:ids.a,siteId:ids[name],vehicleId:ids.milanVehicle,workshopId:workshop.id,createdByUserId:ids[name+"User"],reason:"Synthetic",openedAt:new Date(Date.now()-10*86400000)}})).id;
      ids[name+"Reminder"] = (await prisma.reminder.create({data:{tenantId:ids.a,stoppageId:ids[name+"Stop"],type:"MANUAL",channel:"EMAIL",recipient:`${name}@example.invalid`,body:"Synthetic",success:false,errorMessage:"SYNTHETIC_PRIVATE_PROVIDER_PAYLOAD"}})).id;
    }
    ids.customer = (await prisma.rentalCustomer.create({data:{tenantId:ids.a,firstName:"Synthetic",lastName:"Shared"}})).id;
    for (const [name,tenant,vehicle,site,destination] of [["local","a",ids.milanVehicle,ids.rome,ids.rome],["cross","a",ids.naplesVehicle,ids.rome,ids.milan],["private","a",ids.romeVehicle,ids.milan,ids.milan],["legacy","a",ids.romeVehicle,null,null],["foreign","b",ids.foreignVehicle,ids.foreign,ids.foreign],["corrupt","a",ids.foreignVehicle,ids.rome,ids.rome]] as const) {
      ids[name+"Booking"] = (await prisma.rentalBooking.create({data:{tenantId:ids[tenant],vehicleId:vehicle,siteId:site,pickupSiteId:site,returnSiteId:destination,code:`${run}-${name}`,customerName:"Synthetic",pickupAt:new Date(),returnAt:new Date(Date.now()+86400000)}})).id;
      ids[name+"Contract"] = (await prisma.bookingContract.create({data:{tenantId:ids[tenant],bookingId:ids[name+"Booking"],title:"Synthetic",content:"Synthetic"}})).id;
    }
    const entries: Array<[string,string,string|null,string?,string?]> = [
      ["romeVehicleAudit","Vehicle",ids.romeVehicle], ["milanVehicleAudit","Vehicle",ids.milanVehicle],
      ["romeStopAudit","Stoppage",ids.romeStop], ["milanStopAudit","Stoppage",ids.milanStop],
      ["localContractAudit","BookingContract",ids.localContract], ["crossContractAudit","BookingContract",ids.crossContract],
      ["privateContractAudit","BookingContract",ids.privateContract], ["legacyContractAudit","BookingContract",ids.legacyContract],
      ["corruptContractAudit","BookingContract",ids.corruptContract], ["foreignPointerAudit","BookingContract",ids.foreignContract],
      ["sharedCustomerAudit","RentalCustomer",ids.customer], ["milanUserAudit","user",ids.milanUser],
      ["romeUploadAudit","VehiclePhoto",ids.romeVehicle,"DOCUMENT_UPLOAD"],
      ["missingUploadAudit","VehiclePhoto","synthetic-removed-child","DOCUMENT_DELETE"],
      ["unknownAudit","UnknownLegacy","synthetic-untrusted-pointer"],
      ["googleAudit","integrations",null,"SETTINGS_GOOGLE_CALENDAR"],
      ["foreignActorAudit","Vehicle",ids.romeVehicle,"DOCUMENT_DOWNLOAD",ids.foreignUser]
    ];
    for (const [name,resource,resourceId,action,userId] of entries) {
      ids[name] = (await prisma.auditLog.create({data:{tenantId:ids.a,userId:userId??ids.managerUser,resource,resourceId,action:action??"SYNTHETIC_EVENT",details:{refreshToken:"SYNTHETIC_SECRET_TOKEN",before:{bookingId:ids.privateBooking,email:"private@example.invalid"},__meta:{hash:"SYNTHETIC_ORIGINAL_HASH"}}}})).id;
    }
    for (let i=0;i<25;i++) await prisma.auditLog.create({data:{tenantId:ids.a,userId:ids.milanUser,action:"SYNTHETIC_HIDDEN",resource:"Vehicle",resourceId:ids.milanVehicle,details:{private:true}}});
    await prisma.auditLog.create({data:{tenantId:ids.b,action:"FOREIGN_TENANT_AUDIT",resource:"Vehicle",resourceId:ids.foreignVehicle}});
    emailSender.send=async input=>{sent.push(input);return{provider:"resend",id:"synthetic-contract-receipt"};};
    const app=createApp(); server=app.listen(0,"127.0.0.1");
    await new Promise<void>(resolve=>server!.once("listening",resolve));
    base=`http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  });
  after(async()=>{
    await new Promise<void>(resolve=>server ? server.close(()=>resolve()):resolve());
    const where={tenantId:{in:tenants}};
    emailSender.send=originalSend;
    for (const model of [prisma.auditLog,prisma.reminder,prisma.stoppage,prisma.bookingContractEmailRequest,prisma.bookingContractEvent,prisma.bookingContractDelivery,prisma.emailQueue,prisma.bookingContract,prisma.rentalBooking,prisma.rentalCustomer,prisma.vehicle,prisma.workshop,prisma.refreshSession] as any[]) await model.deleteMany({where});
    await prisma.userRole.deleteMany({where:{user:{tenantId:{in:tenants}}}});
    await prisma.user.deleteMany({where}); await prisma.site.deleteMany({where});
    await prisma.tenantSubscription.deleteMany({where}); await prisma.tenant.deleteMany({where:{id:{in:tenants}}});
    await prisma.$disconnect();
  });
  it("filters vehicle deadlines, invited colleagues and reminders before the inbox limit",async()=>{
    const data=await json("rome","/notifications/inbox");
    const text=JSON.stringify(data);
    assert.ok(text.includes(ids.romeVehicle)); assert.ok(text.includes(ids.romeInvite)); assert.ok(text.includes(ids.romeStop));
    absent(data,ids.milanVehicle,ids.milanInvite,ids.milanStop,ids.milanReminder,ids.foreignVehicle);
  });
  it("does not expose stored provider errors through reminder descriptions",async()=>{
    absent(await json("rome","/notifications/inbox"),"SYNTHETIC_PRIVATE_PROVIDER_PAYLOAD");
  });
  it("supports manager all/single views and an empty unassigned inbox",async()=>{
    assert.ok(JSON.stringify(await json("manager","/notifications/inbox")).includes(ids.milanVehicle));
    absent(await json("manager","/notifications/inbox",ids.rome),ids.milanVehicle,ids.milanInvite);
    assert.deepEqual((await json("unassigned","/notifications/inbox")).data,[]);
  });
  it("restricts audit count, pagination and export before LIMIT",async()=>{
    const result=await audit("rome","?page=1&pageSize=10");
    const expected=["romeVehicleAudit","romeStopAudit","localContractAudit","crossContractAudit","sharedCustomerAudit","romeUploadAudit","foreignActorAudit"].map(k=>ids[k]);
    assert.equal(result.total,expected.length); assert.deepEqual(result.data.map((r:any)=>r.id).sort(),expected.sort());
    assert.deepEqual((await audit("rome","?page=2&pageSize=10")).data,[]);
    const csv=await (await call("rome","/audit/logs/export.csv")).text();
    assert.equal(csv.trim().split("\n").length,expected.length+1);
    for(const key of ["romeVehicle","romeStop","localContract","crossContract","customer"]) assert.ok(csv.includes(ids[key]));
    absent(csv,ids.milanVehicle,ids.privateContract,ids.foreignContract,"SYNTHETIC_HIDDEN","SYNTHETIC_SECRET_TOKEN");
  });
  it("uses historical booking and stoppage sites independently of the current vehicle",async()=>{
    const result=await audit("rome"); const rows=result.data.map((r:any)=>r.id);
    assert.ok(rows.includes(ids.localContractAudit)); assert.ok(rows.includes(ids.crossContractAudit)); assert.ok(rows.includes(ids.romeStopAudit));
    absent(result,ids.privateContractAudit,ids.legacyContractAudit,ids.corruptContractAudit);
    assert.ok((await audit("manager","",ids.milan)).data.some((r:any)=>r.id===ids.crossContractAudit));
  });
  it("redacts copied details and foreign actors in every public view, including company exports",async()=>{
    for(const who of ["rome","manager"]) {
      const data=await audit(who,"?pageSize=200");
      absent(data,"SYNTHETIC_SECRET_TOKEN","SYNTHETIC_ORIGINAL_HASH","private@example.invalid",ids.privateBooking,ids.foreignUser);
      for(const row of data.data) assert.deepEqual(row.details,{redacted:true});
      absent(await (await call(who,"/audit/logs/export.csv")).text(),"SYNTHETIC_SECRET_TOKEN","SYNTHETIC_ORIGINAL_HASH",ids.foreignContract);
    }
  });
  it("keeps unknown/global headers manager-only without unverified resource pointers",async()=>{
    const manager=await audit("manager","?pageSize=200");
    const row=manager.data.find((r:any)=>r.id===ids.unknownAudit);
    assert.ok(row); assert.equal(row.resourceId,null);
    assert.ok(manager.data.some((r:any)=>r.id===ids.googleAudit));
    absent(await audit("rome"),ids.unknownAudit,ids.googleAudit,ids.missingUploadAudit);
    assert.equal((await audit("unassigned")).total,0);
    absent(manager,ids.foreignPointerAudit,ids.corruptContractAudit);
  });
  it("preserves original audit payloads and internal settings lookups",async()=>{
    const row=await new PrismaAuditLogRepository().getLatestByAction(ids.a,"integrations","SETTINGS_GOOGLE_CALENDAR");
    assert.equal((row!.details as any).refreshToken,"SYNTHETIC_SECRET_TOKEN");
    assert.equal((row!.details as any).__meta.hash,"SYNTHETIC_ORIGINAL_HASH");
  });
  it("rechecks site assignments on the next request and ignores tenant query overrides",async()=>{
    await prisma.user.update({where:{id:ids.romeUser},data:{assignedSiteId:ids.milan}});
    try{absent(await audit("rome","?tenantId="+ids.b),ids.romeVehicleAudit,ids.localContractAudit,"FOREIGN_TENANT_AUDIT");}
    finally{await prisma.user.update({where:{id:ids.romeUser},data:{assignedSiteId:ids.rome}});}
  });
  it("sets private no-store on notifications, audit and audit CSV",async()=>{
    for(const route of ["/notifications/inbox","/audit/logs","/audit/logs/export.csv"]){const response=await call("rome",route);assert.equal(response.status,200);assert.equal(response.headers.get("cache-control"),"private, no-store");await response.text();}
  });
  it("rejects invalid audit pagination with a controlled client error",async()=>{
    for(const query of ["page=no","page=1.5","page=-1","pageSize=NaN","pageSize=201","page=999999999999999"]){assert.equal((await call("rome","/audit/logs?"+query)).status,422,query);}
  });
  it("preserves permission and tenant barriers",async()=>{
    const key={roleId_permissionId:{roleId:ids.OPERATOR,permissionId:ids["users:read"]}};
    await prisma.rolePermission.delete({where:key});
    try{for(const route of ["/audit/logs","/audit/logs/export.csv"]) assert.equal((await call("rome",route)).status,403);}
    finally{await prisma.rolePermission.create({data:{roleId:ids.OPERATOR,permissionId:ids["users:read"]}});}
    absent(await audit("foreign"),ids.a,ids.romeVehicleAudit);
  });
  it("isolates concurrent per-site contexts",async()=>{
    await Promise.all(Array.from({length:12},(_,i)=>audit(i%2?"rome":"milan").then(data=>absent(data,ids[(i%2?"milan":"rome")+"VehicleAudit"]))));
  });
  it("serves the real scoped stream and permits client disconnect",async()=>{
    const abort=new AbortController();
    const response=await fetch(base+"/notifications/stream",{headers:{Authorization:`Bearer ${tokens.rome}`},signal:abort.signal});
    try{
      assert.equal(response.status,200);assert.equal(response.headers.get("cache-control"),"private, no-store");
      const reader=response.body!.getReader(),chunk=await reader.read(),message=new TextDecoder().decode(chunk.value);
      assert.ok(message.startsWith("data: "));absent(message,ids.milanVehicle,ids.milanInvite,"SYNTHETIC_PRIVATE_PROVIDER_PAYLOAD");await reader.cancel();
    }finally{abort.abort();}
  });
  it("keeps a selected manager branch across stream polls",async()=>{
    const read=await streamRead("manager",async()=>currentSiteAccess(),ids.rome);
    assert.deepEqual((await read() as any).siteIds,[ids.rome]);
  });
  it("does not partially enable the site context on a legacy stream",async()=>{
    const read=await streamRead("manager",async()=>currentSiteAccess()??null,undefined,false);
    assert.equal(await read(),null);
  });
  it("rejects an open stream after assignment revocation, without reading another inbox",async()=>{
    let count=0;const read=await streamRead("rome",async()=>{count++;return[];});
    await prisma.user.update({where:{id:ids.romeUser},data:{assignedSiteId:ids.milan}});
    try{await assert.rejects(read());assert.equal(count,0);}
    finally{await prisma.user.update({where:{id:ids.romeUser},data:{assignedSiteId:ids.rome}});}
  });
  it("discards inbox data fetched while the requester is suspended",async()=>{
    const read=await streamRead("rome",async()=>{await prisma.user.update({where:{id:ids.romeUser},data:{status:"SUSPENDED"}});return[{id:"stale"}];});
    try{await assert.rejects(read());}finally{await prisma.user.update({where:{id:ids.romeUser},data:{status:"ACTIVE"}});}
  });
  it("rejects an existing stream after logout, permission removal, role change or tenant/license suspension",async()=>{
    for(const change of ["logout","permission","role","tenant","license"]){
      let count=0;const read=await streamRead("rome",async()=>{count++;return[];});
      const key={roleId_permissionId:{roleId:ids.OPERATOR,permissionId:ids["dashboard:read"]}};
      try{
        if(change==="logout")await prisma.refreshSession.update({where:{id:ids.romeSession},data:{revokedAt:new Date()}});
        if(change==="permission")await prisma.rolePermission.delete({where:key});
        if(change==="role"){await prisma.userRole.deleteMany({where:{userId:ids.romeUser}});await prisma.userRole.create({data:{userId:ids.romeUser,roleId:ids.MANAGER}});}
        if(change==="tenant")await prisma.tenant.update({where:{id:ids.a},data:{isActive:false}});
        if(change==="license")await prisma.tenantSubscription.update({where:{tenantId:ids.a},data:{status:"SUSPENDED"}});
        await assert.rejects(read());assert.equal(count,0,change);
      }finally{
        await prisma.refreshSession.update({where:{id:ids.romeSession},data:{revokedAt:null}});
        await prisma.rolePermission.upsert({where:key,update:{},create:{roleId:ids.OPERATOR,permissionId:ids["dashboard:read"]}});
        await prisma.userRole.deleteMany({where:{userId:ids.romeUser}});await prisma.userRole.create({data:{userId:ids.romeUser,roleId:ids.OPERATOR}});
        await prisma.tenant.update({where:{id:ids.a},data:{isActive:true}});
        await prisma.tenantSubscription.update({where:{tenantId:ids.a},data:{status:"ACTIVE"}});
      }
    }
  });
  it("blocks a queued contract after the requesting operator loses their site",async()=>{
    const delivery=await prisma.bookingContractDelivery.create({data:{tenantId:ids.a,bookingId:ids.localBooking,contractId:ids.localContract,channel:"EMAIL",recipient:"synthetic@example.invalid",subject:"Synthetic",body:"Synthetic"}});
    const queued=await new EmailQueueService().enqueue({tenantId:ids.a,type:"BOOKING_CONTRACT",recipient:delivery.recipient,subject:delivery.subject!,body:delivery.body!,meta:{tenantId:ids.a,bookingId:ids.localBooking,contractId:ids.localContract,contractDeliveryId:delivery.id,actorUserId:ids.romeUser,siteAuthorization:{version:1,userId:ids.romeUser,allSites:false,siteIds:[ids.rome]}}});
    const count=sent.length;await prisma.user.update({where:{id:ids.romeUser},data:{assignedSiteId:ids.milan}});
    try{
      await new EmailQueueService().processPending(new Date(),{ids:[queued.id],take:1});
      assert.equal(sent.length,count);assert.equal((await prisma.emailQueue.findUniqueOrThrow({where:{id:queued.id}})).status,"FAILED");
      assert.equal((await prisma.bookingContractDelivery.findUniqueOrThrow({where:{id:delivery.id}})).status,"FAILED");
    }finally{await prisma.user.update({where:{id:ids.romeUser},data:{assignedSiteId:ids.rome}});}
  });
  it("checks attachment targets, including shared customers with private booking documents",async()=>{
    const auditIds:string[]=[];
    const vp=await prisma.vehiclePhoto.create({data:{vehicleId:ids.romeVehicle,filePath:"synthetic-only",fileName:"Synthetic",mimeType:"image/png",sizeBytes:1}});
    const sp=await prisma.stoppagePhoto.create({data:{stoppageId:ids.romeStop,filePath:"synthetic-only",fileName:"Synthetic",mimeType:"image/png",sizeBytes:1}});
    const vb=await prisma.vehicleBooklet.create({data:{tenantId:ids.a,vehicleId:ids.romeVehicle,filePath:"synthetic-only",fileName:"Synthetic",mimeType:"application/pdf",sizeBytes:1}});
    const m=await prisma.vehicleMaintenance.create({data:{tenantId:ids.a,vehicleId:ids.romeVehicle,maintenanceType:"Synthetic",performedAt:new Date()}});
    const ma=await prisma.vehicleMaintenanceAttachment.create({data:{tenantId:ids.a,maintenanceId:m.id,filePath:"synthetic-only",fileName:"Synthetic",mimeType:"application/pdf",sizeBytes:1}});
    const shared=await prisma.rentalCustomerAttachment.create({data:{tenantId:ids.a,customerId:ids.customer,filePath:"synthetic-only",fileName:"Synthetic",mimeType:"application/pdf",sizeBytes:1}});
    const restricted=await prisma.rentalCustomerAttachment.create({data:{tenantId:ids.a,customerId:ids.customer,bookingId:ids.privateBooking,filePath:"synthetic-only",fileName:"Synthetic",mimeType:"application/pdf",sizeBytes:1}});
    try{
      for(const [resource,resourceId,action] of [["VehiclePhoto",vp.id,"DOCUMENT_DOWNLOAD"],["StoppagePhoto",sp.id,"DOCUMENT_DOWNLOAD"],["VehicleBooklet",vb.id,"DOCUMENT_UPLOAD"],["VehicleMaintenance",m.id,"UPDATE"],["VehicleMaintenanceAttachment",m.id,"DOCUMENT_UPLOAD"],["VehicleMaintenanceAttachment",ma.id,"DOCUMENT_DOWNLOAD"],["RentalCustomerAttachment",shared.id,"DOCUMENT_DOWNLOAD"],["RentalCustomerAttachment",restricted.id,"DOCUMENT_DOWNLOAD"]]){
        const row=await prisma.auditLog.create({data:{tenantId:ids.a,resource,resourceId,action}});auditIds.push(row.id);
      }
      const rows=(await audit("rome","?pageSize=200")).data.map((r:any)=>r.id);
      for(const id of auditIds.slice(0,-1)) assert.ok(rows.includes(id),id);
      assert.ok(!rows.includes(auditIds.at(-1)));assert.ok((await audit("manager","?pageSize=200")).data.some((r:any)=>r.id===auditIds.at(-1)));
    }finally{
      await prisma.auditLog.deleteMany({where:{id:{in:auditIds}}});await prisma.rentalCustomerAttachment.deleteMany({where:{id:{in:[shared.id,restricted.id]}}});
      await prisma.vehicleMaintenanceAttachment.delete({where:{id:ma.id}});await prisma.vehicleMaintenance.delete({where:{id:m.id}});
      await prisma.vehicleBooklet.delete({where:{id:vb.id}});await prisma.stoppagePhoto.delete({where:{id:sp.id}});await prisma.vehiclePhoto.delete({where:{id:vp.id}});
    }
  });
  it("captures site authority server-side and preserves a legitimate idempotent email request",async()=>{
    const queue=new EmailQueueService();
    const controller=new RentalBookingsController({enqueue:queue.enqueue.bind(queue),processPending:async()=>({processed:0})} as any,{contractBranding:async()=>({companyName:"Synthetic",companyEmail:"synthetic@example.invalid"})} as any);
    (controller as any).buildContractPdf=async()=>Buffer.from("synthetic pdf; not a physical file");
    const req={auth:{tenantId:ids.a,userId:ids.romeUser},params:{id:ids.localBooking},headers:{"x-idempotency-key":"synthetic-local-scope-email"},body:{to:"synthetic@example.invalid",siteAuthorization:{allSites:true}}} as any;
    const response=()=>({status(){return this;},json(){return this;},setHeader(){}} as any);
    const scope=await new SiteAccessService().resolveSelectedScope(ids.a,ids.romeUser);
    const count=await prisma.emailQueue.count({where:{tenantId:ids.a}});
    await runWithSiteAccess(scope,()=>controller.sendContractEmail(req,response()));
    await runWithSiteAccess(scope,()=>controller.sendContractEmail(req,response()));
    assert.equal(await prisma.emailQueue.count({where:{tenantId:ids.a}}),count+1);
    const request=await prisma.bookingContractEmailRequest.findUniqueOrThrow({where:{tenantId_idempotencyKey:{tenantId:ids.a,idempotencyKey:req.headers["x-idempotency-key"]}}});
    const queued=await prisma.emailQueue.findUniqueOrThrow({where:{id:request.queueEmailId}});
    assert.deepEqual((queued.meta as any).siteAuthorization,{version:1,userId:ids.romeUser,allSites:false,siteIds:[ids.rome]});
    const previous=sent.length;await new EmailQueueService().processPending(new Date(),{ids:[queued.id],take:1});
    assert.equal(sent.length,previous+1);assert.equal((await prisma.emailQueue.findUniqueOrThrow({where:{id:queued.id}})).status,"SENT");
  });
  it("rechecks the producer after PDF generation and leaves no outbox side effects on revocation",async()=>{
    const queue=new EmailQueueService(),controller=new RentalBookingsController({enqueue:queue.enqueue.bind(queue),processPending:async()=>({processed:0})} as any,{contractBranding:async()=>({companyName:"Synthetic"})} as any);
    (controller as any).buildContractPdf=async()=>{await prisma.user.update({where:{id:ids.romeUser},data:{assignedSiteId:ids.milan}});return Buffer.from("Synthetic");};
    const scope=await new SiteAccessService().resolveSelectedScope(ids.a,ids.romeUser),count=await prisma.emailQueue.count({where:{tenantId:ids.a}});
    try{
      await assert.rejects(runWithSiteAccess(scope,()=>controller.sendContractEmail({auth:{tenantId:ids.a,userId:ids.romeUser},params:{id:ids.localBooking},headers:{"x-idempotency-key":"synthetic-revoked"},body:{to:"synthetic@example.invalid"}} as any,{status(){return this;},json(){return this;}} as any)));
      assert.equal(await prisma.emailQueue.count({where:{tenantId:ids.a}}),count);
      assert.equal(await prisma.bookingContractEmailRequest.count({where:{tenantId:ids.a,idempotencyKey:"synthetic-revoked"}}),0);
    }finally{await prisma.user.update({where:{id:ids.romeUser},data:{assignedSiteId:ids.rome}});}
  });
  it("blocks queued contracts after suspension, permission loss, corrupt metadata, hidden booking or changed delivery",async()=>{
    for(const change of ["suspended","permission","malformed","hidden","tamper","license"]){
      const input=await enqueueContract(change==="malformed"?{version:1,allSites:true}:undefined,change==="hidden"?"private":"local");
      const count=sent.length,key={roleId_permissionId:{roleId:ids.OPERATOR,permissionId:ids["vehicles:write"]}};
      try{
        if(change==="suspended")await prisma.user.update({where:{id:ids.romeUser},data:{status:"SUSPENDED"}});
        if(change==="permission")await prisma.rolePermission.delete({where:key});
        if(change==="tamper")await prisma.emailQueue.update({where:{id:input.queue.id},data:{recipient:"other@example.invalid"}});
        if(change==="license")await prisma.tenantSubscription.update({where:{tenantId:ids.a},data:{status:"SUSPENDED"}});
        await new EmailQueueService().processPending(new Date(),{ids:[input.queue.id],take:1});assert.equal(sent.length,count,change);
        const row=await prisma.emailQueue.findUniqueOrThrow({where:{id:input.queue.id}});assert.equal(row.status,"FAILED",change);assert.match(row.lastError!,/^CONTRACT_DISPATCH_BLOCKED:/);
      }finally{
        await prisma.user.update({where:{id:ids.romeUser},data:{status:"ACTIVE"}});
        await prisma.rolePermission.upsert({where:key,update:{},create:{roleId:ids.OPERATOR,permissionId:ids["vehicles:write"]}});
        await prisma.tenantSubscription.update({where:{tenantId:ids.a},data:{status:"ACTIVE"}});
      }
    }
  });
  it("finalizes an already accepted receipt after revocation without sending again",async()=>{
    const input=await enqueueContract();const count=sent.length;
    await prisma.emailQueue.update({where:{id:input.queue.id},data:{meta:{...(input.queue.meta as any),emailProvider:"resend",providerMessageId:"synthetic-accepted-before-revocation",providerAcceptedAt:new Date().toISOString()}}});
    await prisma.user.update({where:{id:ids.romeUser},data:{status:"SUSPENDED"}});
    try{await new EmailQueueService().processPending(new Date(),{ids:[input.queue.id],take:1});assert.equal(sent.length,count);assert.equal((await prisma.emailQueue.findUniqueOrThrow({where:{id:input.queue.id}})).status,"SENT");}
    finally{await prisma.user.update({where:{id:ids.romeUser},data:{status:"ACTIVE"}});}
  });
  it("rejects foreign contract pointers without provider calls or foreign mutations",async()=>{
    const before=await prisma.bookingContract.findUniqueOrThrow({where:{id:ids.foreignContract}});
    const input=await enqueueContract(undefined,"foreign"),count=sent.length;
    await new EmailQueueService().processPending(new Date(),{ids:[input.queue.id],take:1});
    assert.equal(sent.length,count);assert.equal((await prisma.emailQueue.findUniqueOrThrow({where:{id:input.queue.id}})).status,"FAILED");
    assert.deepEqual(await prisma.bookingContract.findUniqueOrThrow({where:{id:ids.foreignContract}}),before);
  });
  it("permits a cross-site command and does not duplicate delivery under concurrent workers",async()=>{
    const input=await enqueueContract(undefined,"cross"),count=sent.length;
    await Promise.all([new EmailQueueService().processPending(new Date(),{ids:[input.queue.id],take:1}),new EmailQueueService().processPending(new Date(),{ids:[input.queue.id],take:1})]);
    assert.equal(sent.length,count+1);assert.equal((await prisma.emailQueue.findUniqueOrThrow({where:{id:input.queue.id}})).status,"SENT");
  });
  it("preserves company-wide and selected manager authority while rejecting an inactive selected site",async()=>{
    for(const [allSites,siteIds,booking] of [[true,[],"private"],[false,[ids.milan],"private"]] as Array<[boolean,string[],string]>){
      const input=await enqueueContract({version:1,userId:ids.managerUser,allSites,siteIds},booking,{actorUserId:ids.managerUser}),count=sent.length;
      await new EmailQueueService().processPending(new Date(),{ids:[input.queue.id],take:1});assert.equal(sent.length,count+1);
    }
    const input=await enqueueContract({version:1,userId:ids.managerUser,allSites:false,siteIds:[ids.rome]},"local",{actorUserId:ids.managerUser}),count=sent.length;
    await prisma.site.update({where:{id:ids.rome},data:{isActive:false}});
    try{await new EmailQueueService().processPending(new Date(),{ids:[input.queue.id],take:1});assert.equal(sent.length,count);assert.equal((await prisma.emailQueue.findUniqueOrThrow({where:{id:input.queue.id}})).status,"FAILED");}
    finally{await prisma.site.update({where:{id:ids.rome},data:{isActive:true}});}
  });
  it("rechecks authority immediately before provider initiation after an intervening permission change",async()=>{
    const input=await enqueueContract(),count=sent.length,transaction=prisma.$transaction;
    let changed=false;
    (prisma as any).$transaction=async(...args:any[])=>{
      if(typeof args[0]!=="function")return (transaction as any).apply(prisma,args);
      const callback=args[0];return (transaction as any).call(prisma,async(tx:any)=>{
        const wrapped=new Proxy(tx,{get(target,key){
          if(key!=="emailQueue")return Reflect.get(target,key);
          return new Proxy(target.emailQueue,{get(model,method){
            if(method!=="updateMany")return Reflect.get(model,method);
            return async(parameters:any)=>{
              if(!changed&&parameters.where?.processingToken&&parameters.data?.leaseExpiresAt){changed=true;await prisma.userRole.deleteMany({where:{userId:ids.romeUser}});}
              return model.updateMany(parameters);
            };
          }});
        }});return callback(wrapped);
      },...args.slice(1));
    };
    try{await new EmailQueueService().processPending(new Date(),{ids:[input.queue.id],take:1});assert.equal(changed,true);assert.equal(sent.length,count);assert.equal((await prisma.emailQueue.findUniqueOrThrow({where:{id:input.queue.id}})).status,"FAILED");}
    finally{prisma.$transaction=transaction;await prisma.userRole.upsert({where:{userId_roleId:{userId:ids.romeUser,roleId:ids.OPERATOR}},update:{},create:{userId:ids.romeUser,roleId:ids.OPERATOR}});}
  });
});
