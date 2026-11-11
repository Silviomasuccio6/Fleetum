import { AsyncLocalStorage } from "node:async_hooks";
import { AppError } from "../../shared/errors/app-error.js";
import { bookingSiteWhere, siteResourceWhere, type SiteAccessScope } from "../../domain/policies/site-access.js";

const storage = new AsyncLocalStorage<SiteAccessScope>();
export const runWithSiteAccess = <T>(scope: SiteAccessScope, action: () => T): T => storage.run(scope, action);
export const currentSiteAccess = () => storage.getStore();
// Verified provider events reconcile company financial state independently of
// any ambient operator view. This is not an HTTP authorization entry point.
export const runWithoutSiteAccess = <T>(action: () => T): T => storage.exit(action);
export const siteAccessForTenant = (tenantId: string) => {
  const scope = storage.getStore();
  if (scope && scope.tenantId !== tenantId) throw new AppError("Accesso non consentito", 403, "FORBIDDEN");
  return scope;
};
export const currentSiteWhere = (tenantId: string) => {
  const scope = siteAccessForTenant(tenantId);
  return scope ? siteResourceWhere(scope) : { tenantId };
};
export const currentBookingSiteWhere = (tenantId: string) => {
  const scope = siteAccessForTenant(tenantId);
  return scope ? bookingSiteWhere(scope) : { tenantId };
};
