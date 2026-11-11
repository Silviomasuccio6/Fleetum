import { Prisma } from "@prisma/client";
import { AuthorizationPolicyService } from "../../application/services/authorization-policy-service.js";
import { resolveSiteAccess, type SiteAccessScope } from "../../domain/policies/site-access.js";
import { runWithSiteAccess } from "../auth/site-access-context.js";
import { visibleBookingWhere } from "../repositories/resource-site-scope.js";

export type ContractSiteAuthorization = { version: 1; userId: string; allSites: boolean; siteIds: string[] };
export const captureContractSiteAuthorization = (scope: SiteAccessScope | undefined, userId?: string): ContractSiteAuthorization | undefined =>
  scope && userId ? { version:1,userId,allSites:scope.allSites,siteIds:[...scope.siteIds] } : undefined;

export const contractSiteAuthorizationReason = async (
  tx: Prisma.TransactionClient, tenantId: string, bookingId: string, contractId: string, actorUserId: unknown, value: unknown
): Promise<string | null> => {
  if (!value || typeof value!=="object" || Array.isArray(value)) return "AUTHORIZATION_INVALID";
  const input=value as Record<string,unknown>;
  if (input.version!==1 || typeof input.userId!=="string" || !input.userId || input.userId!==actorUserId ||
      typeof input.allSites!=="boolean" || !Array.isArray(input.siteIds) || input.siteIds.length>32 ||
      !input.siteIds.every(id=>typeof id==="string" && id.length>0)) return "AUTHORIZATION_INVALID";
  const user=await tx.user.findFirst({where:{id:input.userId,tenantId,deletedAt:null,status:"ACTIVE"},select:{
    tenantId:true,assignedSite:{select:{id:true,tenantId:true,isActive:true,deletedAt:true}},
    roles:{select:{role:{select:{key:true,permissions:{select:{permission:{select:{key:true}}}}}}}}
  }});
  if (!user) return "REQUESTER_NOT_ACTIVE";
  const roles=user.roles.map(({role})=>role.key);
  const permissions=user.roles.flatMap(({role})=>role.permissions.map(({permission})=>permission.key));
  try {new AuthorizationPolicyService().assertPermissions({roles,permissions},["vehicles:write"]);}
  catch {return "REQUESTER_PERMISSION_REVOKED";}
  const current=resolveSiteAccess({...user,roles});
  const requested=input as ContractSiteAuthorization;
  if (requested.allSites && requested.siteIds.length) return "AUTHORIZATION_INVALID";
  if (!requested.allSites) {
    if (requested.siteIds.length) await tx.$queryRaw`SELECT "id" FROM "Site" WHERE "tenantId"=${tenantId}
      AND "id" IN (${Prisma.join(requested.siteIds)}) ORDER BY "id" FOR SHARE`;
    const activeSites=await tx.site.count({where:{tenantId,id:{in:requested.siteIds},isActive:true,deletedAt:null}});
    if (activeSites!==new Set(requested.siteIds).size) return "REQUESTED_SITE_UNAVAILABLE";
  }
  if ((requested.allSites && !current.allSites) || (!requested.allSites && (!requested.siteIds.length ||
      (!current.allSites && requested.siteIds.some(id=>!current.siteIds.includes(id)))))) return "REQUESTER_SITE_REVOKED";
  // Both the original selected view and the current authority must allow the
  // practice. Its sites are persisted and do not follow a vehicle transfer.
  const scope={tenantId,canViewAllSites:current.canViewAllSites,allSites:requested.allSites,siteIds:requested.siteIds};
  const contract=await runWithSiteAccess(scope,()=>tx.bookingContract.findFirst({where:{
    id:contractId,tenantId,bookingId,deletedAt:null,booking:{is:{...visibleBookingWhere(tenantId),deletedAt:null}}
  },select:{id:true}}));
  return contract ? null : "CONTRACT_NOT_VISIBLE";
};

export class ContractDispatchBlocked extends Error {
  constructor(reason: string) {super(`CONTRACT_DISPATCH_BLOCKED:${reason}`);}
}
