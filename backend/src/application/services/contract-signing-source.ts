import {collectionBalance} from "../../domain/payments/rental-collection-policy.js";
import {ExactMoneyReader} from "../../infrastructure/database/exact-money-reader.js";
import {resolveContractDrivers,driverIssues} from "./contract-rental-drivers.js";
import {rentalTermsSchema,rentalTermsIssues} from "./contract-rental-terms.js";
import type {Prisma} from "@prisma/client";
import {prisma} from "../../infrastructure/database/prisma/client.js";
import {visibleBookingWhere} from "../../infrastructure/repositories/resource-site-scope.js";
import {buildEnterpriseContractPdf} from "./enterprise-contract-pdf-service.js";
import {AppError} from "../../shared/errors/app-error.js";
import crypto from "node:crypto";

export const stableSigningJson=(value:unknown):string=>JSON.stringify(value,(_key,current)=>{
 if(current&&typeof current==="object"&&!Array.isArray(current))return Object.fromEntries(Object.keys(current).sort().map(key=>[key,current[key]]));
 return current;
});
export const signingHash=(value:string|Buffer)=>crypto.createHash("sha256").update(value).digest("hex");
export async function loadSigningSource(tenantId:string,bookingId:string,db:Prisma.TransactionClient=prisma){
 const contract=await db.bookingContract.findFirst({where:{tenantId,bookingId,deletedAt:null,booking:{is:{...visibleBookingWhere(tenantId),deletedAt:null}}},include:{template:true,tenant:{include:{tenantProfile:true,tenantBranding:true,tenantLegalSettings:true}},booking:{include:{vehicle:true,customer:true,pricingSnapshot:true}}}});
 if(!contract)throw new AppError("Contratto non trovato",404,"BOOKING_CONTRACT_NOT_FOUND");
 const reader=new ExactMoneyReader().withQuery(<T>(sql:string,...values:unknown[])=>db.$queryRawUnsafe<T>(sql,...values));
 [contract.booking]=await reader.hydrate("RentalBooking",[contract.booking],{tenantId});
 const {booking,tenant,template}=contract,{tenantProfile:profile,tenantBranding:branding,tenantLegalSettings:legal}=tenant;
 const drivers=await resolveContractDrivers(tenantId,contract.rentalTerms,db,false);
 const companyName=profile?.tradeName??profile?.legalName??template?.companyName??tenant.name;
 const input:Parameters<typeof buildEnterpriseContractPdf>[0]={
  contract:{issuedAt:contract.issuedAt,documentRevision:contract.documentRevision,rentalTerms:contract.rentalTerms,drivers,title:contract.title,content:[contract.content,legal?.defaultContractTerms&&!contract.content.includes(legal.defaultContractTerms)?"CONDIZIONI AZIENDALI\n"+legal.defaultContractTerms:null,legal?.contractFooterText].filter(Boolean).join("\n\n"),status:"READY",templateVersion:contract.templateVersion,createdAt:contract.createdAt,updatedAt:contract.createdAt,signedAt:null,lastSentAt:null,latestDelivery:null},
  booking:{code:booking.code,status:"CONFIRMED",contractStatus:"READY",customerName:booking.customerName,customerEmail:booking.customerEmail,customerPhone:booking.customerPhone,customerDocument:booking.customerDocument,pickupAt:booking.pickupAt,returnAt:booking.returnAt,pickupLocation:booking.pickupLocation,returnLocation:booking.returnLocation,pickupKm:booking.pickupKm,returnKm:null,expectedTotal:booking.expectedTotal,finalTotal:booking.finalTotal,priceAgreement:booking.priceAgreement,vehicle:booking.vehicle,customer:booking.customer,pricingSnapshot:booking.pricingSnapshot},
  branding:{companyName,companyAddress:profile?[profile.legalAddress,profile.postalCode,profile.city,profile.province,profile.country].filter(Boolean).join(", "):template?.companyAddress,companyVat:profile?[profile.vatNumber?`P.IVA ${profile.vatNumber}`:null,profile.taxCode?`CF ${profile.taxCode}`:null].filter(Boolean).join(" · "):template?.companyVat,companyEmail:profile?.email??profile?.pec??template?.companyEmail,companyPhone:profile?.phone??template?.companyPhone,logoFilePath:branding?.logoFilePath??template?.logoFilePath,logoFileName:branding?.logoFileName??template?.logoFileName,brandPrimary:branding?.primaryColor??template?.brandPrimary,brandAccent:branding?.accentColor??template?.brandAccent,brandFont:branding?.fontFamily??template?.brandFont}
 };
 // A ledger photograph is descriptive only. Later receipts must not invalidate an invitation
 // or change a frozen document. Tenant and site visibility were established above.
 const entries=await db.rentalCollectionEntry.findMany({where:{tenantId,bookingId},orderBy:[{createdAt:"asc"},{id:"asc"}]});
 const amount=booking.finalTotal??booking.expectedTotal;
 const balance=collectionBalance(amount===null?null:Math.round(amount*100),entries);
 input.booking.collections={recordedAt:new Date(),receivedCents:balance.receivedCents,outstandingCents:balance.outstandingCents,creditCents:balance.creditCents,state:balance.state};
 // Exclude mutable workflow/email/PDF timestamps from the document fingerprint.
 // Customer and vehicle identity remain part of the source even when omitted by a template.
 const customer=booking.customer?Object.fromEntries(Object.entries(booking.customer).filter(([key])=>!["createdAt","updatedAt"].includes(key))):null;
 const pricing=booking.pricingSnapshot?Object.fromEntries(Object.entries(booking.pricingSnapshot).filter(([key])=>!["createdAt","updatedAt"].includes(key))):null;
 const fingerprint={tenantId,contractId:contract.id,documentRevision:contract.documentRevision,rentalTerms:contract.rentalTerms,drivers:drivers.map(({createdAt,updatedAt,...driver})=>driver),title:contract.title,content:contract.content,templateVersion:contract.templateVersion,booking:{id:booking.id,code:booking.code,customerId:booking.customerId,customerName:booking.customerName,customerEmail:booking.customerEmail,customerPhone:booking.customerPhone,customerDocument:booking.customerDocument,vehicleId:booking.vehicleId,pickupSiteId:booking.pickupSiteId,returnSiteId:booking.returnSiteId,siteId:booking.siteId,pickupAt:booking.pickupAt,returnAt:booking.returnAt,pickupLocation:booking.pickupLocation,returnLocation:booking.returnLocation,pickupKm:booking.pickupKm,expectedTotal:booking.expectedTotal,finalTotal:booking.finalTotal,priceAgreement:booking.priceAgreement},vehicle:{plate:booking.vehicle.plate,brand:booking.vehicle.brand,model:booking.vehicle.model},customer,pricing,branding:input.branding,terms:legal?.defaultContractTerms,footer:legal?.contractFooterText};
 const sourceHash=signingHash(stableSigningJson(fingerprint));
 // Existing invitations retain their original fingerprint only when their agreed
 // amount is unchanged. A new manual agreement must always use the new format.
 const {documentRevision:_revision,booking:fingerprintBooking,...legacyFields}=fingerprint;
 const {finalTotal:_final,priceAgreement:_agreement,...legacyBooking}=fingerprintBooking;
 const legacySourceHash=signingHash(stableSigningJson({...legacyFields,booking:legacyBooking}));
 const signerName=booking.customer?.customerType==="PERSONA_GIURIDICA"?[booking.customer.legalRepFirstName,booking.customer.legalRepLastName].filter(Boolean).join(" "):[booking.customer?.firstName,booking.customer?.lastName].filter(Boolean).join(" ");
 const recipient=contract.emailTo??(booking.customer?.customerType==="PERSONA_GIURIDICA"?booking.customer.legalRepEmail:null)??booking.customer?.email??booking.customerEmail??"";
 return{contract,booking,input,sourceHash,legacySourceHash,signerName,recipient,issuerName:companyName,drivers};
}
export const assertSigningReady=(source:Awaited<ReturnType<typeof loadSigningSource>>)=>{
 const {contract,booking,input,signerName}=source;
 if(contract.signedAt||contract.status==="SIGNED")throw new AppError("Il contratto è già firmato",409,"CONTRACT_ALREADY_SIGNED");
 if(booking.status!=="CONFIRMED")throw new AppError("Conferma la prenotazione prima di inviare il contratto per firma",409,"CONTRACT_BOOKING_CONFIRM_REQUIRED");
 if(!booking.customer||booking.customer.deletedAt||!signerName.trim())throw new AppError("Completa l’identità del firmatario nell’anagrafica",422,"CONTRACT_SIGNER_INCOMPLETE");
 if(!input.branding?.companyName||!input.branding.companyAddress||!input.branding.companyVat)throw new AppError("Completa i dati del locatore prima della firma",422,"CONTRACT_ISSUER_INCOMPLETE");
 if(!booking.vehicle.plate?.trim()||!booking.vehicle.brand?.trim()||!booking.vehicle.model?.trim())throw new AppError("Completa targa, marca e modello del veicolo prima di emettere il contratto",422,"CONTRACT_VEHICLE_INCOMPLETE");
 if(!booking.pickupLocation?.trim()||!booking.returnLocation?.trim())throw new AppError("Completa luogo di ritiro e luogo di restituzione prima di emettere il contratto",422,"CONTRACT_LOCATIONS_INCOMPLETE");
 if(!Number.isFinite(booking.pickupAt.getTime())||!Number.isFinite(booking.returnAt.getTime())||booking.returnAt<=booking.pickupAt)throw new AppError("Verifica date e orari di ritiro e restituzione",422,"CONTRACT_PERIOD_INVALID");
 if(booking.finalTotal===null&&booking.expectedTotal===null)throw new AppError("Completa le condizioni economiche concordate",422,"CONTRACT_PRICE_REQUIRED");
 const terms=rentalTermsSchema.safeParse(contract.rentalTerms);
 const missing=terms.success&&source.drivers.length!==[terms.data.primaryDriverId,...terms.data.additionalDriverIds].filter(Boolean).length;
 const issues=[...rentalTermsIssues(contract.rentalTerms),...(missing?["Conducente non disponibile: verifica l’anagrafica"]:[]),...driverIssues(source.drivers,booking.returnAt)];
 if(issues.length)throw new AppError(issues.join(". "),422,"CONTRACT_RENTAL_DETAILS_INCOMPLETE");
 if(!input.contract.title.trim()||!input.contract.content.trim())throw new AppError("Completa titolo e condizioni contrattuali del locatore prima di emettere il documento",422,"CONTRACT_TERMS_REQUIRED");
 if(/\{\{[^}]+\}\}/.test(input.contract.content))throw new AppError("Il contratto contiene campi ancora da compilare",422,"CONTRACT_TEMPLATE_INCOMPLETE");
};
export async function lockSigningBusinessSource(tx:Prisma.TransactionClient,tenantId:string,bookingId:string,write=false){
 // Vehicle before Booking agrees with the existing booking/hand-over lock order.
 await tx.$queryRaw`SELECT v."id" FROM "Vehicle" v JOIN "RentalBooking" b ON b."vehicleId"=v."id" AND b."tenantId"=v."tenantId" WHERE b."id"=${bookingId} AND b."tenantId"=${tenantId} FOR SHARE OF v`;
 if(write)await tx.$queryRaw`SELECT "id" FROM "RentalBooking" WHERE "id"=${bookingId} AND "tenantId"=${tenantId} FOR UPDATE`;
 else await tx.$queryRaw`SELECT "id" FROM "RentalBooking" WHERE "id"=${bookingId} AND "tenantId"=${tenantId} FOR SHARE`;
 await tx.$queryRaw`SELECT "id" FROM "BookingContract" WHERE "bookingId"=${bookingId} AND "tenantId"=${tenantId} FOR UPDATE`;
 await tx.$queryRaw`SELECT c."id" FROM "RentalCustomer" c JOIN "RentalBooking" b ON b."customerId"=c."id" AND b."tenantId"=c."tenantId" WHERE b."id"=${bookingId} AND b."tenantId"=${tenantId} FOR SHARE OF c`;
 // Driver IDs are resolved only inside the owning tenant. Lock their identity for the frozen version.
 await tx.$queryRaw`SELECT c."id" FROM "RentalCustomer" c JOIN "BookingContract" b ON b."tenantId"=c."tenantId" WHERE b."bookingId"=${bookingId} AND b."tenantId"=${tenantId} AND (c."id"=b."rentalTerms"->>'primaryDriverId' OR c."id" IN (SELECT jsonb_array_elements_text(COALESCE(b."rentalTerms"->'additionalDriverIds','[]'::jsonb)))) ORDER BY c."id" FOR SHARE OF c`;
 await tx.$queryRaw`SELECT "id" FROM "RentalBookingPricingSnapshot" WHERE "bookingId"=${bookingId} AND "tenantId"=${tenantId} FOR SHARE`;
 await tx.$queryRaw`SELECT t."id" FROM "ContractTemplate" t JOIN "BookingContract" c ON c."templateId"=t."id" AND c."tenantId"=t."tenantId" WHERE c."bookingId"=${bookingId} AND c."tenantId"=${tenantId} FOR SHARE OF t`;
 await tx.$queryRaw`SELECT "id" FROM "TenantProfile" WHERE "tenantId"=${tenantId} FOR SHARE`;
 await tx.$queryRaw`SELECT "id" FROM "TenantBranding" WHERE "tenantId"=${tenantId} FOR SHARE`;
 await tx.$queryRaw`SELECT "id" FROM "TenantLegalSettings" WHERE "tenantId"=${tenantId} FOR SHARE`;
}
export async function assertNoSigningFreeze(tx:Prisma.TransactionClient,tenantId:string,bookingId:string){
 const contract=await tx.bookingContract.findFirst({where:{tenantId,bookingId,deletedAt:null},select:{id:true,documentRevision:true}});
 const request=contract?await tx.contractSigningRequest.findFirst({where:{tenantId,contractId:contract.id,OR:[{status:"SIGNED",contractRevision:contract.documentRevision},{status:"PENDING",expiresAt:{gt:new Date()}}]},select:{id:true}}):null;
 if(request)throw new AppError("Il documento è congelato per la firma. Revoca prima l’invito oppure conserva il contratto già sottoscritto.",409,"CONTRACT_DOCUMENT_FROZEN");
}

/** Compatibility is restricted to an authentic invitation created by the old format. */
export function signingSourceMatches(source:Awaited<ReturnType<typeof loadSigningSource>>,row:{sourceHash:string;requestHash:string;method:string;contractRevision:number;tenantId:string;actorUserId:string;recipient:string}){
 if(row.sourceHash===source.sourceHash)return true;
 return row.method==='EMAIL_OTP'&&row.contractRevision===0&&source.contract.documentRevision===0&&source.booking.priceAgreement===null&&
  (source.booking.finalTotal===null||source.booking.finalTotal===source.booking.expectedTotal)&&row.sourceHash===source.legacySourceHash&&
  row.requestHash===signingHash(stableSigningJson({tenantId:row.tenantId,bookingId:source.booking.id,userId:row.actorUserId,recipient:row.recipient}));
}
