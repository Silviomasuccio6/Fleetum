import { Router } from "express";
import { PrivacyComplianceController } from "../controllers/privacy-compliance-controller.js";
import { requirePermissions } from "../middlewares/permissions.js";
import { asyncHandler } from "./async-handler.js";

export const privacyComplianceRoutes = (controller: PrivacyComplianceController) => {
  const router = Router();

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
