import { Router } from "express";
import { PrivacyComplianceController } from "../controllers/privacy-compliance-controller.js";
import { requirePermissions } from "../middlewares/permissions.js";
import { asyncHandler } from "./async-handler.js";
import { siteAccessForTenant } from "../../../infrastructure/auth/site-access-context.js";
import { AppError } from "../../../shared/errors/app-error.js";

export const privacyComplianceRoutes = (controller: PrivacyComplianceController) => {
  const router = Router();
  // These are complete company records and retention/erasure operations, not
  // partial branch exports. Keep the dedicated permissions on every route.
  router.use((req,res,next)=>{
    const scope=req.auth&&siteAccessForTenant(req.auth.tenantId);
    if(scope&&(!scope.canViewAllSites||!scope.allSites))throw new AppError("Operazione riservata alla vista tutte le sedi",403,"FORBIDDEN");
    res.setHeader("Cache-Control","private, no-store");next();
  });

  router.get(
    "/data-subjects/customers/:customerId/export",
    requirePermissions("privacy:export"),
    asyncHandler(controller.exportCustomerData)
  );
  router.post(
    "/data-subjects/customers/:customerId/anonymize",
    requirePermissions("privacy:manage"),
    asyncHandler(controller.anonymizeCustomer)
  );
  router.get(
    "/retention/preview",
    requirePermissions("privacy:manage"),
    asyncHandler(controller.previewRetention)
  );
  router.post(
    "/retention/run",
    requirePermissions("privacy:manage"),
    asyncHandler(controller.runRetention)
  );

  return router;
};
