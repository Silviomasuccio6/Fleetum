import {resolveContractDrivers} from "./contract-rental-drivers.js";
import crypto from "node:crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "../../infrastructure/database/prisma/client.js";
import { env } from "../../shared/config/env.js";
import { AppError } from "../../shared/errors/app-error.js";
import { visibleBookingWhere } from "../../infrastructure/repositories/resource-site-scope.js";
import { captureContractSiteAuthorization, contractSiteAuthorizationReason } from "../../infrastructure/email/contract-site-authorization.js";
import { siteAccessForTenant } from "../../infrastructure/auth/site-access-context.js";
import { CARGOS_FIELDS, cargosRecordIssues, serializeCargosRecord } from "./cargos-protocol.js";
import { CargosClient, type CargosCredentials, type CargosOutcome, type CargosSendGuard, type CargosCheckOutcome } from "../../infrastructure/cargos/cargos-client.js";

const hash=(value:string)=>crypto.createHash("sha256").update(value).digest("hex");
export const cargosStorageReady=()=>/^[a-f0-9]{64}$/i.test(env.CARGOS_DATA_ENCRYPTION_KEY);
const key=(purpose="credentials")=>{
 if(!cargosStorageReady())throw new AppError("Collegamento CARGOS da predisporre in sicurezza",503,"CARGOS_STORAGE_UNAVAILABLE");
 return Buffer.from(crypto.hkdfSync("sha256",Buffer.from(env.CARGOS_DATA_ENCRYPTION_KEY,"hex"),"fleetum:cargos:v1",purpose,32));
};
const sealRecord=(tenantId:string,record:string)=>{
 const iv=crypto.randomBytes(12),cipher=crypto.createCipheriv("aes-256-gcm",key("record"),iv);cipher.setAAD(Buffer.from(tenantId));
 const data=Buffer.concat([cipher.update(record,"utf8"),cipher.final()]);return[iv.toString("base64url"),cipher.getAuthTag().toString("base64url"),data.toString("base64url")].join(".");
};
export const sealCargosCredentials=(tenantId:string,value:CargosCredentials)=>{
 const iv=crypto.randomBytes(12),cipher=crypto.createCipheriv("aes-256-gcm",key(),iv);cipher.setAAD(Buffer.from(tenantId));
 const data=Buffer.concat([cipher.update(JSON.stringify(value),"utf8"),cipher.final()]);return[iv.toString("base64url"),cipher.getAuthTag().toString("base64url"),data.toString("base64url")].join(".");
};
const unseal=(tenantId:string,value:string):CargosCredentials=>{
 const[iv,tag,data]=value.split(".");const cipher=crypto.createDecipheriv("aes-256-gcm",key(),Buffer.from(iv,"base64url"));cipher.setAAD(Buffer.from(tenantId));cipher.setAuthTag(Buffer.from(tag,"base64url"));return JSON.parse(Buffer.concat([cipher.update(Buffer.from(data,"base64url")),cipher.final()]).toString("utf8"));
};
const date=(value:Date|null|undefined,time=true)=>{
 if(!value)return"";const formatter=new Intl.DateTimeFormat("en-GB",{timeZone:"Europe/Rome",day:"2-digit",month:"2-digit",year:"numeric",...(time?{hour:"2-digit",minute:"2-digit",hourCycle:"h23" as const}:{})});return formatter.format(value).replace(",","");
};
type Agency={id?:string;name?:string;placeCode?:string;address?:string;phone?:string};
const editable=(key:string)=>key.startsWith("CONDUCENTE2_")||key.endsWith("_COD")||["CONTRATTO_TIPOP","VEICOLO_TIPO","VEICOLO_GPS","VEICOLO_BLOCCOM"].includes(key);
const recordObject=(value:unknown):Record<string,string>=>value&&typeof value==="object"&&!Array.isArray(value)?Object.fromEntries(Object.entries(value).filter(([,v])=>typeof v==="string")) as Record<string,string>:{};
export class ContractCargosService {
 constructor(private readonly client:(credentials:CargosCredentials)=>{send(record:string,guard?:CargosSendGuard):Promise<CargosOutcome>;check(record:string,guard?:CargosSendGuard):Promise<CargosCheckOutcome>}=credentials=>new CargosClient(credentials)){}
 async context(tenantId:string,bookingId:string,userId:string,db:Prisma.TransactionClient=prisma){
  const booking=await db.rentalBooking.findFirst({where:{...visibleBookingWhere(tenantId),id:bookingId,deletedAt:null},include:{vehicle:true,customer:true,contract:true}});
  if(!booking||!booking.contract||booking.contract.deletedAt)throw new AppError("Contratto non trovato",404,"NOT_FOUND");
  const[connection,transmission]=await Promise.all([db.tenantCargosConnection.findUnique({where:{tenantId}}),db.contractCargosTransmission.findFirst({where:{tenantId,contractId:booking.contract.id}})]);
  const agency=((connection?.agencies??{}) as Record<string,Agency>)[booking.pickupSiteId??booking.siteId??""]??{};
  const structured=booking.contract.rentalTerms!==null,drivers=structured?await resolveContractDrivers(tenantId,booking.contract.rentalTerms,db,false):[];
  const customer=structured?drivers[0]:booking.customer;const base:Record<string,string>={...recordObject(transmission?.recordDraft),
   CONTRATTO_ID:booking.contract.id,CONTRATTO_DATA:date(booking.contract.signedAt),CONTRATTO_CHECKOUT_DATA:date(booking.pickupAt),CONTRATTO_CHECKIN_DATA:date(booking.returnAt),
   CONTRATTO_CHECKOUT_INDIRIZZO:booking.pickupLocation??"",CONTRATTO_CHECKIN_INDIRIZZO:booking.returnLocation??"",OPERATORE_ID:userId,
   AGENZIA_ID:agency.id??"",AGENZIA_NOME:agency.name??"",AGENZIA_LUOGO_COD:agency.placeCode??"",AGENZIA_INDIRIZZO:agency.address??"",AGENZIA_RECAPITO_TEL:agency.phone??"",
   VEICOLO_MARCA:booking.vehicle.brand??"",VEICOLO_MODELLO:booking.vehicle.model??"",VEICOLO_TARGA:booking.vehicle.plate,
   CONDUCENTE_CONTRAENTE_COGNOME:customer?.lastName??"",CONDUCENTE_CONTRAENTE_NOME:customer?.firstName??"",CONDUCENTE_CONTRAENTE_NASCITA_DATA:date(customer?.dateOfBirth,false),
   CONDUCENTE_CONTRAENTE_DOCIDE_NUMERO:customer?.documentNumber??"",CONDUCENTE_CONTRAENTE_PATENTE_NUMERO:customer?.drivingLicenseNumber??"",
   CONDUCENTE_CONTRAENTE_RECAPITO:(customer?.phone??"").replace(/[ +()-]/g,""),CONDUCENTE_CONTRAENTE_RESIDENZA_INDIRIZZO:customer?.residenceAddress??""
  };
  if(structured){
   // Names and document numbers come from the exact drivers designated in the contract.
   // Coded places/citizenship/document types still require official code-list validation.
   const second=drivers[1];
   for(const field of CARGOS_FIELDS.filter(field=>field.key.startsWith("CONDUCENTE2_")))if(!second)base[field.key]="";
   Object.assign(base,{CONDUCENTE2_COGNOME:second?.lastName??"",CONDUCENTE2_NOME:second?.firstName??"",CONDUCENTE2_NASCITA_DATA:date(second?.dateOfBirth,false),CONDUCENTE2_DOCIDE_NUMERO:second?.documentNumber??"",CONDUCENTE2_PATENTE_NUMERO:second?.drivingLicenseNumber??"",CONDUCENTE2_RECAPITO:(second?.phone??"").replace(/[ +()-]/g,"")});
  }
  const{OPERATORE_ID:operator,...businessRecord}=base;
  const sourceHash=hash(JSON.stringify([booking.contract.id,booking.contract.content,booking.contract.title,booking.contract.signedAt,booking.contract.rentalTerms,businessRecord]));
  return{booking,connection,transmission,record:base,sourceHash};
 }
 private guard(tenantId:string,bookingId:string,userId:string,scope:unknown,expectedHash:string,credentialsEncrypted:string,claim?:{id:string;token:string}):CargosSendGuard{
  return async start=>{
   // Token acquisition can take seconds. Recheck authority and the exact source
   // at the actual Send boundary; do not await the network while holding locks.
   const delivery:{outcome?:Promise<{value:unknown}|{error:unknown}>}={};
   await prisma.$transaction(async tx=>{
    await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id"=${userId} AND "tenantId"=${tenantId} FOR SHARE`;
    const tenants=await tx.$queryRaw<Array<{isActive:boolean;deletedAt:Date|null}>>`SELECT "isActive","deletedAt" FROM "Tenant" WHERE "id"=${tenantId} FOR SHARE`;
    if(!tenants[0]?.isActive||tenants[0].deletedAt)throw new Error("CARGOS_DISPATCH_TENANT_UNAVAILABLE");
    await tx.$queryRaw`SELECT "tenantId" FROM "TenantSubscription" WHERE "tenantId"=${tenantId} FOR SHARE`;
    const {LicensePolicyService}=await import("./license-policy-service.js");
    const {snapshotFromRow}=await import("./tenant-subscription-service.js");
    const license=await new LicensePolicyService({getLatestByAction:(owner,resource,action)=>tx.auditLog.findFirst({where:{tenantId:owner,resource,action},orderBy:{createdAt:"desc"}})},async owner=>{const row=await tx.tenantSubscription.findUnique({where:{tenantId:owner}});return row?snapshotFromRow(row):null;}).getTenantLicense(tenantId);
    if(!["ACTIVE","TRIAL"].includes(license.status))throw new Error("CARGOS_DISPATCH_LICENSE_UNAVAILABLE");
    // Vehicle before Booking follows the handover/update lock order.
    const vehicles=await tx.$queryRaw<Array<{id:string}>>`SELECT v."id" FROM "Vehicle" v JOIN "RentalBooking" b ON b."vehicleId"=v."id" AND b."tenantId"=v."tenantId" WHERE b."id"=${bookingId} AND b."tenantId"=${tenantId} FOR SHARE OF v`;
    await tx.$queryRaw`SELECT "id" FROM "RentalBooking" WHERE "id"=${bookingId} AND "tenantId"=${tenantId} FOR SHARE`;
    await tx.$queryRaw`SELECT "id" FROM "BookingContract" WHERE "bookingId"=${bookingId} AND "tenantId"=${tenantId} FOR SHARE`;
    await tx.$queryRaw`SELECT c."id" FROM "RentalCustomer" c JOIN "RentalBooking" b ON b."customerId"=c."id" AND b."tenantId"=c."tenantId" WHERE b."id"=${bookingId} AND b."tenantId"=${tenantId} FOR SHARE OF c`;
    await tx.$queryRaw`SELECT c."id" FROM "RentalCustomer" c JOIN "BookingContract" b ON b."tenantId"=c."tenantId" WHERE b."bookingId"=${bookingId} AND b."tenantId"=${tenantId} AND (c."id"=b."rentalTerms"->>'primaryDriverId' OR c."id" IN (SELECT jsonb_array_elements_text(COALESCE(b."rentalTerms"->'additionalDriverIds','[]'::jsonb)))) ORDER BY c."id" FOR SHARE OF c`;
    await tx.$queryRaw`SELECT "tenantId" FROM "TenantCargosConnection" WHERE "tenantId"=${tenantId} FOR SHARE`;
    await tx.$queryRaw`SELECT "id" FROM "ContractCargosTransmission" WHERE "id"=${claim?.id??""} AND "tenantId"=${tenantId} FOR SHARE`;
    const value=await this.context(tenantId,bookingId,userId,tx);
    const reason=await contractSiteAuthorizationReason(tx,tenantId,bookingId,value.booking.contract!.id,userId,scope);
    if(reason||cargosDomainIssues(value.booking).length||vehicles[0]?.id!==value.booking.vehicleId||value.connection?.credentialsEncrypted!==credentialsEncrypted||(claim?value.transmission?.claimToken!==claim.token||value.transmission.status!=="SENDING":["SENDING","UNKNOWN","ACCEPTED","MANUAL_CONFIRMED"].includes(value.transmission?.status??""))||value.sourceHash!==expectedHash||["CANCELED","NO_SHOW"].includes(value.booking.status)||!value.connection?.enabled)throw new Error("CARGOS_DISPATCH_CHANGED");
    delivery.outcome=start().then(value=>({value}),error=>({error}));
   });
   if(!delivery.outcome)throw new Error("CARGOS_DISPATCH_NOT_STARTED");
   const result=await delivery.outcome;if("error" in result)throw result.error;return result.value;
  };
 }
 async preflight(tenantId:string,bookingId:string,userId:string){
  const value=await this.context(tenantId,bookingId,userId);const{booking,connection,record,sourceHash}=value;let transmission=value.transmission;
  // A crashed process may have sent the record. Never recycle its claim blindly.
  if(transmission?.status==="SENDING"&&transmission.startedAt&&Date.now()-transmission.startedAt.getTime()>60000){
   transmission={...transmission,status:"UNKNOWN"};
  }
  const issues=cargosRecordIssues(record),blockingReasons=cargosDomainIssues(booking);
  const history=await prisma.bookingContractEvent.findMany({where:{tenantId,contractId:booking.contract!.id,type:{startsWith:"CARGOS_"}},orderBy:[{createdAt:"desc"},{id:"desc"}],take:41,select:{id:true,type:true,message:true,createdAt:true,details:true}});
  const receipts=transmission?await prisma.contractCargosReceipt.findMany({where:{tenantId,transmissionId:transmission.id},orderBy:{createdAt:"desc"},select:{id:true,protocol:true,receiptDate:true,transactionId:true,kind:true,createdAt:true,sha256:true}}):[];
  const fields=CARGOS_FIELDS.map(field=>({...field,value:record[field.key]??"",editable:editable(field.key)&&!field.key.startsWith("AGENZIA_")&&(booking.contract!.rentalTerms===null||!field.key.startsWith("CONDUCENTE2_")||field.key.endsWith("_COD")),issue:issues[field.key]??null}));
  const state=transmission?.status??"DRAFT";
  return{bookingId,contractId:booking.contract!.id,code:booking.code,customer:booking.customerName,plate:booking.vehicle.plate,sourceHash,status:state,
   canReconcile:Boolean(!blockingReasons.length&&!["CANCELED","NO_SHOW"].includes(booking.status)&&value.transmission?.sourceHash===sourceHash&&value.transmission&&(value.transmission.status==="UNKNOWN"||value.transmission.status==="SENDING"&&value.transmission.startedAt&&Date.now()-value.transmission.startedAt.getTime()>5*60000)),sentSourceHash:transmission?.sourceHash??null,history:history.slice(0,40),historyCursor:history.length>40?history[39].id:null,receipts,blockingReasons,validation:{status:transmission?.checkStatus??null,checkedAt:transmission?.checkedAt??null,current:transmission?.checkSourceHash===sourceHash,errorCode:transmission?.checkErrorCode??null},manualConfirmedAt:transmission?.manualConfirmedAt??null,
   configured:Boolean(connection?.enabled)&&cargosStorageReady(),transactionId:transmission?.transactionId??null,acceptedAt:transmission?.acceptedAt??null,
   fields,canSend:!blockingReasons.length&&Boolean(booking.contract!.signedAt)&&Boolean(connection?.enabled)&&cargosStorageReady()&&!["CANCELED","NO_SHOW"].includes(booking.status)&&!fields.some(f=>f.issue)&&!["ACCEPTED","SENDING","UNKNOWN","MANUAL_CONFIRMED"].includes(state),
   sourceChanged:["ACCEPTED","MANUAL_CONFIRMED"].includes(state)&&transmission?.sourceHash!==sourceHash,
   message:blockingReasons[0]??(["ACCEPTED","MANUAL_CONFIRMED"].includes(state)&&transmission?.sourceHash!==sourceHash?"Dati modificati dopo l'invio: verifica l'adempimento prima della consegna.":["CANCELED","NO_SHOW"].includes(booking.status)?"Prenotazione annullata: verifica l’adempimento con il responsabile.":!cargosStorageReady()?"Collegamento CARGOS da predisporre in sicurezza.":!connection?.enabled?"Collegamento CARGOS da configurare per la tua azienda.":state==="SENDING"?"Invio in corso. Attendi e verifica di nuovo l’esito.":state==="UNKNOWN"?"Esito da verificare sul portale CARGOS prima di riprovare.":!booking.contract!.signedAt?"Completa la stipula del contratto prima della trasmissione.":null)};
 }
 async history(tenantId:string,bookingId:string,cursor?:string){
  const booking=await prisma.rentalBooking.findFirst({where:{...visibleBookingWhere(tenantId),id:bookingId,deletedAt:null},select:{contract:{select:{id:true,deletedAt:true}}}});
  if(!booking?.contract||booking.contract.deletedAt)throw new AppError("Contratto non trovato",404,"NOT_FOUND");
  const where={tenantId,contractId:booking.contract.id,type:{startsWith:"CARGOS_"}};
  const before=cursor?await prisma.bookingContractEvent.findFirst({where:{...where,id:cursor},select:{createdAt:true,id:true}}):null;
  if(cursor&&!before)throw new AppError("Riferimento storico non trovato",404,"NOT_FOUND");
  const events=await prisma.bookingContractEvent.findMany({where:{...where,...(before?{OR:[{createdAt:{lt:before.createdAt}},{createdAt:before.createdAt,id:{lt:before.id}}]}:{})},orderBy:[{createdAt:"desc"},{id:"desc"}],take:41,select:{id:true,type:true,message:true,createdAt:true,details:true}});
  return{events:events.slice(0,40),cursor:events.length>40?events[39].id:null};
 }
 async validate(tenantId:string,bookingId:string,userId:string,expectedHash:string){
  const value=await this.context(tenantId,bookingId,userId),scope=captureContractSiteAuthorization(siteAccessForTenant(tenantId),userId);
  if(value.sourceHash!==expectedHash)throw new AppError("Dati modificati: rileggi la pratica",409,"CARGOS_SOURCE_CHANGED");
  if(!value.connection?.enabled)throw new AppError("Collegamento CARGOS da configurare",409,"CARGOS_NOT_CONFIGURED");
  if(cargosDomainIssues(value.booking).length)throw new AppError(cargosDomainIssues(value.booking)[0],422,"CARGOS_MAPPING_REVIEW_REQUIRED");
  if(["ACCEPTED","SENDING","UNKNOWN","MANUAL_CONFIRMED"].includes(value.transmission?.status??""))throw new AppError("Il controllo dati non risolve un invio già avviato",409,"CARGOS_LOCKED");
  let record:string;try{record=serializeCargosRecord(value.record);}catch{throw new AppError("Completa i dati prima del controllo",422,"CARGOS_DATA_INCOMPLETE");}
  const result=await this.client(unseal(tenantId,value.connection.credentialsEncrypted)).check(record,this.guard(tenantId,bookingId,userId,scope,expectedHash,value.connection.credentialsEncrypted));
  await prisma.$transaction(async tx=>{
   await tx.$queryRaw`SELECT "id" FROM "RentalBooking" WHERE "id"=${bookingId} AND "tenantId"=${tenantId} FOR UPDATE`;
   const current=await this.context(tenantId,bookingId,userId,tx);
   if(current.sourceHash!==expectedHash||["ACCEPTED","SENDING","UNKNOWN","MANUAL_CONFIRMED"].includes(current.transmission?.status??""))throw new AppError("La pratica è cambiata durante il controllo",409,"CARGOS_SOURCE_CHANGED");
   const fields={checkStatus:result.status,checkedAt:new Date(),checkSourceHash:expectedHash,checkErrorCode:result.status==="INVALID"?result.errorCode:null};
   await tx.contractCargosTransmission.upsert({where:{contractId:current.booking.contract!.id},create:{tenantId,contractId:current.booking.contract!.id,...fields},update:fields});
   await tx.bookingContractEvent.create({data:{tenantId,bookingId,contractId:current.booking.contract!.id,actorUserId:userId,type:"CARGOS_CHECKED",message:"Controllo preventivo registrato, senza invio",details:{status:result.status,sourceHash:expectedHash,...(result.status==="INVALID"?{errorCode:result.errorCode}:{})}}});
  });return this.preflight(tenantId,bookingId,userId);
 }
 async saveDraft(tenantId:string,bookingId:string,userId:string,input:Record<string,string>){
  await prisma.$transaction(async tx=>{
   await tx.$queryRaw`SELECT "id" FROM "RentalBooking" WHERE "id"=${bookingId} AND "tenantId"=${tenantId} FOR UPDATE`;
   const current=await this.context(tenantId,bookingId,userId,tx);
   if(current.transmission&&["ACCEPTED","SENDING","UNKNOWN","MANUAL_CONFIRMED"].includes(current.transmission.status))throw new AppError("Trasmissione già avviata: verifica prima il suo esito",409,"CARGOS_LOCKED");
   const values=Object.fromEntries(Object.entries(input).filter(([key])=>editable(key)&&!key.startsWith("AGENZIA_")));
   await tx.contractCargosTransmission.upsert({where:{contractId:current.booking.contract!.id},create:{tenantId,contractId:current.booking.contract!.id,recordDraft:values},update:{recordDraft:{...recordObject(current.transmission?.recordDraft),...values},status:"DRAFT"}});
  });
  return this.preflight(tenantId,bookingId,userId);
 }
 async transmit(tenantId:string,bookingId:string,userId:string,expectedHash:string){
  const scope=captureContractSiteAuthorization(siteAccessForTenant(tenantId),userId);const token=crypto.randomUUID();
  const claim=await prisma.$transaction(async tx=>{
   await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id"=${userId} AND "tenantId"=${tenantId} FOR SHARE`;
   const tenants=await tx.$queryRaw<Array<{isActive:boolean;deletedAt:Date|null}>>`SELECT "isActive","deletedAt" FROM "Tenant" WHERE "id"=${tenantId} FOR SHARE`;
   if(!tenants[0]?.isActive||tenants[0].deletedAt)throw new AppError("Azienda non disponibile",403,"FORBIDDEN");
   await tx.$queryRaw`SELECT "id" FROM "RentalBooking" WHERE "id"=${bookingId} AND "tenantId"=${tenantId} FOR UPDATE`;
   const contract=await tx.bookingContract.findFirst({where:{tenantId,bookingId,deletedAt:null},select:{id:true}});
   if(!contract)throw new AppError("Contratto non trovato",404,"NOT_FOUND");const contractId=contract.id;
   await tx.$queryRaw`SELECT "id" FROM "BookingContract" WHERE "id"=${contractId} AND "tenantId"=${tenantId} FOR UPDATE`;
   await tx.$queryRaw`SELECT "tenantId" FROM "TenantCargosConnection" WHERE "tenantId"=${tenantId} FOR SHARE`;
   const context=await this.context(tenantId,bookingId,userId,tx);
   const reason=await contractSiteAuthorizationReason(tx,tenantId,bookingId,contractId,userId,scope);if(reason)throw new AppError("Autorizzazione non più valida",403,"FORBIDDEN");
   if(!context.connection?.enabled)throw new AppError("Collegamento CARGOS da configurare",409,"CARGOS_NOT_CONFIGURED");
   if(context.sourceHash!==expectedHash)throw new AppError("I dati sono cambiati: ricarica il riepilogo",409,"CARGOS_SOURCE_CHANGED");
   if(["CANCELED","NO_SHOW"].includes(context.booking.status))throw new AppError("Prenotazione annullata: verifica l’adempimento prima della trasmissione",409,"CARGOS_BOOKING_CANCELED");
   const domainIssues=cargosDomainIssues(context.booking);if(domainIssues.length)throw new AppError(domainIssues[0],422,"CARGOS_MAPPING_REVIEW_REQUIRED");
   if(!context.booking.contract!.signedAt)throw new AppError("Completa la stipula del contratto",409,"CARGOS_NOT_STIPULATED");
   let record:string;try{record=serializeCargosRecord(context.record);}catch(error){throw new AppError((error as Error).message,422,"CARGOS_DATA_INCOMPLETE");}
   const recordHash=hash(record);
   const row=await tx.contractCargosTransmission.upsert({where:{contractId},create:{tenantId,contractId},update:{}});
   if(row.status==="ACCEPTED"){
    if(row.sourceHash!==context.sourceHash)throw new AppError("Dati modificati dopo la trasmissione: verifica l’adempimento",409,"CARGOS_SOURCE_CHANGED");
    return{duplicate:true as const,transactionId:row.transactionId};
   }
   if(["SENDING","UNKNOWN","MANUAL_CONFIRMED"].includes(row.status))throw new AppError("Invio già avviato: attendi o verifica l'esito",409,"CARGOS_IN_PROGRESS");
   await tx.contractCargosTransmission.update({where:{id:row.id},data:{status:"SENDING",sourceHash:context.sourceHash,recordHash,recordEncrypted:sealRecord(tenantId,record),requestedByUserId:userId,claimToken:token,startedAt:new Date(),errorCode:null}});
   await tx.rentalBooking.update({where:{id:bookingId},data:{cargosStatus:"PENDING"}});
   await tx.bookingContractEvent.create({data:{tenantId,bookingId,contractId,actorUserId:userId,type:"CARGOS_STARTED",message:"Tentativo di controllo e invio acquisito",details:{attemptId:hash(token),sourceHash:context.sourceHash,recordHash}}});
   return{duplicate:false as const,id:row.id,record,credentialsEncrypted:context.connection.credentialsEncrypted,credentials:unseal(tenantId,context.connection.credentialsEncrypted)};
  });
  if(claim.duplicate)return{status:"ACCEPTED",transactionId:claim.transactionId,duplicate:true};
  const client=this.client(claim.credentials),guard=this.guard(tenantId,bookingId,userId,scope,expectedHash,claim.credentialsEncrypted,{id:claim.id,token});
  const check=await client.check(claim.record,guard);
  const result:CargosOutcome=check.status==="VALID"?await client.send(claim.record,guard):check.status==="INVALID"?{status:"REJECTED",errorCode:check.errorCode}:{status:"UNAVAILABLE"};
  await prisma.$transaction(async tx=>{
   await tx.$queryRaw`SELECT "id" FROM "RentalBooking" WHERE "id"=${bookingId} AND "tenantId"=${tenantId} FOR UPDATE`;
   const updated=await tx.contractCargosTransmission.updateMany({where:{id:claim.id,tenantId,status:"SENDING",claimToken:token},data:{status:result.status,checkStatus:check.status,checkedAt:new Date(),checkSourceHash:expectedHash,checkErrorCode:check.status==="INVALID"?check.errorCode:null,...(result.status==="ACCEPTED"?{transactionId:result.transactionId,acceptedAt:new Date()}:{errorCode:result.status==="REJECTED"?result.errorCode:result.status})}});
   if(updated.count!==1)throw new AppError("Esito da verificare: aggiornamento non confermato",409,"CARGOS_OUTCOME_UNCERTAIN");
   await tx.bookingContractEvent.create({data:{tenantId,bookingId,contractId:(await tx.contractCargosTransmission.findUniqueOrThrow({where:{id:claim.id}})).contractId,actorUserId:userId,type:"CARGOS_OUTCOME",message:"Esito del tentativo registrato",details:{attemptId:hash(token),status:result.status,checkStatus:check.status,...(result.status==="ACCEPTED"?{transactionId:result.transactionId}:result.status==="REJECTED"?{errorCode:result.errorCode}:{})}}});
   await tx.rentalBooking.update({where:{id:bookingId},data:{cargosStatus:result.status==="ACCEPTED"?"SENT":"ERROR",cargosSentAt:result.status==="ACCEPTED"?new Date():null,cargosTransmissionId:result.status==="ACCEPTED"?result.transactionId:null,cargosOutcomeMessage:result.status}});
  });
  return result;
 }
 async hasAccepted(tenantId:string,bookingId:string,userId:string,db:Prisma.TransactionClient){
  // Call under the booking/vehicle mutation locks when authorizing handover.
  await db.$queryRaw`SELECT "id" FROM "BookingContract" WHERE "bookingId"=${bookingId} AND "tenantId"=${tenantId} FOR SHARE`;
  await db.$queryRaw`SELECT c."id" FROM "RentalCustomer" c JOIN "RentalBooking" b ON b."customerId"=c."id" AND b."tenantId"=c."tenantId" WHERE b."id"=${bookingId} AND b."tenantId"=${tenantId} FOR SHARE OF c`;
  await db.$queryRaw`SELECT "tenantId" FROM "TenantCargosConnection" WHERE "tenantId"=${tenantId} FOR SHARE`;
  await db.$queryRaw`SELECT t."id" FROM "ContractCargosTransmission" t JOIN "BookingContract" c ON c."id"=t."contractId" AND c."tenantId"=t."tenantId" WHERE c."bookingId"=${bookingId} AND t."tenantId"=${tenantId} FOR SHARE OF t`;
  const value=await this.context(tenantId,bookingId,userId,db);
  if(cargosDomainIssues(value.booking).length||!value.transmission||value.transmission.sourceHash!==value.sourceHash)return false;
  if(value.transmission.status==="ACCEPTED")return true;
  if(value.transmission.status!=="MANUAL_CONFIRMED"||!value.transmission.manualConfirmedAt)return false;
  return Boolean(await db.contractCargosReceipt.findFirst({where:{tenantId,transmissionId:value.transmission.id,kind:"PORTAL_CONFIRMED",sourceHash:value.sourceHash,recordHash:value.transmission.recordHash!,transactionId:value.transmission.transactionId!,file:{is:{tenantId,visibility:"private",deletedAt:null}}},select:{id:true}}));
 }
}

export function cargosDomainIssues(booking:{customerId:string|null;customer:{customerType:string}|null;contract:{rentalTerms:unknown}|null}){
 const terms=booking.contract?.rentalTerms as {primaryDriverId?:unknown}|null;
 return booking.customer?.customerType==="PERSONA_GIURIDICA"||terms&&terms.primaryDriverId!==booking.customerId?["Contraente e conducente distinti: mappatura CARGOS da verificare con il servizio ufficiale prima dell’invio."]:[];
}
