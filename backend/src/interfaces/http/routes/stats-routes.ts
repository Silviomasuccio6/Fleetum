import { RequestHandler, Router } from "express";
import { FeatureKey } from "../../../application/services/feature-entitlements-service.js";
import { StatsController } from "../controllers/stats-controller.js";
import { requirePermissions } from "../middlewares/permissions.js";
import { asyncHandler } from "./async-handler.js";

export const statsRoutes = (controller: StatsController, requireFeature: (feature: FeatureKey) => RequestHandler) => {
  const router = Router();

  router.get("/dashboard", requireFeature("reports_basic"), requirePermissions("stats:read"), asyncHandler(controller.dashboard));
  router.get("/analytics", requireFeature("reports_advanced"), requirePermissions("stats:read"), asyncHandler(controller.analytics));
  router.get("/analytics/export.csv", requireFeature("export_csv"), requirePermissions("stats:read", "reports:export"), asyncHandler(controller.analyticsCsv));
  router.get("/analytics/export.xlsx", requireFeature("export_csv"), requirePermissions("stats:read", "reports:export"), asyncHandler(controller.analyticsXlsx));
  router.get("/vehicles/profitability", requireFeature("reports_advanced"), requirePermissions("stats:read", "vehicles:read", "vehicle:economics:read"), asyncHandler(controller.vehicleProfitability));
  router.get("/vehicles/profitability/export.:format", requireFeature("export_csv"), requirePermissions("stats:read", "vehicles:read", "vehicle:economics:read", "reports:export"), asyncHandler(controller.vehicleProfitabilityExport));
  router.get("/vehicles/:vehicleId/profitability", requireFeature("reports_advanced"), requirePermissions("stats:read", "vehicles:read", "vehicle:economics:read"), asyncHandler(controller.vehicleProfitabilityById));
  router.get("/workshops/health", requireFeature("reports_basic"), requirePermissions("stats:read"), asyncHandler(controller.workshopsHealth));
  router.get("/workshops/capacity", requireFeature("reports_advanced"), requirePermissions("stats:read"), asyncHandler(controller.workshopsCapacity));
  router.get("/team/performance", requireFeature("reports_advanced"), requirePermissions("stats:read"), asyncHandler(controller.teamPerformance));
  router.get("/ai/suggestions", requireFeature("security_insights"), requirePermissions("stats:read"), asyncHandler(controller.aiSuggestions));

  return router;
};
