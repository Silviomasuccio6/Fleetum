import { AppError } from "../../shared/errors/app-error.js";

export type SiteAccessScope = {
  tenantId: string;
  canViewAllSites: boolean;
  allSites: boolean;
  siteIds: string[];
};

export const resolveSiteAccess = (user: {
  tenantId: string;
  roles: string[];
  assignedSite?: { id: string; tenantId: string; isActive: boolean; deletedAt: Date | null } | null;
}): SiteAccessScope => {
  const all = user.roles.includes("ADMIN") || user.roles.includes("MANAGER");
  const site = user.assignedSite;
  return {
    tenantId: user.tenantId, canViewAllSites: all, allSites: all,
    siteIds: !all && site?.tenantId === user.tenantId && site.isActive && !site.deletedAt ? [site.id] : []
  };
};

export const assertSiteAccess = (scope: SiteAccessScope, resource: { tenantId: string; siteIds: Array<string | null | undefined> }) => {
  if (resource.tenantId !== scope.tenantId || (!scope.allSites && !resource.siteIds.some(id => id && scope.siteIds.includes(id)))) {
    throw new AppError("Risorsa non trovata", 404, "NOT_FOUND");
  }
};

export const narrowSiteAccess = (scope: SiteAccessScope, siteId: string): SiteAccessScope => {
  assertSiteAccess(scope, { tenantId: scope.tenantId, siteIds: [siteId] });
  return { ...scope, allSites: false, siteIds: [siteId] };
};

export const siteResourceWhere = (scope: SiteAccessScope) => ({
  tenantId: scope.tenantId, ...(!scope.allSites ? { siteId: { in: [...scope.siteIds] } } : {})
});

// A booking is visible to the responsible, pickup and return sites. These are
// persisted on the booking, independently of the vehicle's current location.
export const bookingSiteWhere = (scope: SiteAccessScope) => ({
  tenantId: scope.tenantId,
  ...(!scope.allSites ? { OR: [
    { siteId: { in: [...scope.siteIds] } },
    { pickupSiteId: { in: [...scope.siteIds] } },
    { returnSiteId: { in: [...scope.siteIds] } }
  ] } : {})
});
