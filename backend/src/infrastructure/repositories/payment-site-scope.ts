import { Prisma } from "@prisma/client";
import { prisma } from "../database/prisma/client.js";
import { siteAccessForTenant, runWithSiteAccess } from "../auth/site-access-context.js";
import { visibleBookingWhere } from "./resource-site-scope.js";
import { AppError } from "../../shared/errors/app-error.js";
import { resolveSiteAccess } from "../../domain/policies/site-access.js";
import { AuthorizationPolicyService } from "../../application/services/authorization-policy-service.js";

type Reader = Pick<Prisma.TransactionClient,"rentalBooking"|"rentalCustomerPaymentMethod"|"user"|"site">;
const notFound=()=>new AppError("Risorsa di pagamento non trovata",404,"RENTAL_PAYMENT_NOT_FOUND");
// Existing financial records retain their verified historical instrument even
// after card removal. This does not authorize selecting it for a new charge.
export const ownedHistoricalPaymentMethodWhere=(tenantId:string,customerId?:string):Prisma.RentalCustomerPaymentMethodWhereInput=>({
  tenantId,...(customerId?{rentalCustomerId:customerId}:{}),rentalCustomer:{is:{tenantId}},
  paymentProfile:{is:{tenantId,...(customerId?{rentalCustomerId:customerId}:{}),rentalCustomer:{is:{tenantId}}}}
});
export const visiblePaymentMethodWhere=(tenantId:string,customerId?:string):Prisma.RentalCustomerPaymentMethodWhereInput=>{
  const scope=siteAccessForTenant(tenantId);
  return {tenantId,deletedAt:null,...(customerId?{rentalCustomerId:customerId}:{}),
    rentalCustomer:{is:{tenantId,deletedAt:null}},
    paymentProfile:{is:{tenantId,deletedAt:null,...(customerId?{rentalCustomerId:customerId}:{}),rentalCustomer:{is:{tenantId}}}},
    OR:[...(!scope||scope.allSites?[{bookingId:null}]:[]),{booking:{is:{...visibleBookingWhere(tenantId),...(customerId?{customerId}:{})}}}]
  };
};
export const assertPaymentBookingVisible=async(tenantId:string,bookingId:string,reference?:{rentalCustomerId:string;vehicleId?:string|null},db:Reader=prisma)=>{
  if(!siteAccessForTenant(tenantId))return;
  const found=await db.rentalBooking.findFirst({where:{...visibleBookingWhere(tenantId),id:bookingId,
    ...(reference?{customerId:reference.rentalCustomerId,...(reference.vehicleId?{vehicleId:reference.vehicleId}:{})}:{})},select:{id:true}});
  if(!found)throw notFound();
};
export const assertPaymentMethodVisible=async(tenantId:string,method:{id:string;rentalCustomerId:string;stripeCustomerId:string},historical=false,db:Reader=prisma)=>{
  if(!siteAccessForTenant(tenantId))return;
  const where=historical?ownedHistoricalPaymentMethodWhere(tenantId,method.rentalCustomerId):visiblePaymentMethodWhere(tenantId,method.rentalCustomerId);
  if(!await db.rentalCustomerPaymentMethod.findFirst({where:{...where,id:method.id,
    paymentProfile:{is:{tenantId,rentalCustomerId:method.rentalCustomerId,stripeCustomerId:method.stripeCustomerId,...(!historical?{deletedAt:null}:{})}}},select:{id:true}}))throw notFound();
};
// A financial row follows its own booking, never the current site of a car.
// Equality against the authoritative booking also excludes copied corrupt
// customer/vehicle references before they enter a summary.
export const financialRowsWhere=async(tenantId:string,bookingId:string)=>{
  const booking=await prisma.rentalBooking.findFirst({where:{...visibleBookingWhere(tenantId),id:bookingId},select:{customerId:true,vehicleId:true}});
  if(!booking?.customerId)return {tenantId,bookingId,id:{in:[]}};
  return {tenantId,bookingId,rentalCustomerId:booking.customerId,
    OR:[{vehicleId:null},{vehicleId:booking.vehicleId}],
    booking:{is:visibleBookingWhere(tenantId)},rentalCustomer:{is:{tenantId}}
  };
};

export type PaymentSiteAuthorization={version:1;userId:string;allSites:boolean;siteIds:string[]};
export const capturePaymentSiteAuthorization=(tenantId:string,userId:string):PaymentSiteAuthorization|undefined=>{
  const scope=siteAccessForTenant(tenantId);return scope?{version:1,userId,allSites:scope.allSites,siteIds:[...scope.siteIds]}:undefined;
};
export const paymentNoticeAuthorizationReason=async(db:Reader,tenantId:string,bookingId:string,input:unknown):Promise<string|null>=>{
  if(!input||typeof input!=="object"||Array.isArray(input))return "AUTHORIZATION_INVALID";
  const value=input as Record<string,unknown>;
  if(value.version!==1||typeof value.userId!=="string"||!value.userId||typeof value.allSites!=="boolean"||!Array.isArray(value.siteIds)||value.siteIds.length>32||!value.siteIds.every(id=>typeof id==="string"&&id.length>0))return "AUTHORIZATION_INVALID";
  const user=await db.user.findFirst({where:{id:value.userId,tenantId,status:"ACTIVE",deletedAt:null},select:{tenantId:true,assignedSite:{select:{id:true,tenantId:true,isActive:true,deletedAt:true}},roles:{select:{role:{select:{key:true,permissions:{select:{permission:{select:{key:true}}}}}}}}}});
  if(!user)return "REQUESTER_NOT_ACTIVE";
  const roles=user.roles.map(({role})=>role.key),permissions=user.roles.flatMap(({role})=>role.permissions.map(({permission})=>permission.key));
  try{new AuthorizationPolicyService().assertPermissions({roles,permissions},["rental-payments:write"]);}catch{return "REQUESTER_PERMISSION_REVOKED";}
  const current=resolveSiteAccess({...user,roles}),snapshot=value as PaymentSiteAuthorization;
  if(snapshot.allSites?(!current.allSites||snapshot.siteIds.length>0):(!snapshot.siteIds.length||(!current.allSites&&snapshot.siteIds.some(id=>!current.siteIds.includes(id)))))return "REQUESTER_SITE_REVOKED";
  if(!snapshot.allSites&&(await db.site.count({where:{tenantId,id:{in:snapshot.siteIds},isActive:true,deletedAt:null}}))!==new Set(snapshot.siteIds).size)return "REQUESTED_SITE_UNAVAILABLE";
  return runWithSiteAccess({tenantId,allSites:snapshot.allSites,canViewAllSites:current.canViewAllSites,siteIds:snapshot.siteIds},async()=>
    await db.rentalBooking.findFirst({where:{...visibleBookingWhere(tenantId),id:bookingId},select:{id:true}})?null:"BOOKING_NOT_VISIBLE");
};
