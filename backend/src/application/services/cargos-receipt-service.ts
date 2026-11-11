import crypto from "node:crypto";
import {PDFDocument,PDFName,PDFDict,PDFArray} from "pdf-lib";
import type {Prisma} from "@prisma/client";
import {prisma} from "../../infrastructure/database/prisma/client.js";
import {persistNewBuffer} from "../../infrastructure/storage/upload-persistence.js";
import {storageProvider} from "../../infrastructure/storage/storage-provider.js";
import {assertCompanyResourceView} from "../../infrastructure/auth/company-resource-access.js";
import {siteAccessForTenant} from "../../infrastructure/auth/site-access-context.js";
import {captureContractSiteAuthorization,contractSiteAuthorizationReason} from "../../infrastructure/email/contract-site-authorization.js";
import {AppError} from "../../shared/errors/app-error.js";
import {ContractCargosService,cargosDomainIssues} from "./contract-cargos-service.js";
import {LicensePolicyService} from "./license-policy-service.js";
import {snapshotFromRow} from "./tenant-subscription-service.js";

const hash=(bytes:Buffer|string)=>crypto.createHash("sha256").update(bytes).digest("hex");
export type ReceiptInput={sourceHash:string;transactionId:string;protocol:string;receiptDate:string;kind:"ARCHIVE"|"CONFIRM_PORTAL";verifiedOnPortal:true;idempotencyKey:string};
class ReceiptReplay extends Error{}
export async function validateCargosReceipt(bytes:Buffer){
 if(bytes.length>2*1024*1024||!bytes.subarray(0,5).equals(Buffer.from("%PDF-")))throw new AppError("Allega una ricevuta PDF di massimo 2 MB",422,"CARGOS_RECEIPT_INVALID");
 try{
  const pdf=await PDFDocument.load(bytes,{updateMetadata:false});
  if(pdf.getPageCount()<1||pdf.getPageCount()>100||pdf.catalog.has(PDFName.of("OpenAction"))||pdf.catalog.has(PDFName.of("AA")))throw new Error("Unsupported PDF");
  const names=pdf.catalog.lookupMaybe(PDFName.of("Names"),PDFDict);
  if(names&&(names.has(PDFName.of("JavaScript"))||names.has(PDFName.of("EmbeddedFiles"))))throw new Error("Active content");
  const seen=new Set<unknown>();let count=0;
  const inspect=(object:unknown,depth=0):void=>{
   if(!object||seen.has(object))return;seen.add(object);if(++count>100000||depth>40)throw new Error("Complex PDF");
   if(object instanceof PDFDict){
    for(const[key,value]of object.entries()){
     if(["JS","JavaScript","AA","OpenAction","EmbeddedFiles","RichMedia","AF"].includes(key.asString().slice(1)))throw new Error("Active content");
     if(key.asString()==="/S"&&value instanceof PDFName&&["JavaScript","Launch","SubmitForm","ImportData","RichMediaExecute","GoToE"].includes(value.asString().slice(1)))throw new Error("Unsafe action");
     inspect(value,depth+1);
    }
   }else if(object instanceof PDFArray)for(const value of object.asArray())inspect(value,depth+1);
   else if(typeof object==="object"&&"dict" in object)inspect(object.dict,depth+1);
  };
  for(const[,object]of pdf.context.enumerateIndirectObjects())inspect(object);
 }catch{throw new AppError("PDF non leggibile, protetto o con contenuti attivi: verifica la ricevuta scaricata dal portale",422,"CARGOS_RECEIPT_INVALID");}
 // This validates safe storage, not origin, legal validity or government signatures.
}
export class CargosReceiptService{
 constructor(private readonly cargos=new ContractCargosService()){}
 private async authority(tx:Prisma.TransactionClient,tenantId:string,bookingId:string,userId:string,scope:unknown){
  assertCompanyResourceView(tenantId);
  await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id"=${userId} AND "tenantId"=${tenantId} FOR SHARE`;
  const tenant=await tx.$queryRaw<Array<{isActive:boolean;deletedAt:Date|null}>>`SELECT "isActive","deletedAt" FROM "Tenant" WHERE "id"=${tenantId} FOR SHARE`;
  if(!tenant[0]?.isActive||tenant[0].deletedAt)throw new AppError("Azienda non disponibile",403,"FORBIDDEN");
  const role=await tx.userRole.findFirst({where:{userId,role:{key:"ADMIN"},user:{tenantId,status:"ACTIVE",deletedAt:null}}});
  if(!role)throw new AppError("Verifica riservata all’amministratore aziendale",403,"FORBIDDEN");
  await tx.$queryRaw`SELECT "tenantId" FROM "TenantSubscription" WHERE "tenantId"=${tenantId} FOR SHARE`;
  const license=await new LicensePolicyService({getLatestByAction:(owner,resource,action)=>tx.auditLog.findFirst({where:{tenantId:owner,resource,action},orderBy:{createdAt:"desc"}})},async owner=>{const row=await tx.tenantSubscription.findUnique({where:{tenantId:owner}});return row?snapshotFromRow(row):null;}).getTenantLicense(tenantId);
  if(!["ACTIVE","TRIAL"].includes(license.status))throw new AppError("Abbonamento non disponibile",403,"FORBIDDEN");
  await tx.$queryRaw`SELECT "id" FROM "RentalBooking" WHERE "id"=${bookingId} AND "tenantId"=${tenantId} FOR UPDATE`;
  await tx.$queryRaw`SELECT "id" FROM "BookingContract" WHERE "bookingId"=${bookingId} AND "tenantId"=${tenantId} FOR SHARE`;
  const value=await this.cargos.context(tenantId,bookingId,userId,tx);
  if(await contractSiteAuthorizationReason(tx,tenantId,bookingId,value.booking.contract!.id,userId,scope))throw new AppError("Autorizzazione non più valida",403,"FORBIDDEN");
  if(value.transmission)await tx.$queryRaw`SELECT "id" FROM "ContractCargosTransmission" WHERE "id"=${value.transmission.id} AND "tenantId"=${tenantId} FOR UPDATE`;
  return this.cargos.context(tenantId,bookingId,userId,tx);
 }
 async save(tenantId:string,bookingId:string,userId:string,input:ReceiptInput,bytes:Buffer,retry=0):Promise<Awaited<ReturnType<ContractCargosService["preflight"]>>>{
  const scope=captureContractSiteAuthorization(siteAccessForTenant(tenantId),userId);assertCompanyResourceView(tenantId);
  await validateCargosReceipt(bytes);
  const sha256=hash(bytes),requestHash=hash(JSON.stringify({...input,sha256,tenantId,bookingId,userId}));
  // No receipt can be used as evidence for a different booking through key reuse.
  const previous=await prisma.contractCargosReceipt.findUnique({where:{tenantId_idempotencyKey:{tenantId,idempotencyKey:input.idempotencyKey}}});
  if(previous){if(previous.requestHash!==requestHash)throw new AppError("Richiesta già utilizzata con dati differenti",409,"IDEMPOTENCY_CONFLICT");return this.cargos.preflight(tenantId,bookingId,userId);}
  const source=await this.cargos.context(tenantId,bookingId,userId),transmission=source.transmission;
  if(!transmission)throw new AppError("Nessun tentativo da riconciliare",409,"CARGOS_NO_TRANSMISSION");
  const id=crypto.randomUUID();
  try{await persistNewBuffer({tenantId,category:"cargos-receipts",resourceType:"ContractCargosReceipt",resourceId:id,originalName:"Ricevuta_CARGOS.pdf",mimeType:"application/pdf",buffer:bytes,commit:async(tx,key)=>{
   const value=await this.authority(tx,tenantId,bookingId,userId,scope),row=value.transmission;
   const replay=await tx.contractCargosReceipt.findUnique({where:{tenantId_idempotencyKey:{tenantId,idempotencyKey:input.idempotencyKey}}});
   if(replay){if(replay.requestHash!==requestHash)throw new AppError("Richiesta già utilizzata",409,"IDEMPOTENCY_CONFLICT");throw new ReceiptReplay();}
   if(!row||row.id!==transmission.id||row.sourceHash!==input.sourceHash||!row.recordHash||!row.recordEncrypted)throw new AppError("Il riferimento non corrisponde al tentativo conservato",409,"CARGOS_RECEIPT_SOURCE_CHANGED");
   const manual=input.kind==="CONFIRM_PORTAL",stale=row.status==="SENDING"&&Boolean(row.startedAt&&Date.now()-row.startedAt.getTime()>5*60000);
   if(manual){
    if(!(row.status==="UNKNOWN"||stale)||value.sourceHash!==row.sourceHash||cargosDomainIssues(value.booking).length||["CANCELED","NO_SHOW"].includes(value.booking.status))throw new AppError("Questo tentativo non può essere confermato manualmente: verifica stato e dati",409,"CARGOS_RECONCILIATION_BLOCKED");
   }else if(!["ACCEPTED","MANUAL_CONFIRMED"].includes(row.status)||row.transactionId!==input.transactionId)throw new AppError("La ricevuta non corrisponde al riferimento registrato",409,"CARGOS_RECEIPT_REFERENCE_MISMATCH");
   const reused=await tx.contractCargosTransmission.findFirst({where:{tenantId,transactionId:input.transactionId,id:{not:row.id}},select:{id:true}});
   if(reused)throw new AppError("Riferimento già associato a un altro invio",409,"CARGOS_REFERENCE_REUSED");
   const file=await tx.storedFileObject.findFirstOrThrow({where:{tenantId,storageKey:key,resourceType:"ContractCargosReceipt",resourceId:id,visibility:"private",deletedAt:null}});
   await tx.contractCargosReceipt.create({data:{id,tenantId,transmissionId:row.id,storedFileObjectId:file.id,idempotencyKey:input.idempotencyKey,requestHash,sha256,protocol:input.protocol,receiptDate:new Date(input.receiptDate+"T00:00:00Z"),transactionId:input.transactionId,sourceHash:row.sourceHash,recordHash:row.recordHash,kind:manual?"PORTAL_CONFIRMED":"API_ACCEPTED_RECEIPT",actorUserId:userId}});
   if(manual){
    await tx.contractCargosTransmission.update({where:{id:row.id},data:{status:"MANUAL_CONFIRMED",manualConfirmedAt:new Date(),transactionId:input.transactionId,errorCode:null}});
    await tx.rentalBooking.update({where:{id:bookingId},data:{cargosStatus:"SENT",cargosTransmissionId:input.transactionId,cargosSentAt:null,cargosOutcomeMessage:"MANUAL_CONFIRMED"}});
   }
   await tx.bookingContractEvent.create({data:{tenantId,bookingId,contractId:value.booking.contract!.id,actorUserId:userId,type:manual?"CARGOS_PORTAL_CONFIRMED":"CARGOS_RECEIPT_ATTACHED",message:manual?"Invio verificato manualmente sul portale dal responsabile; nessun nuovo invio":"Ricevuta del portale archiviata dal responsabile",details:{receiptId:id,sha256,protocol:input.protocol,transactionId:input.transactionId,sourceHash:row.sourceHash,recordHash:row.recordHash}}});
  }});}catch(error){
   if(error instanceof ReceiptReplay)return this.cargos.preflight(tenantId,bookingId,userId);
   // persistNewBuffer has already compensated this rolled-back physical object.
   // Retry only PostgreSQL's explicit serialization/deadlock rollback, never an
   // uncertain COMMIT or an arbitrary network error.
   const failure=error as {code?:string;meta?:{code?:string}};
   const rolledBack=failure?.code==="P2034"||failure?.code==="P2010"&&["40001","40P01"].includes(failure.meta?.code??"");
   if(rolledBack&&retry<2)return this.save(tenantId,bookingId,userId,input,bytes,retry+1);
   if(rolledBack)throw new AppError("Richieste contemporanee: riprova mantenendo gli stessi dati",409,"CARGOS_RECEIPT_RETRY");
   if(error&&typeof error==="object"&&"code" in error&&error.code==="P2002")throw new AppError("Riferimento già registrato: rileggi lo stato",409,"CARGOS_RECEIPT_CONFLICT");
   throw error;
  }
  return this.cargos.preflight(tenantId,bookingId,userId);
 }
 async download(tenantId:string,bookingId:string,userId:string,receiptId:string){
  assertCompanyResourceView(tenantId);const value=await this.cargos.context(tenantId,bookingId,userId);
  const receipt=value.transmission?await prisma.contractCargosReceipt.findFirst({where:{id:receiptId,tenantId,transmissionId:value.transmission.id},include:{file:true}}):null;
  if(!receipt||receipt.file.tenantId!==tenantId||receipt.file.visibility!=="private"||receipt.file.deletedAt||receipt.file.resourceType!=="ContractCargosReceipt"||receipt.file.resourceId!==receipt.id)throw new AppError("Ricevuta non trovata",404,"NOT_FOUND");
  const bytes=await storageProvider.read(receipt.file.storageKey);
  if(bytes.length!==receipt.file.sizeBytes||bytes.length>2*1024*1024||hash(bytes)!==receipt.sha256||receipt.file.checksumSha256!==receipt.sha256)throw new AppError("Verifica della ricevuta non riuscita",503,"CARGOS_RECEIPT_INTEGRITY");
  return bytes;
 }
}
export const cargosReceiptService=new CargosReceiptService();
