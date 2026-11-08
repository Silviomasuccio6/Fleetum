import {Prisma} from '@prisma/client';
import {storageProvider} from '../../infrastructure/storage/storage-provider.js';
import {prisma} from '../../infrastructure/database/prisma/client.js';
import {AppError} from '../../shared/errors/app-error.js';
import {collectionBalance} from '../../domain/payments/rental-collection-policy.js';
import {loadSigningSource,lockSigningBusinessSource,assertSigningReady,assertNoSigningFreeze,signingHash,stableSigningJson} from './contract-signing-source.js';

/** Receipts are reviewed, never used as permission to issue a rental contract. */
export class ContractIssuanceService {
 private async review(tx:Prisma.TransactionClient,tenantId:string,bookingId:string){
  const source=await loadSigningSource(tenantId,bookingId,tx);
  const entries=await tx.rentalCollectionEntry.findMany({where:{tenantId,bookingId},orderBy:[{createdAt:'asc'},{id:'asc'}]});
  const amount=source.booking.finalTotal??source.booking.expectedTotal;
  const agreedCents=amount===null?null:Math.round(amount*100);
  const balance=collectionBalance(agreedCents,entries);
  const readinessIssues:string[]=[];
  if(!source.contract.issuedAt&&!source.contract.signedAt){try{assertSigningReady(source);}catch(error){if(error instanceof AppError&&[409,422].includes(error.statusCode))readinessIssues.push(error.message);else throw error;}}
  const reviewed={sourceHash:source.sourceHash,balance,entries:entries.map(e=>e.id)};
  return{source,value:{contractId:source.contract.id,documentRevision:source.contract.documentRevision,issuedAt:source.contract.issuedAt,legacySigned:source.contract.status==='SIGNED'&&!source.contract.issuedAt,customer:source.booking.customerName,bookingCode:source.booking.code,vehicle:source.booking.vehicle.plate,pickupAt:source.booking.pickupAt,returnAt:source.booking.returnAt,pickupLocation:source.booking.pickupLocation,returnLocation:source.booking.returnLocation,readinessIssues,priceAgreement:source.booking.priceAgreement,balance,reviewHash:signingHash(stableSigningJson(reviewed))}};
 }
 async preflight(tenantId:string,bookingId:string){return prisma.$transaction(async tx=>(await this.review(tx,tenantId,bookingId)).value,{isolationLevel:'RepeatableRead'});}
 async convert(tenantId:string,bookingId:string,userId:string,reviewHash:string){
  return prisma.$transaction(async tx=>{
   await lockSigningBusinessSource(tx,tenantId,bookingId,true);
   const {source,value}=await this.review(tx,tenantId,bookingId);
   if(source.contract.issuedAt)return{...value,duplicate:true};
   assertSigningReady(source);
   await assertNoSigningFreeze(tx,tenantId,bookingId);
   if(value.reviewHash!==reviewHash)throw new AppError('I dati o gli incassi sono cambiati. Rileggi il riepilogo.',409,'CONTRACT_REVIEW_CHANGED');
   const now=new Date();
   await tx.bookingContract.update({where:{id:source.contract.id},data:{issuedAt:now,issuedByUserId:userId,issuanceHash:reviewHash,status:'READY',updatedByUserId:userId}});
   await tx.rentalBooking.update({where:{id:bookingId},data:{contractStatus:'READY'}});
   await tx.bookingContractEvent.create({data:{tenantId,bookingId,contractId:source.contract.id,actorUserId:userId,type:'ISSUED_MANUALLY',message:'Prenotazione trasformata manualmente in contratto',details:{reviewHash,balance:value.balance,sourceHash:source.sourceHash}}});
   return{...value,issuedAt:now,duplicate:false};
  });
 }
 async startRevision(tenantId:string,bookingId:string,userId:string,expectedRevision:number){
  return prisma.$transaction(async tx=>{
   await lockSigningBusinessSource(tx,tenantId,bookingId,true);
   const source=await loadSigningSource(tenantId,bookingId,tx);
   if(source.contract.documentRevision===expectedRevision+1&&!source.contract.signedAt)return{duplicate:true};
   if(source.contract.documentRevision!==expectedRevision||source.contract.status!=="SIGNED"||source.booking.status!=="CONTRACT_SIGNED")throw new AppError("La revisione è disponibile per un contratto firmato prima della consegna. Dopo la consegna serve un atto separato.",409,"CONTRACT_REVISION_UNAVAILABLE");
   const original=await tx.contractSigningRequest.findFirst({where:{tenantId,contractId:source.contract.id,contractRevision:expectedRevision,status:"SIGNED",signedStoredFileObjectId:{not:null}}});
   if(!original)throw new AppError("Conserva e verifica prima il documento storico originale. Non può essere ricreato automaticamente.",409,"CONTRACT_LEGACY_REVISION_UNAVAILABLE");
   for(const [id,sha,type] of [[original.storedFileObjectId,original.documentSha256,'ContractSigningDocument'],[original.signedStoredFileObjectId!,original.signedDocumentSha256!,'ContractSignedDocument']]){
    const file=await tx.storedFileObject.findFirst({where:{id,tenantId,resourceType:type,resourceId:original.id,visibility:'private',deletedAt:null}});
    if(!file||file.sizeBytes>3*1024*1024||file.checksumSha256!==sha)throw new AppError('Verifica la conservazione del documento firmato prima della revisione.',503,'CONTRACT_ORIGINAL_UNAVAILABLE');
    const bytes=await storageProvider.read(file.storageKey).catch(()=>null);
    if(!bytes||bytes.length!==file.sizeBytes||signingHash(bytes)!==sha)throw new AppError('Il documento conservato non è leggibile o non supera la verifica di integrità.',503,'CONTRACT_ORIGINAL_UNAVAILABLE');
   }
   await tx.bookingContract.update({where:{id:source.contract.id},data:{documentRevision:{increment:1},issuedAt:null,issuedByUserId:null,issuanceHash:null,status:"DRAFT",signedAt:null,updatedByUserId:userId}});
   await tx.rentalBooking.update({where:{id:bookingId},data:{status:"CONFIRMED",contractStatus:"NOT_READY",contractSignedAt:null}});
   await tx.bookingContractEvent.create({data:{tenantId,bookingId,contractId:source.contract.id,actorUserId:userId,type:"REVISION_STARTED",message:"Nuova revisione da emettere e firmare; originale conservato",details:{previousSigningRequestId:original.id,previousRevision:expectedRevision,documentRevision:expectedRevision+1}}});
   return{duplicate:false};
  });
 }
 async agreePrice(tenantId:string,bookingId:string,userId:string,input:{listCents:number;discountCents:number;reason:string;reviewHash:string}){
  return prisma.$transaction(async tx=>{
   await lockSigningBusinessSource(tx,tenantId,bookingId,true);
   const {source,value}=await this.review(tx,tenantId,bookingId);
   await assertNoSigningFreeze(tx,tenantId,bookingId);
   if(source.contract.issuedAt)throw new AppError('Il contratto è già emesso. Prepara una nuova revisione prima di cambiare il prezzo.',409,'CONTRACT_PRICE_FROZEN');
   if(input.reviewHash!==value.reviewHash)throw new AppError('I dati sono cambiati. Rileggi il riepilogo.',409,'CONTRACT_REVIEW_CHANGED');
   const agreedCents=input.listCents-input.discountCents;
   const agreement={version:1,currency:'EUR',listCents:input.listCents,discountCents:input.discountCents,agreedCents,reason:input.reason,actorUserId:userId,recordedAt:new Date().toISOString()};
   // Keep a single authoritative rental total, including an expressly agreed zero.
   await tx.rentalBooking.update({where:{id:bookingId},data:{expectedTotal:agreedCents/100,finalTotal:agreedCents/100,priceAgreement:agreement}});
   await tx.bookingContractEvent.create({data:{tenantId,bookingId,contractId:source.contract.id,actorUserId:userId,type:'PRICE_AGREED',message:'Prezzo e sconto concordati registrati',details:agreement}});
   return(await this.review(tx,tenantId,bookingId)).value;
  });
 }
}
export const contractIssuanceService=new ContractIssuanceService();
export function assertContractIssued(contract:{issuedAt:Date|null;signedAt:Date|null;status:string}){
 if(!contract.issuedAt&&!contract.signedAt&&contract.status!=='SIGNED')throw new AppError('Trasforma prima la prenotazione in contratto e conferma il riepilogo.',409,'CONTRACT_MANUAL_CONVERSION_REQUIRED');
}
