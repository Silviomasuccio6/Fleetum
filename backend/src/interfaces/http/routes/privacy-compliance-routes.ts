import { Router } from "express";
import { PrivacyComplianceController } from "../controllers/privacy-compliance-controller.js";
import { requirePermissions } from "../middlewares/permissions.js";
import { asyncHandler } from "./async-handler.js";

export const privacyComplianceRoutes = (controller: PrivacyComplianceController) => {
  const router = Router();

  router.get(
    "/data-subjects/customers/:customerId/export",
    requirePermissions("vehicles:read"),
    asyncHandler(controller.exportCustomerData)
  );
  router.post(
    "/data-subjects/customers/:customerId/anonymize",
    requirePermissions("users:write"),
    asyncHandler(controller.anonymizeCustomer)
  );
  router.get(
    "/retention/preview",
    requirePermissions("users:read"),
    asyncHandler(controller.previewRetention)
  );
  router.post(
    "/retention/run",
    requirePermissions("users:write"),
    asyncHandler(controller.runRetention)
  );

  return router;
};
