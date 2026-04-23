import { Router } from "express";
import { uploadContractLogo } from "../../../infrastructure/storage/multer.js";
import { RentalBookingsController } from "../controllers/rental-bookings-controller.js";
import { requirePermissions } from "../middlewares/permissions.js";
import { asyncHandler } from "./async-handler.js";

export const contractTemplatesRoutes = (controller: RentalBookingsController) => {
  const router = Router();

  router.get("/default", requirePermissions("vehicles:read"), asyncHandler(controller.getDefaultContractTemplate));
  router.patch("/default", requirePermissions("vehicles:write"), asyncHandler(controller.updateDefaultContractTemplate));
  router.post(
    "/default/logo",
    requirePermissions("vehicles:write"),
    uploadContractLogo.single("file"),
    asyncHandler(controller.uploadDefaultContractLogo)
  );
  router.get("/default/logo/file", requirePermissions("vehicles:read"), asyncHandler(controller.getDefaultContractLogoFile));
  router.delete("/default/logo", requirePermissions("vehicles:write"), asyncHandler(controller.removeDefaultContractLogo));
  router.post("/preview-render", requirePermissions("vehicles:read"), asyncHandler(controller.previewContractTemplate));

  return router;
};
