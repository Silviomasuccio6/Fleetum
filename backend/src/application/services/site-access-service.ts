import { Prisma } from "@prisma/client";
import crypto from "node:crypto";
import { prisma } from "../../infrastructure/database/prisma/client.js";
import { AppError } from "../../shared/errors/app-error.js";
import { narrowSiteAccess, resolveSiteAccess } from "../../domain/policies/site-access.js";
import { assertCompanyResourceView } from "../../infrastructure/auth/company-resource-access.js";

export class SiteAccessService {
  async describe(tenantId: string, userId: string) {
    const user = await prisma.user.findFirst({
      where: {id:userId,tenantId,status:"ACTIVE",deletedAt:null,tenant:{is:{isActive:true,deletedAt:null}}},
      select:{updatedAt:true,roles:{select:{role:{select:{key:true,permissions:{select:{permission:{select:{key:true}}}}}}}},assignedSite:{select:{id:true,tenantId:true,name:true,isActive:true,deletedAt:true,updatedAt:true}}}
    });
    if(!user)throw new AppError("Utente o azienda non attivi",401,"UNAUTHORIZED");
    const roles=user.roles.map(r=>r.role.key).sort(),canViewAllSites=roles.includes("ADMIN")||roles.includes("MANAGER");
    const assigned=user.assignedSite?.tenantId===tenantId?user.assignedSite:null;
    const sites=canViewAllSites?await prisma.site.findMany({where:{tenantId,isActive:true,deletedAt:null},select:{id:true,name:true,updatedAt:true},orderBy:[{name:"asc"},{id:"asc"}]}):assigned?.isActive&&!assigned.deletedAt?[assigned]:[];
    const permissions=[...new Set(user.roles.flatMap(r=>r.role.permissions.map(p=>p.permission.key)))].sort();
    const revision=crypto.createHash("sha256").update(JSON.stringify({tenantId,userId,user:user.updatedAt,roles,permissions,assigned:assigned?{id:assigned.id,updatedAt:assigned.updatedAt}:null,sites:sites.map(s=>[s.id,s.updatedAt])})).digest("hex");
    return {tenantId,userId,revision,canViewAllSites,canAssignSites:roles.includes("ADMIN"),
      // The tenant business router resolves this authority on every request.
      enforced:true,
      assignedSite:assigned?{id:assigned.id,name:assigned.name,isActive:assigned.isActive&&!assigned.deletedAt}:null,
      sites:sites.map(s=>({id:s.id,name:s.name}))};
  }
  async resolveForUser(tenantId: string, userId: string) {
    const user = await prisma.user.findFirst({
      where: { id: userId, tenantId, deletedAt: null, status: "ACTIVE" },
      select: { tenantId: true, roles: { select: { role: { select: { key: true } } } },
        assignedSite: { select: { id: true, tenantId: true, isActive: true, deletedAt: true } } }
    });
    if (!user) throw new AppError("Utente non attivo", 401, "UNAUTHORIZED");
    return resolveSiteAccess({ ...user, roles: user.roles.map(r => r.role.key) });
  }

  async resolveSelectedScope(tenantId: string, userId: string, selectedSiteId?: string) {
    const scope = await this.resolveForUser(tenantId, userId);
    // Missing/all is a manager preference, never an operator permission grant.
    if (selectedSiteId === undefined || selectedSiteId === "all") return scope;
    if (!selectedSiteId.trim()) throw new AppError("Sede non valida", 400, "INVALID_SITE");
    const site = await prisma.site.findFirst({
      where: { id: selectedSiteId, tenantId, isActive: true, deletedAt: null }, select: { id: true }
    });
    if (!site) throw new AppError("Sede non disponibile", 404, "NOT_FOUND");
    return narrowSiteAccess(scope, site.id);
  }

  async assign(input: { tenantId: string; actorUserId: string; userId: string; siteId: string | null }) {
    assertCompanyResourceView(input.tenantId);
    return prisma.$transaction(async tx => {
      // Use the same row locks as account/role changes, in a deterministic order.
      const ids = [...new Set([input.actorUserId, input.userId])].sort();
      await tx.$queryRaw`SELECT "id" FROM "User" WHERE "tenantId" = ${input.tenantId}
        AND "id" IN (${Prisma.join(ids)}) ORDER BY "id" FOR UPDATE`;
      const actor = await tx.user.findFirst({ where: { id: input.actorUserId, tenantId: input.tenantId, deletedAt: null, status: "ACTIVE" },
        select: { roles: { select: { role: { select: { key: true } } } } } });
      if (!actor?.roles.some(r => r.role.key === "ADMIN")) throw new AppError("Assegnazione sedi riservata agli amministratori", 403, "FORBIDDEN");
      const user = await tx.user.findFirst({ where: { id: input.userId, tenantId: input.tenantId, deletedAt: null }, select: { id: true, assignedSiteId: true } });
      if (!user) throw new AppError("Utente non trovato", 404, "NOT_FOUND");
      if (input.siteId !== null) {
        await tx.$queryRaw`SELECT "id" FROM "Site" WHERE "id" = ${input.siteId} AND "tenantId" = ${input.tenantId} FOR SHARE`;
        const site = await tx.site.findFirst({ where: { id: input.siteId, tenantId: input.tenantId, isActive: true, deletedAt: null }, select: { id: true } });
        if (!site) throw new AppError("Sede non disponibile", 404, "NOT_FOUND");
      }
      await tx.user.update({ where: { id: user.id }, data: { assignedSiteId: input.siteId } });
      await tx.auditLog.create({ data: { tenantId: input.tenantId, userId: input.actorUserId,
        action: "USER_SITE_ASSIGNED", resource: "user", resourceId: user.id,
        details: { previousSiteId: user.assignedSiteId, siteId: input.siteId } } });
      return { userId: user.id, assignedSiteId: input.siteId };
    });
  }
}
