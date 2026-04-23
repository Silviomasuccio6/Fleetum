import { Router } from "express";
import { RentalPricingController } from "../controllers/rental-pricing-controller.js";
import { requirePermissions } from "../middlewares/permissions.js";
import { asyncHandler } from "./async-handler.js";

export const rentalPricingRoutes = (controller: RentalPricingController) => {
  const router = Router();

  router.get("/lists", requirePermissions("vehicles:read"), asyncHandler(controller.listLists));
  router.post("/lists", requirePermissions("vehicles:write"), asyncHandler(controller.createList));
  router.patch("/lists/:id", requirePermissions("vehicles:write"), asyncHandler(controller.updateList));
  router.delete("/lists/:id", requirePermissions("vehicles:write"), asyncHandler(controller.removeList));

  router.get("/lists/:id/packages", requirePermissions("vehicles:read"), asyncHandler(controller.listPackages));
  router.post("/lists/:id/packages", requirePermissions("vehicles:write"), asyncHandler(controller.createPackage));
  router.patch("/packages/:id", requirePermissions("vehicles:write"), asyncHandler(controller.updatePackage));
  router.delete("/packages/:id", requirePermissions("vehicles:write"), asyncHandler(controller.removePackage));

  router.get("/extra-policies", requirePermissions("vehicles:read"), asyncHandler(controller.listExtraPolicies));
  router.post("/extra-policies", requirePermissions("vehicles:write"), asyncHandler(controller.createExtraPolicy));
  router.patch("/extra-policies/:id", requirePermissions("vehicles:write"), asyncHandler(controller.updateExtraPolicy));
  router.delete("/extra-policies/:id", requirePermissions("vehicles:write"), asyncHandler(controller.removeExtraPolicy));

  router.post("/quote/preview", requirePermissions("vehicles:write"), asyncHandler(controller.previewQuote));
  router.post("/quote/finalize", requirePermissions("vehicles:write"), asyncHandler(controller.finalizeQuote));

  return router;
};
