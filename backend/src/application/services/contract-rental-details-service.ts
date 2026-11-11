import type {Prisma} from "@prisma/client";
import {prisma} from "../../infrastructure/database/prisma/client.js";
import {AppError} from "../../shared/errors/app-error.js";
import {visibleBookingWhere} from "../../infrastructure/repositories/resource-site-scope.js";
import {assertNoSigningFreeze,lockSigningBusinessSource} from "./contract-signing-source.js";
import {emptyRentalTerms,rentalTermsSchema,rentalTermsIssues,type RentalTerms} from "./contract-rental-terms.js";

import {resolveContractDrivers,driverIssues} from "./contract-rental-drivers.js";
export class ContractRentalDetailsService{
 private async contract(tenantId:string,bookingId:string,db:Prisma.TransactionClient=prisma){
  const value=await db.bookingContract.findFirst({where:{tenantId,bookingId,deletedAt:null,booking:{is:{...visibleBookingWhere(tenantId),deletedAt:null}}},include:{booking:true}});
  if(!value)throw new AppError("Contratto non trovato",404,"BOOKING_CONTRACT_NOT_FOUND");return value;
 }
 async read(tenantId:string,bookingId:string){
  const contract=await this.contract(tenantId,bookingId),terms=contract.rentalTerms===null?emptyRentalTerms():rentalTermsSchema.parse(contract.rentalTerms);
  // Registry is shared across this company's sites, never across tenants. Options are searched separately.
  const drivers=await resolveContractDrivers(tenantId,terms,prisma,false);
  const missing=drivers.length!==[terms.primaryDriverId,...terms.additionalDriverIds].filter(Boolean).length;
  const frozen=Boolean(contract.signedAt)||contract.status==="SIGNED"||Boolean(await prisma.contractSigningRequest.findFirst({where:{tenantId,contractId:contract.id,OR:[{status:"SIGNED",contractRevision:contract.documentRevision},{status:"PENDING",expiresAt:{gt:new Date()}}]},select:{id:true}}));
  return{terms,revision:contract.rentalTermsRevision,frozen,drivers:drivers.map(d=>({id:d.id,name:`${d.firstName} ${d.lastName}`})),issues:[...rentalTermsIssues(contract.rentalTerms),...(missing?["Conducente non più disponibile: seleziona una persona valida nell’anagrafica"]:[]),...driverIssues(drivers,contract.booking.returnAt)]};
 }
 async candidates(tenantId:string,bookingId:string,search:string){
  await this.contract(tenantId,bookingId);
  if(search.trim().length<2)return[];
  const values=await prisma.rentalCustomer.findMany({where:{tenantId,deletedAt:null,customerType:"PERSONA_FISICA",OR:[{firstName:{contains:search,mode:"insensitive"}},{lastName:{contains:search,mode:"insensitive"}}]},select:{id:true,firstName:true,lastName:true},take:30,orderBy:[{lastName:"asc"},{firstName:"asc"}]});
  return values.map(d=>({id:d.id,name:`${d.firstName} ${d.lastName}`}));
 }
 async save(tenantId:string,bookingId:string,userId:string,revision:number,terms:RentalTerms){
  const clean=rentalTermsSchema.parse(terms);
  await prisma.$transaction(async tx=>{
   // Same booking/contract lock order as invitation creation and legacy document edits.
   await lockSigningBusinessSource(tx,tenantId,bookingId,true);
   const contract=await this.contract(tenantId,bookingId,tx);
   if(contract.signedAt||contract.status==="SIGNED")throw new AppError("Il contratto sottoscritto è immutabile",409,"CONTRACT_DOCUMENT_FROZEN");
   await assertNoSigningFreeze(tx,tenantId,bookingId);
   if(contract.rentalTermsRevision!==revision)throw new AppError("Le condizioni sono cambiate. Ricarica prima di modificarle.",409,"CONTRACT_TERMS_CONFLICT");
   await resolveContractDrivers(tenantId,clean,tx);
   await tx.bookingContract.update({where:{id:contract.id},data:{rentalTerms:clean,rentalTermsRevision:{increment:1},updatedByUserId:userId}});
   await tx.bookingContractEvent.create({data:{tenantId,contractId:contract.id,type:"RENTAL_TERMS_UPDATED",bookingId,actorUserId:userId,message:"Condizioni specifiche aggiornate",details:{revision:revision+1}}});
  });
  return this.read(tenantId,bookingId);
 }
}
export const contractRentalDetailsService=new ContractRentalDetailsService();
