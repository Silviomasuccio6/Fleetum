import { Router } from "express";
import { uploadContractLogo } from "../../../infrastructure/storage/multer.js";
import { TenantProfileController } from "../controllers/tenant-profile-controller.js";
import { requirePermissions } from "../middlewares/permissions.js";
import { asyncHandler } from "./async-handler.js";

export const tenantProfileRoutes = (controller: TenantProfileController) => {
  const router = Router();

  router.get("/profile", requirePermissions("users:read"), asyncHandler(controller.getProfile));
  router.get("/profile/completeness", requirePermissions("users:read"), asyncHandler(controller.completeness));
  router.patch("/profile", requirePermissions("users:write"), asyncHandler(controller.updateProfile));
  router.post("/branding/logo", requirePermissions("users:write"), uploadContractLogo.single("file"), asyncHandler(controller.uploadLogo));
  router.delete("/branding/logo", requirePermissions("users:write"), asyncHandler(controller.removeLogo));

  return router;
};
