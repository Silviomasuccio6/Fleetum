import type { RequestHandler } from "express";
import { SiteAccessService } from "../../../application/services/site-access-service.js";
import { narrowSiteAccess, type SiteAccessScope } from "../../../domain/policies/site-access.js";
import { runWithSiteAccess } from "../../../infrastructure/auth/site-access-context.js";
import { AppError } from "../../../shared/errors/app-error.js";

const header = (value: unknown): string | undefined => {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !value.trim() || value.length > 128 || /[,\s]/.test(value)) {
    throw new AppError("Vista sede non valida", 400, "SITE_CONTEXT_INVALID");
  }
  return value;
};

// Installed only after tenant authentication and before every business router.
// Public capabilities, webhooks, authentication recovery and Platform stay separate.
export const requireSiteAccess: RequestHandler = async (req, res, next) => {
  try {
    if (!req.auth) throw new AppError("Sessione richiesta", 401, "UNAUTHORIZED");
    const selected = header(req.headers["x-fleetum-site"]);
    const revision = header(req.headers["x-fleetum-site-revision"]);
    const current = await new SiteAccessService().describe(req.auth.tenantId, req.auth.userId);
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("X-Fleetum-Site-Revision", current.revision);
    res.vary("X-Fleetum-Site");
    res.vary("X-Fleetum-Site-Revision");
    // Check before resolving an obsolete selection: the client must refresh its
    // authority rather than displaying an unrelated 404 under the old label.
    if (revision !== undefined && revision !== current.revision) {
      throw new AppError("La sede o le autorizzazioni sono cambiate. Aggiorna la vista.", 409, "SITE_CONTEXT_STALE");
    }
    let scope: SiteAccessScope = {
      tenantId: current.tenantId, canViewAllSites: current.canViewAllSites,
      allSites: current.canViewAllSites,
      siteIds: current.canViewAllSites ? [] : current.sites.map(site => site.id)
    };
    if (selected === "none") {
      if (scope.allSites || scope.siteIds.length) throw new AppError("Vista vuota non disponibile", 400, "SITE_CONTEXT_INVALID");
    } else if (selected !== undefined && selected !== "all") {
      if (!current.sites.some(site => site.id === selected)) throw new AppError("Sede non disponibile", 404, "NOT_FOUND");
      scope = narrowSiteAccess(scope, selected);
    }
    res.setHeader("X-Fleetum-Site-View", scope.allSites ? "all" : scope.siteIds[0] ?? "none");
    runWithSiteAccess(scope, next);
  } catch (error) {
    next(error);
  }
};
