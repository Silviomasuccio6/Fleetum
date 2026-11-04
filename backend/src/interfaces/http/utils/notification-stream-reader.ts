import type { Request, Response } from "express";
import { AuthorizationPolicyService } from "../../../application/services/authorization-policy-service.js";
import { LicensePolicyService } from "../../../application/services/license-policy-service.js";
import type { NotificationsService } from "../../../application/services/notifications-service.js";
import { SiteAccessService } from "../../../application/services/site-access-service.js";
import { currentSiteAccess, runWithSiteAccess } from "../../../infrastructure/auth/site-access-context.js";
import { PrismaAuditLogRepository } from "../../../infrastructure/repositories/prisma-audit-log-repository.js";
import { AppError } from "../../../shared/errors/app-error.js";
import { requireAuth } from "../middlewares/auth.js";

const policy = new AuthorizationPolicyService();
const licenses = new LicensePolicyService(new PrismaAuditLogRepository());
const sites = new SiteAccessService();

export const notificationStreamReader = (req: Request, res: Response, service: NotificationsService) => {
  const initialAuth = req.auth!;
  const initialScope = currentSiteAccess();
  // Preserve a manager's chosen branch; never widen an open stream after a
  // privilege change. No partial E02 activation when the context is absent.
  const selectedSite = initialScope?.canViewAllSites && !initialScope.allSites ? initialScope.siteIds[0] : undefined;
  const fingerprint = (auth: typeof initialAuth, scope: typeof initialScope) => JSON.stringify({
    tenantId: auth.tenantId, userId: auth.userId, sessionId: auth.sessionId,
    roles: [...auth.roles].sort(), permissions: [...auth.permissions].sort(),
    scope: scope && { ...scope, siteIds: [...scope.siteIds].sort() }
  });
  const expected = fingerprint(initialAuth, initialScope);
  const authorize = async () => {
    await new Promise<void>((resolve,reject) => {
      void requireAuth(req,res,error => error ? reject(error) : resolve());
    });
    const auth = req.auth!;
    policy.assertPermissions(auth,["dashboard:read"]);
    const access = await licenses.evaluateAccess(auth.tenantId);
    if (access.blocked) throw new AppError("Accesso notifiche non disponibile",403,"FORBIDDEN");
    const scope = initialScope ? await sites.resolveSelectedScope(auth.tenantId,auth.userId,selectedSite) : undefined;
    if (fingerprint(auth,scope) !== expected) throw new AppError("Autorizzazioni modificate",403,"FORBIDDEN");
    return scope;
  };
  return async () => {
    const scope = await authorize();
    const read = () => service.inbox(initialAuth.tenantId);
    const data = await (scope ? runWithSiteAccess(scope,read) : read());
    // Discard a result if the session, permissions, site or license changed
    // while the query was in flight. Already delivered data cannot be recalled.
    await authorize();
    return data;
  };
};
