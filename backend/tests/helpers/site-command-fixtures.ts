import {prisma} from "../../src/infrastructure/database/prisma/client.js";
import {runWithSiteAccess,currentSiteAccess} from "../../src/infrastructure/auth/site-access-context.js";
export const companySiteScope=(tenantId:string)=>({tenantId,allSites:true,canViewAllSites:true,siteIds:[]});
export const commandAuthorization=(userId:string)=>({version:1,userId,allSites:true,siteIds:[]});
export const reportAuthorization=(tenantId:string)=>({version:1,kind:"company",userId:tenantId+"-report-actor"});
export async function grantSyntheticAdmin(userId:string){
 const role=await prisma.role.upsert({where:{key:"ADMIN"},create:{key:"ADMIN",name:"Synthetic admin"},update:{}});
 await prisma.userRole.upsert({where:{userId_roleId:{userId,roleId:role.id}},create:{userId,roleId:role.id},update:{}});
}
export async function createReportActor(tenantId:string){
 const id=reportAuthorization(tenantId).userId;
 await prisma.user.upsert({where:{id},create:{id,tenantId,email:"synthetic-report-actor@example.invalid",passwordHash:"synthetic-only",firstName:"Synthetic",lastName:"Report actor"},update:{}});
 await grantSyntheticAdmin(id);return reportAuthorization(tenantId);
}
export const withCompanyScope=<T>(tenantId:string,work:()=>T)=>currentSiteAccess()?work():runWithSiteAccess(companySiteScope(tenantId),work);
export async function removeSyntheticActorRoles(tenantIds:string[]){await prisma.userRole.deleteMany({where:{user:{tenantId:{in:tenantIds}}}});}
export async function removeReportActors(tenantIds:string[]){await removeSyntheticActorRoles(tenantIds);await prisma.user.deleteMany({where:{tenantId:{in:tenantIds}}});}
