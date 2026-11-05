import {siteAccessForTenant} from "./site-access-context.js";
import {AppError} from "../../shared/errors/app-error.js";

// These guards add the company/branch boundary to existing permission checks.
// Absence of E02 context preserves internal callers and the staged rollout;
// it must not be treated as proof that general authentication is already wired.
export const assertCompanyResourceView = (tenantId: string) => {
  const scope = siteAccessForTenant(tenantId);
  if (scope && (!scope.canViewAllSites || !scope.allSites)) {
    throw new AppError("Questa operazione aziendale richiede la vista tutte le sedi", 403, "FORBIDDEN");
  }
  return scope;
};

export const canReadSharedCompanyResources = (tenantId: string) => {
  const scope = siteAccessForTenant(tenantId);
  return !scope || scope.allSites || scope.siteIds.length > 0;
};

export const assertSharedCompanyResourceView = (tenantId: string) => {
  if (!canReadSharedCompanyResources(tenantId)) {
    throw new AppError("Assegna una sede valida per accedere alle risorse condivise", 403, "FORBIDDEN");
  }
};
