import crypto from "node:crypto";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../../infrastructure/database/prisma/client.js";
import { assertCompanyResourceView } from "../../infrastructure/auth/company-resource-access.js";
import { legacySiteCommandReason, hasAcceptedSiteCommandReceipt } from "../../infrastructure/email/site-access-legacy.js";
import { createAuditLog } from "../../infrastructure/repositories/prisma-audit-log-repository.js";
import { AppError } from "../../shared/errors/app-error.js";
import { parseCompanyReportAuthorization } from "./company-report-authorization.js";

const id = z.string().min(1).max(128);
const ids = z.array(id).max(100).refine(values => new Set(values).size === values.length, "ID duplicati");
export const siteReconciliationSelection = z.object({users:ids.optional(),bookings:ids.optional(),events:ids.optional(),queue:ids.optional()}).strict();
export const siteReconciliationManifest = z.object({
  expectedPlanHash:z.string().regex(/^[a-f0-9]{64}$/),selection:siteReconciliationSelection.optional(),
  users:z.array(z.object({id,siteId:id.nullable()}).strict()).max(100).default([]),
  bookings:z.array(z.object({id,siteId:id,pickupSiteId:id,returnSiteId:id}).strict()).max(100).default([]),
  events:z.array(z.object({id,confirmedPersonal:z.literal(true)}).strict()).max(100).default([]),
  quarantineQueue:ids.default([])
}).strict().superRefine((value,ctx)=>{
  const total=value.users.length+value.bookings.length+value.events.length+value.quarantineQueue.length;
  if(total===0||total>100)ctx.addIssue({code:"custom",message:"Seleziona da 1 a 100 righe esplicite"});
  for(const key of ["users","bookings","events"]as const)if(new Set(value[key].map(row=>row.id)).size!==value[key].length)ctx.addIssue({code:"custom",message:"ID duplicati",path:[key]});
});
type Selection=z.infer<typeof siteReconciliationSelection>;
type Db=Pick<Prisma.TransactionClient,"user"|"site"|"tenant"|"rentalBooking"|"calendarEvent"|"auditLog"|"emailQueue">;
const hash=(value:unknown)=>crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
function denied(code="SITE_RECONCILIATION_FORBIDDEN",status=403):never{throw new AppError("Riconciliazione sedi non consentita: verifica il piano e la vista aziendale",status,code);}
const actor=async(db:Db,tenantId:string,userId:string)=>{
  assertCompanyResourceView(tenantId);
  const user=await db.user.findFirst({where:{id:userId,tenantId,status:"ACTIVE",deletedAt:null,tenant:{is:{isActive:true,deletedAt:null}}},select:{roles:{select:{role:{select:{key:true}}}}}});
  if(!user?.roles.some(row=>row.role.key==="ADMIN"))denied();
};
const inputMeta=(value:Prisma.JsonValue|null)=>value&&typeof value==="object"&&!Array.isArray(value)?value as Prisma.JsonObject:{};
const inventory=async(db:Db,tenantId:string,actorUserId:string,selection?:Selection)=>{
  await actor(db,tenantId,actorUserId);
  const filter=(kind:keyof Selection)=>selection?{id:{in:selection[kind]??[]}}:{};
  const [sites,users,bookings,events,queue,settings]=await Promise.all([
    db.site.findMany({where:{tenantId,isActive:true,deletedAt:null},select:{id:true,updatedAt:true},orderBy:{id:"asc"}}),
    db.user.findMany({where:{tenantId,deletedAt:null,...filter("users"),NOT:{roles:{some:{role:{key:{in:["ADMIN","MANAGER"]}}}}}},select:{id:true,assignedSiteId:true,updatedAt:true},orderBy:{id:"asc"},take:501}),
    db.rentalBooking.findMany({where:{tenantId,deletedAt:null,...filter("bookings"),OR:[{siteId:null},{pickupSiteId:null},{returnSiteId:null}]},select:{id:true,vehicleId:true,siteId:true,pickupSiteId:true,returnSiteId:true,updatedAt:true},orderBy:{id:"asc"},take:501}),
    db.calendarEvent.findMany({where:{tenantId,...filter("events")},select:{id:true,userId:true,updatedAt:true},orderBy:{id:"asc"},take:501}),
    db.emailQueue.findMany({where:{tenantId,status:"PENDING",type:{in:["BOOKING_CONTRACT","REMINDER_EMAIL","RENTAL_EXTRA_CHARGE_NOTICE","SCHEDULED_REPORT"]},...filter("queue")},select:{id:true,type:true,updatedAt:true,meta:true,processingToken:true,leaseExpiresAt:true},orderBy:{id:"asc"},take:501}),
    db.auditLog.findFirst({where:{tenantId,resource:"reports",action:"SETTINGS_REPORTS"},orderBy:[{createdAt:"desc"},{id:"desc"}],select:{id:true,details:true}})
  ]);
  const sources=events.length?await db.auditLog.findMany({where:{tenantId,resource:"CalendarEvent",action:"CALENDAR_SOURCE_V1",resourceId:{in:events.map(row=>row.id)}},orderBy:[{createdAt:"desc"},{id:"desc"}],select:{id:true,resourceId:true,userId:true,details:true,createdAt:true}}):[];
  const latest=new Map<string,typeof sources[number]>();for(const source of sources)if(source.resourceId&&!latest.has(source.resourceId))latest.set(source.resourceId,source);
  const data={version:1 as const,tenantId,actorUserId,selection:selection??null,complete:[users,bookings,events,queue].every(rows=>rows.length<=500),sites,
    users:users.slice(0,500).filter(row=>!row.assignedSiteId||!sites.some(site=>site.id===row.assignedSiteId)),bookings:bookings.slice(0,500),
    events:events.slice(0,500).filter(row=>!latest.has(row.id)).map(row=>({...row,sourceState:"unclassified"as const})),
    // The report never includes names, addresses, subjects, bodies or attachments.
    queue:queue.slice(0,500).map(row=>({id:row.id,type:row.type,updatedAt:row.updatedAt,metadataHash:hash(row.meta),processingTokenHash:row.processingToken?hash(row.processingToken):null,leaseExpiresAt:row.leaseExpiresAt,acceptedReceipt:hasAcceptedSiteCommandReceipt(row.meta),requiresReview:Boolean(legacySiteCommandReason(row.type,row.meta))})),
    reports:settings?{auditId:settings.id,requiresConfirmation:inputMeta(settings.details).enabled===true&&!parseCompanyReportAuthorization(inputMeta(settings.details).__siteAuthorization)}:null};
  return{...data,planHash:hash(data)};
};
export class SiteAccessReconciliationService {
  plan(tenantId:string,actorUserId:string,selection?:unknown){return inventory(prisma,tenantId,actorUserId,selection===undefined?undefined:siteReconciliationSelection.parse(selection));}
  async apply(tenantId:string,actorUserId:string,input:unknown){
    const manifest=siteReconciliationManifest.parse(input);
    const before=await this.plan(tenantId,actorUserId,manifest.selection);
    if(!before.complete)denied("SITE_RECONCILIATION_PLAN_INCOMPLETE",409);
    if(before.planHash!==manifest.expectedPlanHash)denied("SITE_RECONCILIATION_PLAN_CHANGED",409);
    const eventIds=new Set(manifest.events.map(row=>row.id));
    const userIds=[...new Set([actorUserId,...manifest.users.map(row=>row.id),...before.events.filter(row=>eventIds.has(row.id)).flatMap(row=>row.userId?[row.userId]:[])])].sort();
    return prisma.$transaction(async tx=>{
      // User -> Tenant -> Vehicle -> Booking -> Site mirrors the existing writers.
      await tx.$queryRaw`SELECT "id" FROM "User" WHERE "tenantId"=${tenantId} AND "id" IN (${Prisma.join(userIds)}) ORDER BY "id" FOR UPDATE`;
      await tx.$queryRaw`SELECT "id" FROM "Tenant" WHERE "id"=${tenantId} FOR SHARE`;
      const current=await inventory(tx,tenantId,actorUserId,manifest.selection);
      if(current.planHash!==manifest.expectedPlanHash)denied("SITE_RECONCILIATION_PLAN_CHANGED",409);
      const sites=new Set(current.sites.map(row=>row.id));
      const allSites=[...manifest.users.flatMap(row=>row.siteId?[row.siteId]:[]),...manifest.bookings.flatMap(row=>[row.siteId,row.pickupSiteId,row.returnSiteId])];
      if(allSites.some(siteId=>!sites.has(siteId)))denied("SITE_RECONCILIATION_SITE_UNAVAILABLE",404);
      const bookingIds=manifest.bookings.map(row=>row.id),bookingMap=new Map(current.bookings.map(row=>[row.id,row]));
      if(bookingIds.some(id=>!bookingMap.has(id)))denied("SITE_RECONCILIATION_BOOKING_UNAVAILABLE",404);
      const vehicles=[...new Set(bookingIds.map(id=>bookingMap.get(id)!.vehicleId).filter((id):id is string=>Boolean(id)))].sort();
      if(vehicles.length)await tx.$queryRaw`SELECT "id" FROM "Vehicle" WHERE "tenantId"=${tenantId} AND "id" IN (${Prisma.join(vehicles)}) ORDER BY "id" FOR SHARE`;
      if(bookingIds.length)await tx.$queryRaw`SELECT "id" FROM "RentalBooking" WHERE "tenantId"=${tenantId} AND "id" IN (${Prisma.join(bookingIds)}) ORDER BY "id" FOR UPDATE`;
      if(allSites.length)await tx.$queryRaw`SELECT "id" FROM "Site" WHERE "tenantId"=${tenantId} AND "id" IN (${Prisma.join([...new Set(allSites)].sort())}) ORDER BY "id" FOR SHARE`;
      for(const mapping of manifest.users){
        const row=current.users.find(row=>row.id===mapping.id);if(!row)denied("SITE_RECONCILIATION_USER_UNAVAILABLE",404);
        await tx.user.update({where:{id:row.id},data:{assignedSiteId:mapping.siteId}});
        await createAuditLog(tx,{tenantId,userId:actorUserId,resource:"user",resourceId:row.id,action:"USER_SITE_ASSIGNED",details:{previousSiteId:row.assignedSiteId,siteId:mapping.siteId,reconciliationPlan:current.planHash}},new Date());
      }
      for(const mapping of manifest.bookings){
        const row=bookingMap.get(mapping.id)!;
        if((["siteId","pickupSiteId","returnSiteId"]as const).some(key=>row[key]!==null&&row[key]!==mapping[key]))denied("SITE_RECONCILIATION_EXISTING_ATTRIBUTION",409);
        await tx.rentalBooking.update({where:{id:row.id},data:{siteId:mapping.siteId,pickupSiteId:mapping.pickupSiteId,returnSiteId:mapping.returnSiteId}});
        await createAuditLog(tx,{tenantId,userId:actorUserId,resource:"RentalBooking",resourceId:row.id,action:"BOOKING_SITES_RECONCILED",details:{planHash:current.planHash,before:{siteId:row.siteId,pickupSiteId:row.pickupSiteId,returnSiteId:row.returnSiteId},after:mapping}},new Date());
      }
      for(const mapping of manifest.events){
        const row=current.events.find(row=>row.id===mapping.id);if(!row?.userId)denied("SITE_RECONCILIATION_EVENT_UNAVAILABLE",404);
        await tx.$queryRaw`SELECT "id" FROM "CalendarEvent" WHERE "id"=${row.id} AND "tenantId"=${tenantId} FOR UPDATE`;
        const owner=await tx.user.findFirst({where:{id:row.userId,tenantId,deletedAt:null},select:{id:true}});if(!owner)denied("SITE_RECONCILIATION_EVENT_OWNER",404);
        await createAuditLog(tx,{tenantId,userId:row.userId,resource:"CalendarEvent",resourceId:row.id,action:"CALENDAR_SOURCE_V1",details:{version:1,kind:"personal",source:"manual",confirmedBy:actorUserId,reconciliationPlan:current.planHash}},new Date());
        await tx.calendarEvent.update({where:{id:row.id},data:{updatedAt:new Date()}});
      }
      for(const queueId of manifest.quarantineQueue){
        const row=current.queue.find(row=>row.id===queueId);if(!row||!row.requiresReview||row.acceptedReceipt)denied("SITE_RECONCILIATION_QUEUE_UNAVAILABLE",409);
        // An expired claim can still have a provider request in flight. Never
        // replace it with a failure or destroy the durable receipt recovery.
        if(row.processingTokenHash||(row.leaseExpiresAt&&row.leaseExpiresAt>new Date()))denied("SITE_RECONCILIATION_QUEUE_BUSY",409);
        await tx.$queryRaw`SELECT "id" FROM "EmailQueue" WHERE "id"=${queueId} AND "tenantId"=${tenantId} FOR UPDATE`;
        const queued=await tx.emailQueue.findUniqueOrThrow({where:{id:queueId}});
        if(queued.status!=="PENDING"||hash(queued.meta)!==row.metadataHash||hasAcceptedSiteCommandReceipt(queued.meta)||queued.processingToken||(queued.leaseExpiresAt&&queued.leaseExpiresAt>new Date()))denied("SITE_RECONCILIATION_PLAN_CHANGED",409);
        await tx.emailQueue.update({where:{id:queueId},data:{status:"FAILED",lastError:"SITE_LEGACY_REVIEW_REQUIRED",processingToken:null,processingStartedAt:null,leaseExpiresAt:null,meta:{...inputMeta(queued.meta),siteAccessReview:{reason:"SITE_LEGACY_REVIEW_REQUIRED",planHash:current.planHash,reviewedBy:actorUserId}}}});
      }
      const counts={users:manifest.users.length,bookings:manifest.bookings.length,events:manifest.events.length,quarantined:manifest.quarantineQueue.length};
      await createAuditLog(tx,{tenantId,userId:actorUserId,resource:"SiteReconciliation",resourceId:current.planHash,action:"SITE_ACCESS_RECONCILIATION_APPLIED",details:{version:1,counts}},new Date());
      return{planHash:current.planHash,counts};
    },{isolationLevel:Prisma.TransactionIsolationLevel.Serializable,maxWait:5000,timeout:15000});
  }
}
