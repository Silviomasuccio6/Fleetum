import { Router } from "express";
import { PrivacyComplianceController } from "../controllers/privacy-compliance-controller.js";
import { requirePermissions } from "../middlewares/permissions.js";
import { asyncHandler } from "./async-handler.js";

export const gdprRoutes = (controller: PrivacyComplianceController) => {
  const router = Router();

  router.post(
    "/erasure-request",
    requirePermissions("users:write"),
    asyncHandler(controller.createErasureRequest)
  );
  router.get(
    "/data-export/:customerId",
    requirePermissions("vehicles:read"),
    asyncHandler(controller.exportCustomerData)
  );

  return router;
};
