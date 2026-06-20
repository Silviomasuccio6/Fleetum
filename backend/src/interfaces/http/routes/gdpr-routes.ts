import { Router } from "express";
import { PrivacyComplianceController } from "../controllers/privacy-compliance-controller.js";
import { requirePermissions } from "../middlewares/permissions.js";
import { asyncHandler } from "./async-handler.js";

export const gdprRoutes = (controller: PrivacyComplianceController) => {
  const router = Router();

  router.post(
    "/erasure-request",
    requirePermissions("privacy:manage"),
    asyncHandler(controller.createErasureRequest)
  );
  router.get(
    "/data-export/:customerId",
    requirePermissions("privacy:export"),
    asyncHandler(controller.exportCustomerData)
  );

  return router;
};
