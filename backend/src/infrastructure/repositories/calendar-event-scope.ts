import type {CalendarEvent,Prisma} from "@prisma/client";
import {prisma} from "../database/prisma/client.js";
import {createAuditLog} from "./prisma-audit-log-repository.js";
import {visibleVehicleWhere} from "./resource-site-scope.js";
import {siteAccessForTenant} from "../auth/site-access-context.js";
import {AppError} from "../../shared/errors/app-error.js";

const action="CALENDAR_SOURCE_V1",resource="CalendarEvent";
export type CalendarSource={version:1;kind:"personal";source:"manual"|"apple"|"google"}|{version:1;kind:"vehicle_deadline";source:"deadline";vehicleId:string;siteId:string};
export const bindCalendarSource=async(tx:Prisma.TransactionClient,row:{id:string;tenantId:string;userId:string|null},source:CalendarSource)=>{
  if(!row.userId)throw new AppError("Autore calendario non valido",403,"FORBIDDEN");
  await createAuditLog(tx,{tenantId:row.tenantId,userId:row.userId,action,resource,resourceId:row.id,details:source},new Date());
};
export const assertCalendarUserText=(...values:unknown[])=>{
  if(values.some(v=>typeof v==="string"&&/(?:\[\[AUTO_|\[GF_(?:GCAL_ID|ACAL_UID):)/.test(v)))throw new AppError("Riferimenti calendario riservati al sistema",400,"CALENDAR_RESERVED_MARKER");
};
export const cleanImportedCalendarText=(text:string)=>text.replace(/\[\[AUTO_[^\]\r\n]*\]\]/g,"").replace(/\[GF_(?:GCAL_ID|ACAL_UID):[^\]\r\n]*\]/g,"").trim();
export const filterCalendarEvents=async<T extends Pick<CalendarEvent,"id"|"tenantId"|"userId">>(tenantId:string,userId:string,rows:T[])=>{
  const scope=siteAccessForTenant(tenantId);if(!scope)return rows.filter(row=>row.tenantId===tenantId&&row.userId===userId);
  if(!rows.length)return rows;
  const audits=await prisma.auditLog.findMany({where:{tenantId,userId,resource,action,resourceId:{in:rows.map(row=>row.id)}},orderBy:[{createdAt:"desc"},{id:"desc"}],select:{resourceId:true,details:true}});
  const sources=new Map<string,CalendarSource|null>();
  for(const audit of audits)if(audit.resourceId&&!sources.has(audit.resourceId)){
    const value=audit.details as any;
    const valid=value?.version===1&&((value.kind==="personal"&&["manual","apple","google"].includes(value.source))||
      (value.kind==="vehicle_deadline"&&value.source==="deadline"&&typeof value.vehicleId==="string"&&value.vehicleId.length>0&&typeof value.siteId==="string"&&value.siteId.length>0));
    sources.set(audit.resourceId,valid?value:null);
  }
  const vehicleIds=[...sources.values()].filter((s):s is Extract<CalendarSource,{kind:"vehicle_deadline"}>=>s?.kind==="vehicle_deadline").map(s=>s.vehicleId);
  const vehicles=vehicleIds.length?await prisma.vehicle.findMany({where:{...visibleVehicleWhere(tenantId),id:{in:vehicleIds}},select:{id:true,siteId:true}}):[];
  const currentSites=new Map(vehicles.map(v=>[v.id,v.siteId]));
  return rows.filter(row=>{
    if(row.tenantId!==tenantId||row.userId!==userId)return false;
    if(!sources.has(row.id))return scope.allSites&&scope.canViewAllSites;
    const source=sources.get(row.id);if(!source)return false;
    if(source.kind==="personal")return true;
    return currentSites.get(source.vehicleId)===source.siteId;
  });
};
export const calendarSource=async(tenantId:string,userId:string,eventId:string)=>{
  const row=await prisma.auditLog.findFirst({where:{tenantId,userId,resource,action,resourceId:eventId},orderBy:[{createdAt:"desc"},{id:"desc"}],select:{details:true}});
  return row?.details as CalendarSource|undefined;
};
