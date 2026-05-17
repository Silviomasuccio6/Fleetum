import { Router } from "express";
import { PlatformAdminController } from "../controllers/platform-admin-controller.js";
import { requirePlatformAuth } from "../middlewares/platform-auth.js";
import { platformAuthRateLimit } from "../middlewares/platform-auth-rate-limit.js";
import { asyncHandler } from "./async-handler.js";

export const platformAdminRoutes = (controller: PlatformAdminController) => {
  const router = Router();

  router.post("/auth/login", platformAuthRateLimit, asyncHandler(controller.login));
  router.get("/tenants", requirePlatformAuth, asyncHandler(controller.tenants));
  router.get("/tenants/:id/profile", requirePlatformAuth, asyncHandler(controller.tenantProfile));
  router.get("/tenants/:id/onboarding-status", requirePlatformAuth, asyncHandler(controller.tenantOnboardingStatus));
  router.get("/users", requirePlatformAuth, asyncHandler(controller.users));
  router.get("/events/recent", requirePlatformAuth, asyncHandler(controller.recentEvents));
  router.get("/metrics/revenue", requirePlatformAuth, asyncHandler(controller.revenueMetrics));
  router.get("/metrics/revenue/export.csv", requirePlatformAuth, asyncHandler(controller.revenueCsv));
  router.patch("/tenants/:id/license", requirePlatformAuth, asyncHandler(controller.updateLicense));
  router.patch("/tenants/:id/status", requirePlatformAuth, asyncHandler(controller.updateTenantStatus));
  router.post("/tenants/:id/quick-action", requirePlatformAuth, asyncHandler(controller.quickAction));

  return router;
};
