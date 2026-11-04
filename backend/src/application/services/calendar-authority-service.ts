import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import type { Request, Response } from "express";
import { prisma } from "../../infrastructure/database/prisma/client.js";
import { siteAccessForTenant, runWithSiteAccess } from "../../infrastructure/auth/site-access-context.js";
import { resolveSiteAccess, narrowSiteAccess, type SiteAccessScope } from "../../domain/policies/site-access.js";
import { AuthorizationPolicyService } from "./authorization-policy-service.js";
import { LicensePolicyService } from "./license-policy-service.js";
import { createAuditLog, PrismaAuditLogRepository } from "../../infrastructure/repositories/prisma-audit-log-repository.js";
import { AppError } from "../../shared/errors/app-error.js";
import { env } from "../../shared/config/env.js";
import { getCookieValue } from "../../interfaces/http/utils/auth-cookies.js";

const hash=(value:string)=>crypto.createHash("sha256").update(value).digest("hex");
const denied=()=>new AppError("Accesso al calendario non disponibile",403,"CALENDAR_ACCESS_DENIED");
const license=new LicensePolicyService(new PrismaAuditLogRepository());
const VERSION=2;
export type CalendarAuthority={tenantId:string;userId:string;sessionId:string;scope:SiteAccessScope;fingerprint:string};
type Grant={version:2;authority:CalendarAuthority;dateFrom:string;dateTo:string;privacy:"masked"|"full"};
export const calendarOwnerKey=(tenantId:string,userId:string)=>hash(`calendar-owner:${tenantId}:${userId}`);

// Follow only committed normal rotations. Terminal logout/reset revocation has
// no live descendant. UNION terminates corrupt cycles; ownership is checked at
// every edge. Capability reads advance their cursor so old history is not
// walked on every calendar-client poll.
const liveSession=async(tenantId:string,userId:string,sessionId:string)=>{
  const rows=await prisma.$queryRaw<Array<{id:string}>>`
    WITH RECURSIVE chain AS (
      SELECT "id","replacedById","revokedAt","expiresAt" FROM "RefreshSession"
      WHERE "id"=${sessionId} AND "tenantId"=${tenantId} AND "userId"=${userId}
      UNION
      SELECT s."id",s."replacedById",s."revokedAt",s."expiresAt" FROM "RefreshSession" s
      JOIN chain p ON p."replacedById"=s."id" AND p."revokedAt" IS NOT NULL
      WHERE s."tenantId"=${tenantId} AND s."userId"=${userId}
    ) SELECT "id" FROM chain WHERE "revokedAt" IS NULL AND "replacedById" IS NULL AND "expiresAt">${new Date()}
  `;
  if(rows.length!==1)throw denied();return rows[0].id;
};
export const loadCalendarAuthority=async(tenantId:string,userId:string,sessionId:string,selected?:SiteAccessScope,required=["stoppages:read"]):Promise<CalendarAuthority>=>{
  if(!sessionId)throw denied();
  const user=await prisma.user.findFirst({where:{id:userId,tenantId,status:"ACTIVE",deletedAt:null,tenant:{is:{isActive:true,deletedAt:null}}},select:{
    tenantId:true,updatedAt:true,assignedSite:{select:{id:true,tenantId:true,isActive:true,deletedAt:true,updatedAt:true}},
    roles:{select:{role:{select:{key:true,permissions:{select:{permission:{select:{key:true}}}}}}}}
  }});
  if(!user)throw denied();
  const roles=user.roles.map(({role})=>role.key).sort(),permissions=[...new Set(user.roles.flatMap(({role})=>role.permissions.map(({permission})=>permission.key)))].sort();
  try{new AuthorizationPolicyService().assertPermissions({roles,permissions},required);}catch{throw denied();}
  let scope=resolveSiteAccess({...user,roles});let selectedSiteRevision:string|null=null;
  if(selected){
    if(selected.tenantId!==tenantId)throw denied();
    if(!selected.allSites){
      if(scope.canViewAllSites){
        if(selected.siteIds.length!==1)throw denied();
        const site=await prisma.site.findFirst({where:{id:selected.siteIds[0],tenantId,isActive:true,deletedAt:null},select:{id:true,updatedAt:true}});
        if(!site)throw denied();scope=narrowSiteAccess(scope,site.id);selectedSiteRevision=site.updatedAt.toISOString();
      }else if(JSON.stringify([...scope.siteIds].sort())!==JSON.stringify([...selected.siteIds].sort()))throw denied();
    }else if(!scope.allSites)throw denied();
  }
  if((await license.evaluateAccess(tenantId)).blocked)throw denied();
  const activeSessionId=await liveSession(tenantId,userId,sessionId);
  const fingerprint=hash(JSON.stringify({updatedAt:user.updatedAt.toISOString(),assignedSiteRevision:user.assignedSite?.updatedAt.toISOString()??null,selectedSiteRevision,roles,permissions,scope:{...scope,siteIds:[...scope.siteIds].sort()}}));
  return{tenantId,userId,sessionId:activeSessionId,scope,fingerprint};
};
export const requestCalendarAuthority=(req:Request,required=["stoppages:read"])=>loadCalendarAuthority(req.auth!.tenantId,req.auth!.userId,req.auth!.sessionId!,siteAccessForTenant(req.auth!.tenantId),required);
export const refreshCalendarAuthority=async(authority:CalendarAuthority,required=["stoppages:read"])=>{
  const current=await loadCalendarAuthority(authority.tenantId,authority.userId,authority.sessionId,authority.scope,required);
  if(current.fingerprint!==authority.fingerprint)throw denied();return current;
};
export const inCalendarScope=<T>(authority:CalendarAuthority,action:()=>T):T=>runWithSiteAccess(authority.scope,action);
export const assertCalendarRange=(from:Date,to:Date)=>{
  if(!Number.isFinite(from.getTime())||!Number.isFinite(to.getTime())||to<=from||to.getTime()-from.getTime()>366*86400000)throw new AppError("Intervallo calendario non valido (massimo 366 giorni)",400,"CALENDAR_RANGE_INVALID");
};
const parseGrant=(raw:string|null):Grant=>{
  try{const grant=JSON.parse(raw??"") as Grant;
    if(grant.version!==VERSION||!grant.authority?.tenantId||!grant.authority?.userId||!grant.authority?.sessionId||!grant.authority?.fingerprint||!["masked","full"].includes(grant.privacy))throw denied();
    assertCalendarRange(new Date(grant.dateFrom),new Date(grant.dateTo));return grant;
  }catch{throw denied();}
};
const makeGrant=(authority:CalendarAuthority,from:Date,to:Date,privacy:Grant["privacy"]):Grant=>{
  assertCalendarRange(from,to);return{version:2,authority,dateFrom:from.toISOString(),dateTo:to.toISOString(),privacy};
};
const cookieName=(state:string)=>`fermi_calendar_oauth_${hash(state).slice(0,20)}`;
const cookieOptions=(expires?:Date)=>({httpOnly:true,secure:env.NODE_ENV==="production",sameSite:"lax"as const,path:"/api/calendar/google/callback",...(expires?{expires}:{})});

const grantResource="CalendarGrant",createdAction="CALENDAR_GRANT_CREATED";
const encryptionKey=crypto.createHash("sha256").update(`fleetum:calendar-pkce:v2:${env.JWT_SECRET}`).digest();
const seal=(value:string)=>{
  const iv=crypto.randomBytes(12),cipher=crypto.createCipheriv("aes-256-gcm",encryptionKey,iv);
  const encrypted=Buffer.concat([cipher.update(value,"utf8"),cipher.final()]);
  return[iv.toString("base64url"),cipher.getAuthTag().toString("base64url"),encrypted.toString("base64url")].join(".");
};
const unseal=(value:string)=>{
  const[iv,tag,data]=value.split(".");const decipher=crypto.createDecipheriv("aes-256-gcm",encryptionKey,Buffer.from(iv,"base64url"));
  decipher.setAuthTag(Buffer.from(tag,"base64url"));return Buffer.concat([decipher.update(Buffer.from(data,"base64url")),decipher.final()]).toString("utf8");
};
const latestOwnerEpoch=async(db:Pick<typeof prisma,"auditLog">,tenantId:string,userId:string)=>
  (await db.auditLog.findFirst({where:{tenantId,userId,resource:"CalendarFeedOwner",resourceId:calendarOwnerKey(tenantId,userId),action:"CALENDAR_FEEDS_REVOKED"},orderBy:[{createdAt:"desc"},{id:"desc"}],select:{id:true}}))?.id??null;
const readRecord=async(key:string,purpose:"feed"|"google")=>{
  const row=await prisma.auditLog.findFirst({where:{resource:grantResource,resourceId:key,action:createdAction},orderBy:[{createdAt:"desc"},{id:"desc"}]});
  const details=row?.details as any;
  if(!row||details?.version!==2||details.purpose!==purpose||!Number.isFinite(Date.parse(details.expiresAt))||Date.parse(details.expiresAt)<=Date.now())throw denied();
  const grant=parseGrant(JSON.stringify(details.grant));if(row.tenantId!==grant.authority.tenantId||row.userId!==grant.authority.userId)throw denied();
  return{row,details,grant};
};
const stateWhere=(tenantId:string,key:string)=>({tenantId,resource:grantResource,resourceId:key});
const markState=async(row:{id:string;tenantId:string;userId:string|null;resourceId:string|null},action:string,details:object={})=>prisma.$transaction(async tx=>{
  await tx.$queryRaw`SELECT "id" FROM "AuditLog" WHERE "id"=${row.id} FOR UPDATE`;
  if(await tx.auditLog.findFirst({where:{...stateWhere(row.tenantId,row.resourceId!),action:{in:["CALENDAR_GRANT_REVOKED","CALENDAR_GRANT_CONSUMED"]}},select:{id:true}}))throw denied();
  await createAuditLog(tx,{tenantId:row.tenantId,userId:row.userId,resource:grantResource,resourceId:row.resourceId,action,details},new Date());
});

export class CalendarCapabilityService {
  async issueFeed(authority:CalendarAuthority,from:Date,to:Date,privacy:Grant["privacy"]){
    const current=await refreshCalendarAuthority(authority),grant=makeGrant(current,from,to,privacy),id=crypto.randomUUID(),createdAt=new Date(),expiresAt=new Date(Date.now()+180*86400000);
    const token=jwt.sign({tokenType:"calendar_feed_v2",tenantId:current.tenantId,userId:current.userId,flowId:id,iat:Math.floor(createdAt.getTime()/1000),exp:Math.floor(expiresAt.getTime()/1000)},env.JWT_SECRET);
    await prisma.$transaction(async tx=>{
      const lock=`calendar-owner:${current.tenantId}:${current.userId}`;
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lock},0))::text`;
      const ownerEpoch=await latestOwnerEpoch(tx,current.tenantId,current.userId);
      await createAuditLog(tx,{tenantId:current.tenantId,userId:current.userId,resource:grantResource,resourceId:id,action:createdAction,details:{version:2,purpose:"feed",grant,ownerEpoch,tokenHash:hash(token),expiresAt:expiresAt.toISOString()}},createdAt);
    });
    return{token,expiresAt:expiresAt.toISOString()};
  }
  async readFeed(token:string,query:{dateFrom?:string;dateTo?:string;privacy?:string}){
    let payload:any;try{payload=jwt.verify(token,env.JWT_SECRET);}catch{throw denied();}
    if(payload.tokenType!=="calendar_feed_v2"||typeof payload.flowId!=="string")throw denied();
    const{row,details,grant}=await readRecord(payload.flowId,"feed");
    if(details.tokenHash!==hash(token)||payload.tenantId!==grant.authority.tenantId||payload.userId!==grant.authority.userId)throw denied();
    if((query.privacy&&query.privacy!==grant.privacy)||(query.dateFrom&&new Date(query.dateFrom).toISOString()!==grant.dateFrom)||(query.dateTo&&new Date(query.dateTo).toISOString()!==grant.dateTo))throw denied();
    if(details.ownerEpoch!==await latestOwnerEpoch(prisma,row.tenantId,row.userId!))throw denied();
    const states=await prisma.auditLog.findMany({where:{...stateWhere(row.tenantId,payload.flowId),action:{in:["CALENDAR_GRANT_REVOKED","CALENDAR_GRANT_CURSOR"]}},orderBy:[{createdAt:"desc"},{id:"desc"}]});
    if(states.some(state=>state.action==="CALENDAR_GRANT_REVOKED"))throw denied();
    const cursor=states.find(state=>state.action==="CALENDAR_GRANT_CURSOR");
    const authorityBefore={...grant.authority,...(cursor?{sessionId:(cursor.details as any).sessionId}:{})};
    try{
      const authority=await refreshCalendarAuthority(authorityBefore);
      if(authority.sessionId!==authorityBefore.sessionId)await markState(row,"CALENDAR_GRANT_CURSOR",{sessionId:authority.sessionId});
      return{...grant,authority};
    }catch(error){await markState(row,"CALENDAR_GRANT_REVOKED").catch(()=>{});throw error;}
  }
  async revokeFeeds(tenantId:string,userId:string){await prisma.$transaction(async tx=>{
    const lock=`calendar-owner:${tenantId}:${userId}`;await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lock},0))::text`;
    await createAuditLog(tx,{tenantId,userId,resource:"CalendarFeedOwner",resourceId:calendarOwnerKey(tenantId,userId),action:"CALENDAR_FEEDS_REVOKED",details:{version:2}},new Date());
  });}
  async issueGoogle(authority:CalendarAuthority,from:Date,to:Date,privacy:Grant["privacy"],res:Response){
    const current=await refreshCalendarAuthority(authority,["stoppages:read","stoppages:write"]),state=crypto.randomBytes(32).toString("base64url"),binding=crypto.randomBytes(32).toString("base64url"),verifier=crypto.randomBytes(32).toString("base64url"),expiresAt=new Date(Date.now()+15*60000);
    await createAuditLog(prisma,{tenantId:current.tenantId,userId:current.userId,resource:grantResource,resourceId:hash(state),action:createdAction,details:{version:2,purpose:"google",grant:makeGrant(current,from,to,privacy),bindingHash:hash(binding),codeVerifierSealed:seal(verifier),expiresAt:expiresAt.toISOString()}},new Date());
    res.cookie(cookieName(state),binding,cookieOptions(expiresAt));return{state,challenge:crypto.createHash("sha256").update(verifier).digest("base64url")};
  }
  async consumeGoogle(state:string,req:Request,res:Response){
    const binding=getCookieValue(req,cookieName(state));if(!binding)throw denied();
    const{row,details,grant}=await readRecord(hash(state),"google");if(details.bindingHash!==hash(binding))throw denied();
    await markState(row,"CALENDAR_GRANT_CONSUMED");res.clearCookie(cookieName(state),cookieOptions());
    const authority=await refreshCalendarAuthority(grant.authority,["stoppages:read","stoppages:write"]);
    if(typeof details.codeVerifierSealed!=="string")throw denied();return{...grant,authority,codeVerifier:unseal(details.codeVerifierSealed)};
  }
}
