import { Router } from "express";
import { PlatformAdminController } from "../controllers/platform-admin-controller.js";
import { requirePlatformAuth } from "../middlewares/platform-auth.js";
import { platformAuthRateLimit } from "../middlewares/platform-auth-rate-limit.js";
import { asyncHandler } from "./async-handler.js";

export const platformAdminRoutes = (controller: PlatformAdminController) => {
  const router = Router();

  router.post("/auth/login", platformAuthRateLimit, asyncHandler(controller.login));
  router.post("/auth/password-reset/request", asyncHandler(controller.requestPasswordReset));
  router.post("/auth/password-reset/verify", asyncHandler(controller.verifyPasswordReset));
  router.post("/auth/password-reset/confirm", asyncHandler(controller.confirmPasswordReset));
  router.get("/security/trusted-devices", requirePlatformAuth, asyncHandler(controller.trustedDevices));
  router.delete("/security/trusted-devices/:id", requirePlatformAuth, asyncHandler(controller.revokeTrustedDevice));
  router.get("/overview", requirePlatformAuth, asyncHandler(controller.overview));
  router.get("/analytics/website", requirePlatformAuth, asyncHandler(controller.websiteAnalytics));
  router.get("/demo-leads", requirePlatformAuth, asyncHandler(controller.demoLeads));
  router.patch("/demo-leads/:id", requirePlatformAuth, asyncHandler(controller.updateDemoLead));
  router.get("/system-health", requirePlatformAuth, asyncHandler(controller.systemHealth));
  router.get("/security", requirePlatformAuth, asyncHandler(controller.securityOverview));
  router.get("/tenants", requirePlatformAuth, asyncHandler(controller.tenants));
  router.get("/invoices", requirePlatformAuth, asyncHandler(controller.invoices));
  router.get("/tenants/:tenantId/invoices", requirePlatformAuth, asyncHandler(controller.tenantInvoices));
  router.post("/tenants/:tenantId/invoices/generate", requirePlatformAuth, asyncHandler(controller.generateInvoice));
  router.get("/invoices/:invoiceId", requirePlatformAuth, asyncHandler(controller.invoice));
  router.get("/invoices/:invoiceId/pdf", requirePlatformAuth, asyncHandler(controller.invoicePdf));
  router.post("/invoices/:invoiceId/send-email", requirePlatformAuth, asyncHandler(controller.sendInvoiceEmail));
  router.patch("/invoices/:invoiceId/status", requirePlatformAuth, asyncHandler(controller.updateInvoiceStatus));
  router.get("/tenants/:id/profile", requirePlatformAuth, asyncHandler(controller.tenantProfile));
  router.get("/tenants/:id/onboarding-status", requirePlatformAuth, asyncHandler(controller.tenantOnboardingStatus));
  router.get("/users", requirePlatformAuth, asyncHandler(controller.users));
  router.get("/events/recent", requirePlatformAuth, asyncHandler(controller.recentEvents));
  router.get("/metrics/revenue", requirePlatformAuth, asyncHandler(controller.revenueMetrics));
  router.get("/metrics/revenue/export.csv", requirePlatformAuth, asyncHandler(controller.revenueCsv));
  router.get("/metrics/dashboard-live", requirePlatformAuth, asyncHandler(controller.dashboardLiveMetrics));
  router.patch("/tenants/:id/license", requirePlatformAuth, asyncHandler(controller.updateLicense));
  router.patch("/tenants/:id/status", requirePlatformAuth, asyncHandler(controller.updateTenantStatus));
  router.post("/tenants/:id/quick-action", requirePlatformAuth, asyncHandler(controller.quickAction));

  return router;
};
