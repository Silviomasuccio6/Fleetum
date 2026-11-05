import { Prisma } from "@prisma/client";
import { siteAccessForTenant } from "../auth/site-access-context.js";
import { visibleVehicleWhere, visibleBookingWhere, assertVisibleSite } from "./resource-site-scope.js";
import { prisma } from "../database/prisma/client.js";
import { ownedVehicleWhere, lockOwnedVehicle } from "./vehicle-tenant-scope.js";
import { AppError } from "../../shared/errors/app-error.js";

export const visiblePriceListWhere=(tenantId:string):Prisma.RentalPriceListWhereInput=>{
  const scope=siteAccessForTenant(tenantId);
  const allowed:Prisma.RentalPriceListWhereInput[]=scope?.siteIds.length?[
    {scope:{in:["GLOBAL","VEHICLE_CATEGORY"]},siteId:null,vehicleId:null},
    {scope:"SITE",siteId:{in:scope.siteIds},vehicleId:null},
    {scope:"VEHICLE",siteId:null,vehicle:{is:visibleVehicleWhere(tenantId,true)}}
  ]:[{id:{in:[]}}];
  return {tenantId,AND:[
    {OR:[{siteId:null},{site:{is:{tenantId}}}]},
    {OR:[{vehicleId:null},{vehicle:{is:ownedVehicleWhere(tenantId,true)}}]},
    ...(scope&&!scope.allSites?[{OR:allowed}]:[])
  ]};
};
export const assertPricingWriteScope=(tenantId:string,list:{scope:string;siteId?:string|null})=>{
  const scope=siteAccessForTenant(tenantId);if(!scope)return;
  if(list.scope==="GLOBAL"||list.scope==="VEHICLE_CATEGORY"){
    if(!scope.canViewAllSites||!scope.allSites)throw new AppError("Modifica listini aziendali riservata alla vista tutte le sedi",403,"FORBIDDEN");
  }else if(list.scope==="SITE"&&list.siteId)assertVisibleSite(tenantId,list.siteId);
};
export const lockWritablePriceList=async(tx:Prisma.TransactionClient,tenantId:string,id:string)=>{
  const initial=await tx.rentalPriceList.findFirst({where:{...visiblePriceListWhere(tenantId),id,deletedAt:null}});
  if(!initial)throw new AppError("Listino non trovato",404,"RENTAL_PRICE_LIST_NOT_FOUND");
  // Match the existing Vehicle -> PriceList write order, then recheck the
  // parent under lock before changing children or their default flags.
  if(initial.vehicleId)await lockOwnedVehicle(tx,tenantId,initial.vehicleId,true);
  await tx.$queryRaw`SELECT "id" FROM "RentalPriceList" WHERE "id"=${id} AND "tenantId"=${tenantId} FOR UPDATE`;
  const list=await tx.rentalPriceList.findFirst({where:{...visiblePriceListWhere(tenantId),id,deletedAt:null}});
  if(!list)throw new AppError("Listino non trovato",404,"RENTAL_PRICE_LIST_NOT_FOUND");
  if(list.vehicleId!==initial.vehicleId)throw new AppError("Listino modificato, riprova",409,"RENTAL_PRICE_LIST_CHANGED");
  assertPricingWriteScope(tenantId,list);return list;
};

export const visiblePricingCounts=async(tenantId:string,listIds:string[])=>{
  if(!listIds.length)return new Map<string,{packages:number;extraKmPolicies:number;bookingSnapshots:number}>();
  const [packages,policies,snapshots]=await Promise.all([
    prisma.rentalPricePackage.groupBy({by:["priceListId"],where:{tenantId,priceListId:{in:listIds},deletedAt:null},_count:true}),
    prisma.rentalExtraKmPolicy.findMany({where:{tenantId,priceListId:{in:listIds},deletedAt:null},select:{priceListId:true,packageId:true,package:{select:{tenantId:true,priceListId:true,deletedAt:true}}}}),
    prisma.rentalBookingPricingSnapshot.groupBy({by:["priceListId"],where:{tenantId,priceListId:{in:listIds},booking:{is:visibleBookingWhere(tenantId)}},_count:true})
  ]);
  return new Map(listIds.map(id=>[id,{
    packages:packages.find(row=>row.priceListId===id)?._count??0,
    extraKmPolicies:policies.filter(row=>row.priceListId===id&&(!row.packageId||(row.package?.tenantId===tenantId&&row.package.priceListId===id&&!row.package.deletedAt))).length,
    bookingSnapshots:snapshots.find(row=>row.priceListId===id)?._count??0
  }]));
};
