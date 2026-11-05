import {assertSyntheticDatabase} from "../helpers/synthetic-database.js";
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import type http from "node:http";
import type { AddressInfo } from "node:net";
import fs from "node:fs/promises";
import { createApp } from "../../src/app.js";
import { prisma } from "../../src/infrastructure/database/prisma/client.js";
import { requireAuth } from "../../src/interfaces/http/middlewares/auth.js";
import { SiteAccessService } from "../../src/application/services/site-access-service.js";
import { runWithSiteAccess } from "../../src/infrastructure/auth/site-access-context.js";
import { storageProvider } from "../../src/infrastructure/storage/storage-provider.js";
import { emailSender } from "../../src/infrastructure/email/email-sender.js";
import { EmailQueueService } from "../../src/infrastructure/email/email-queue-service.js";
import { signTenantAccessToken } from "../helpers/http-auth.js";

const ids: Record<string,string>={}, tokens: Record<string,string>={};
const tenantIds:string[]=[];
const sent:unknown[]=[];
const originalSend=emailSender.send;
const run=`stoppage-site-${Date.now()}`;
let server:http.Server|undefined, base="";
const request=(who:string,route:string,options:{method?:string;body?:object;site?:string}={})=>fetch(base+route,{method:options.method??"GET",headers:{Authorization:`Bearer ${tokens[who]}`,...(options.body?{"Content-Type":"application/json"}:{}),...(options.site?{"X-Fleetum-Site":options.site}:{})},...(options.body?{body:JSON.stringify(options.body)}:{})});
const json=async(who:string,route:string,site?:string)=>{const r=await request(who,route,{site});assert.equal(r.status,200,await r.clone().text());return r.json() as Promise<any>;};
const hidden=(value:unknown)=>{const text=JSON.stringify(value);for(const secret of [ids.milanStop,ids.foreignStop,"MILAN_PRIVATE","FOREIGN_PRIVATE"])assert.ok(!text.includes(secret),secret);};
const body=(siteId=ids.rome,vehicleId=ids.romeVehicle)=>({siteId,vehicleId,workshopId:ids.workshop,reason:"Synthetic created stoppage",openedAt:new Date().toISOString()});
const pending=async(userId=ids.romeUser,allSites=false,siteIds=[ids.rome])=>new EmailQueueService().enqueue({tenantId:ids.a,type:"REMINDER_EMAIL",recipient:"synthetic-workshop@example.invalid",subject:"Synthetic",body:"Synthetic",meta:{tenantId:ids.a,stoppageId:ids.romeStop,reminderType:"MANUAL",siteAuthorization:{version:1,userId,allSites,siteIds}}});

describe("E02 stoppage operational-site HTTP and queued reminders",()=>{
  before(async()=>{
    assertSyntheticDatabase({user:"fleetum_e02_stoppage",database:"fleetum_e02_stoppage_test",port:"61523",uploadPrefix:"/private/tmp/fleetum-e02-stoppage-uploads-20261027"});
    assert.equal(process.env.NODE_ENV,"test");assert.equal(process.env.DOTENV_CONFIG_PATH,"/dev/null");assert.equal(storageProvider.name,"local");

    const target=new URL(process.env.DATABASE_URL!);
    emailSender.send=async input=>{sent.push(input);return{provider:"resend",id:"synthetic-receipt"};};
    for(const roleKey of ["ADMIN","MANAGER","OPERATOR"]){
      ids[roleKey]=(await prisma.role.upsert({where:{key:roleKey},update:{},create:{key:roleKey,name:roleKey}})).id;
      for(const key of ["stoppages:read","stoppages:write","stoppages:delete","stoppages:remind","vehicles:read"]){const permission=await prisma.permission.upsert({where:{key},update:{},create:{key,description:"Synthetic"}});ids[key]=permission.id;await prisma.rolePermission.upsert({where:{roleId_permissionId:{roleId:ids[roleKey],permissionId:permission.id}},update:{},create:{roleId:ids[roleKey],permissionId:permission.id}});}
    }
    for(const name of ["a","b"]){ids[name]=(await prisma.tenant.create({data:{name:`Synthetic ${run}-${name}`}})).id;tenantIds.push(ids[name]);await prisma.tenantSubscription.create({data:{tenantId:ids[name],provider:"test",plan:"ENTERPRISE",status:"ACTIVE",seats:20}});}
    for(const [name,tenant] of [["rome","a"],["milan","a"],["naples","a"],["foreign","b"]]){ids[name]=(await prisma.site.create({data:{tenantId:ids[tenant],name,address:"Synthetic",city:"Synthetic"}})).id;ids[name+"Vehicle"]=(await prisma.vehicle.create({data:{tenantId:ids[tenant],siteId:ids[name],plate:`${run}-${name}`,brand:"Synthetic",model:"Synthetic",createdAt:new Date("2020-01-01")}})).id;}
    for(const [name,role,tenant,site] of [["rome","OPERATOR","a",ids.rome],["milan","OPERATOR","a",ids.milan],["naples","OPERATOR","a",ids.naples],["unassigned","OPERATOR","a",null],["manager","MANAGER","a",null],["admin","ADMIN","a",null],["foreign","ADMIN","b",null]] as const){const user=await prisma.user.create({data:{tenantId:ids[tenant],email:`${run}-${name}@example.invalid`,firstName:"Synthetic",lastName:name,passwordHash:"synthetic-unused",assignedSiteId:site,roles:{create:{roleId:ids[role]}}}});ids[name+"User"]=user.id;const session=await prisma.refreshSession.create({data:{tenantId:ids[tenant],userId:user.id,tokenHash:`${run}-${name}`,expiresAt:new Date(Date.now()+3600000)}});tokens[name]=signTenantAccessToken({tenantId:ids[tenant],userId:user.id,sessionId:session.id});}
    ids.workshop=(await prisma.workshop.create({data:{tenantId:ids.a,name:"Synthetic workshop",email:"synthetic-workshop@example.invalid",whatsapp:"0000000000"}})).id;
    ids.foreignWorkshop=(await prisma.workshop.create({data:{tenantId:ids.b,name:"Foreign workshop",email:"synthetic-foreign@example.invalid"}})).id;
    for(const [name,tenant,site,vehicle,user,workshop,reason] of [["rome","a","rome","rome","rome",ids.workshop,"ROME_ALLOWED"],["milan","a","milan","milan","milan",ids.workshop,"MILAN_PRIVATE"],["historical","a","rome","naples","manager",ids.workshop,"ROME_HISTORICAL"],["foreign","b","foreign","foreign","foreign",ids.foreignWorkshop,"FOREIGN_PRIVATE"]]){
      ids[name+"Stop"]=(await prisma.stoppage.create({data:{tenantId:ids[tenant],siteId:ids[site],vehicleId:ids[vehicle+"Vehicle"],createdByUserId:ids[user+"User"],assignedToUserId:ids[user+"User"],workshopId:workshop,reason,openedAt:new Date(Date.now()-40*86400000),priority:"HIGH",estimatedCostPerDay:10,reminderAfterDays:1}})).id;
      for(const type of ["NOTE","PARTS_ORDER","CLOSURE_CHECKLIST","COST_APPROVAL_REQUEST","COST_APPROVAL_DECISION","FINAL_COST"])await prisma.stoppageEvent.create({data:{tenantId:ids[tenant],stoppageId:ids[name+"Stop"],userId:ids[user+"User"],type,message:reason,payload:{description:reason,actualTotalCost:45,approved:true,photosUploaded:true,finalCauseSet:true,finalCostSet:true,operatorSigned:true}}});
      ids[name+"Photo"]=(await prisma.stoppagePhoto.create({data:{stoppageId:ids[name+"Stop"],filePath:`synthetic/${name}.png`,fileName:`${name}.png`,mimeType:"image/png",sizeBytes:10}})).id;
    }
    await storageProvider.write("synthetic/rome.png",Buffer.from("synthetic-image"));
    // Product auth wiring remains unchanged. The harness installs the same fresh
    // server-resolved scope that must later be wired after every surface is safe.
    const app=createApp();server=app.listen(0,"127.0.0.1");await new Promise<void>(resolve=>server!.once("listening",resolve));base=`http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  });
  after(async()=>{
    if(server?.listening)await new Promise<void>((resolve,reject)=>server!.close(e=>e?reject(e):resolve()));emailSender.send=originalSend;
    if(tenantIds.length){const where={tenantId:{in:tenantIds}};await prisma.emailQueue.deleteMany({where});await prisma.reminder.deleteMany({where});await prisma.stoppageEvent.deleteMany({where});await prisma.stoppagePhoto.deleteMany({where:{stoppage:where}});await prisma.stoppage.deleteMany({where});await prisma.vehicle.deleteMany({where});await prisma.workshop.deleteMany({where});await prisma.auditLog.deleteMany({where});await prisma.refreshSession.deleteMany({where});await prisma.userRole.deleteMany({where:{user:where}});await prisma.user.deleteMany({where});await prisma.site.deleteMany({where});await prisma.tenantSubscription.deleteMany({where});await prisma.tenant.deleteMany({where:{id:{in:tenantIds}}});}await prisma.$disconnect();if(process.env.UPLOAD_DIR==="/private/tmp/fleetum-e02-stoppage-uploads-20261027")await fs.rm(process.env.UPLOAD_DIR,{recursive:true,force:true});
  });
  it("filters lists, search and forged site queries without using the current vehicle location",async()=>{
    const rows=await json("rome","/stoppages?pageSize=100");assert.equal(rows.total,2);hidden(rows);assert.ok(rows.data.some((x:any)=>x.id===ids.historicalStop));assert.equal((await json("rome","/stoppages?siteId="+ids.milan)).total,0);assert.equal((await json("rome","/stoppages?search=MILAN_PRIVATE")).total,0);assert.equal((await json("unassigned","/stoppages")).total,0);
  });
  it("retains manager all/single views while all cannot elevate an operator",async()=>{assert.equal((await json("manager","/stoppages")).total,3);assert.equal((await json("manager","/stoppages",ids.milan)).total,1);assert.equal((await json("rome","/stoppages","all")).total,2);});
  it("rejects foreign-site details, unrelated tenants and reminder previews",async()=>{for(const who of ["rome","foreign"])assert.equal((await request(who,`/stoppages/${ids.milanStop}`)).status,404);assert.equal((await request("rome",`/stoppages/${ids.milanStop}/reminders/template-preview`)).status,404);assert.equal((await request("rome",`/stoppages/${ids.milanStop}/reminders/whatsapp-link`)).status,404);});
  it("keeps notes, parts, cost approvals and closure details out of another branch",async()=>{for(const suffix of ["events","parts-orders","cost-approvals","closure-checklist"]){const value=await json("rome",`/stoppages/${ids.milanStop}/${suffix}`);hidden(value);}});
  it("rejects changes, deletion and workflow actions before mutating another branch",async()=>{
    const original=await prisma.stoppage.findUniqueOrThrow({where:{id:ids.milanStop}});
    for(const [suffix,method,payload] of [["","PATCH",{notes:"FORBIDDEN"}],["/status","PATCH",{status:"IN_PROGRESS"}],["/workflow/transition","POST",{toStatus:"IN_PROGRESS"}],["","DELETE",undefined]] as const){assert.equal((await request("rome",`/stoppages/${ids.milanStop}${suffix}`,{method,body:payload})).status,404);}
    assert.equal((await prisma.stoppage.findUniqueOrThrow({where:{id:ids.milanStop}})).updatedAt.getTime(),original.updatedAt.getTime());
  });
  it("rejects event creation, cost and checklist writes without leaving child records",async()=>{
    const before=await prisma.stoppageEvent.count({where:{stoppageId:ids.milanStop}});
    for(const [suffix,payload] of [["parts-orders",{description:"FORBIDDEN"}],["closure-checklist",{photosUploaded:true,finalCauseSet:true,finalCostSet:true,operatorSigned:true}],["final-cost",{actualTotalCost:1}],["cost-approvals/request",{estimatedTotalCost:1,reason:"FORBIDDEN"}],["cost-approvals/decision",{approved:true}]] as const)assert.equal((await request("rome",`/stoppages/${ids.milanStop}/${suffix}`,{method:"POST",body:payload})).status,404);
    assert.equal(await prisma.stoppageEvent.count({where:{stoppageId:ids.milanStop}}),before);
  });
  it("cannot create outside its site, link an unrelated vehicle, or move a stoppage out of scope",async()=>{
    assert.equal((await request("rome","/stoppages",{method:"POST",body:body(ids.milan,ids.milanVehicle)})).status,404);assert.equal((await request("rome","/stoppages",{method:"POST",body:body(ids.rome,ids.milanVehicle)})).status,404);assert.equal((await request("rome",`/stoppages/${ids.romeStop}`,{method:"PATCH",body:{siteId:ids.milan}})).status,404);
  });
  it("limits eligible assignees and blocks new assignment to an operator of another site",async()=>{
    const suggestions=await json("rome","/stoppages/assignment/suggestions");assert.ok(!JSON.stringify(suggestions).includes(ids.milanUser));assert.ok(!JSON.stringify(suggestions).includes(ids.unassignedUser));
    assert.equal((await request("rome",`/stoppages/${ids.romeStop}`,{method:"PATCH",body:{assignedToUserId:ids.milanUser}})).status,404);
  });
  it("scopes SLA, alerts, costs and stoppage calendars",async()=>{
    const range="?dateFrom=2020-01-01T00%3A00%3A00.000Z&dateTo=2040-01-01T00%3A00%3A00.000Z";
    for(const route of ["/sla/overview","/alerts/list","/sla/escalations","/costs/summary"+range,"/costs/variance"+range,"/calendar"+range])hidden(await json("rome","/stoppages"+route));
    assert.equal((await json("rome","/stoppages/sla/overview")).kpis.totalActive,2);assert.ok((await json("rome","/stoppages/costs/summary"+range)).bySite.every((x:any)=>x.name==="rome"));
  });
  it("filters preventive fleet rows independently from historical stoppage access",async()=>{const result=await json("rome","/stoppages/preventive/due?intervalDays=1");assert.ok(!JSON.stringify(result).includes(ids.milanVehicle));assert.ok(!JSON.stringify(result).includes(ids.naplesVehicle));});
  it("authorizes photo IDs before storage and rejects delete/upload outside the branch",async()=>{
    let touches=0;const read=storageProvider.read,exists=storageProvider.exists;storageProvider.read=async key=>{touches++;return read.call(storageProvider,key);};storageProvider.exists=async key=>{touches++;return exists.call(storageProvider,key);};
    try{assert.equal((await request("rome",`/uploads/stoppage-photos/${ids.milanPhoto}/file`)).status,404);assert.equal(touches,0);assert.equal((await request("rome",`/uploads/stoppage-photos/${ids.milanPhoto}`,{method:"DELETE"})).status,404);assert.equal((await request("rome",`/uploads/stoppages/${ids.milanStop}/photos`,{method:"POST"})).status,404);}finally{storageProvider.read=read;storageProvider.exists=exists;}
  });
  it("denies manual reminder before queueing or invoking even the fake sender",async()=>{const before=sent.length;const queueBefore=await prisma.emailQueue.count({where:{tenantId:ids.a}});assert.equal((await request("rome",`/stoppages/${ids.milanStop}/reminders/email`,{method:"POST"})).status,404);assert.equal(sent.length,before);assert.equal(await prisma.emailQueue.count({where:{tenantId:ids.a}}),queueBefore);});
  it("handles mixed bulk actions per item and preserves outside-site parents",async()=>{const value=await request("rome","/stoppages/bulk",{method:"POST",body:{ids:[ids.romeStop,ids.milanStop],action:"SET_PRIORITY",priority:"LOW"}});assert.equal(value.status,200,await value.clone().text());const result:any=await value.json();assert.equal(result.data[0].ok,true);assert.equal(result.data[1].ok,false);assert.equal((await prisma.stoppage.findUniqueOrThrow({where:{id:ids.milanStop}})).priority,"HIGH");});
  it("preserves historical access after vehicle movement and allows legitimate own-site operations",async()=>{
    await prisma.vehicle.update({where:{id:ids.romeVehicle},data:{siteId:ids.naples}});
    try{assert.equal((await request("rome",`/stoppages/${ids.romeStop}`)).status,200);assert.equal((await request("naples",`/stoppages/${ids.romeStop}`)).status,404);assert.equal((await request("rome",`/stoppages/${ids.romeStop}`,{method:"PATCH",body:{notes:"Synthetic historical edit"}})).status,200);assert.equal((await request("rome",`/stoppages/${ids.romeStop}/parts-orders`,{method:"POST",body:{description:"Synthetic allowed part"}})).status,201);}finally{await prisma.vehicle.update({where:{id:ids.romeVehicle},data:{siteId:ids.rome}});}
  });
  it("records the requester on an authorized simulated manual reminder",async()=>{const response=await request("rome",`/stoppages/${ids.romeStop}/reminders/email`,{method:"POST"});assert.equal(response.status,200,await response.clone().text());const row=await prisma.emailQueue.findFirstOrThrow({where:{tenantId:ids.a,type:"REMINDER_EMAIL"},orderBy:{createdAt:"desc"}});assert.equal((row.meta as any).siteAuthorization.userId,ids.romeUser);});
  it("rechecks the requester's current site before processing a pending manual reminder",async()=>{
    const row=await pending(),before=sent.length;await prisma.user.update({where:{id:ids.romeUser},data:{assignedSiteId:ids.milan}});
    try{await new EmailQueueService().processPending(new Date(),{ids:[row.id],take:1});assert.equal(sent.length,before);const result=await prisma.emailQueue.findUniqueOrThrow({where:{id:row.id}});assert.equal(result.status,"FAILED");assert.match(result.lastError!,/REQUESTER_SITE/);}finally{await prisma.user.update({where:{id:ids.romeUser},data:{assignedSiteId:ids.rome}});}
  });
  it("does not let a worker expand a manager's selected site and rejects malformed scope",async()=>{
    for(const siteAuthorization of [{version:1,userId:ids.managerUser,allSites:false,siteIds:[ids.milan]},{version:1,userId:ids.managerUser,allSites:false,siteIds:"all"}]){const row=await new EmailQueueService().enqueue({tenantId:ids.a,type:"REMINDER_EMAIL",recipient:"synthetic-workshop@example.invalid",subject:"Synthetic",body:"Synthetic",meta:{tenantId:ids.a,stoppageId:ids.romeStop,reminderType:"MANUAL",siteAuthorization}});const before=sent.length;await new EmailQueueService().processPending(new Date(),{ids:[row.id],take:1});assert.equal(sent.length,before);assert.equal((await prisma.emailQueue.findUniqueOrThrow({where:{id:row.id}})).status,"FAILED");}
  });
  it("blocks pending manual reminders after suspension, permission removal or site deactivation",async()=>{
    const permissionKey={roleId_permissionId:{roleId:ids.OPERATOR,permissionId:ids["stoppages:remind"]}};
    for(const change of ["suspension","permission","site","foreign-requester"]){
      const row=await pending(change==="foreign-requester"?ids.foreignUser:ids.romeUser),before=sent.length;
      try{
        if(change==="suspension")await prisma.user.update({where:{id:ids.romeUser},data:{status:"SUSPENDED"}});
        if(change==="permission")await prisma.rolePermission.delete({where:permissionKey});
        if(change==="site")await prisma.site.update({where:{id:ids.rome},data:{isActive:false}});
        await new EmailQueueService().processPending(new Date(),{ids:[row.id],take:1});assert.equal(sent.length,before);assert.equal((await prisma.emailQueue.findUniqueOrThrow({where:{id:row.id}})).status,"FAILED");
      }finally{await prisma.user.update({where:{id:ids.romeUser},data:{status:"ACTIVE"}});await prisma.site.update({where:{id:ids.rome},data:{isActive:true}});await prisma.rolePermission.upsert({where:permissionKey,update:{},create:{roleId:ids.OPERATOR,permissionId:ids["stoppages:remind"]}});}
    }
  });
  it("allows own-site create/assignment and deletion without changing historical ownership",async()=>{
    const response=await request("rome","/stoppages",{method:"POST",body:{...body(),assignedToUserId:ids.romeUser,reason:"Synthetic positive create"}});assert.equal(response.status,201,await response.clone().text());const created:any=await response.json();assert.equal(created.siteId,ids.rome);assert.equal(created.assignedToUserId,ids.romeUser);assert.equal((await request("rome",`/stoppages/${created.id}`,{method:"DELETE"})).status,204);
  });
  it("requires an eligible new assignee when a manager transfers operational responsibility",async()=>{
    try{
      assert.equal((await request("manager",`/stoppages/${ids.milanStop}`,{method:"PATCH",body:{siteId:ids.rome}})).status,404);
      const current=await prisma.stoppage.findUniqueOrThrow({where:{id:ids.milanStop}});assert.equal(current.siteId,ids.milan);assert.equal(current.assignedToUserId,ids.milanUser);
      assert.equal((await request("manager",`/stoppages/${ids.milanStop}`,{method:"PATCH",body:{siteId:ids.rome,assignedToUserId:ids.romeUser}})).status,200);assert.equal((await request("rome",`/stoppages/${ids.milanStop}`)).status,200);assert.equal((await request("milan",`/stoppages/${ids.milanStop}`)).status,404);
    }finally{await prisma.stoppage.update({where:{id:ids.milanStop},data:{siteId:ids.milan,assignedToUserId:ids.milanUser}});}
  });
  it("separates concurrent HTTP scopes for the operational-site calendar and list",async()=>{
    await Promise.all(Array.from({length:24},(_,i)=>json(["rome","milan","naples","unassigned"][i%4],"/stoppages").then(value=>assert.equal(value.total,[2,1,0,0][i%4]))));
  });
  it("takes assignment and active-site changes into account on the next request",async()=>{await prisma.user.update({where:{id:ids.romeUser},data:{assignedSiteId:ids.milan}});assert.equal((await json("rome","/stoppages")).total,1);await prisma.site.update({where:{id:ids.milan},data:{isActive:false}});assert.equal((await json("rome","/stoppages")).total,0);await prisma.site.update({where:{id:ids.milan},data:{isActive:true}});await prisma.user.update({where:{id:ids.romeUser},data:{assignedSiteId:ids.rome}});});
});
