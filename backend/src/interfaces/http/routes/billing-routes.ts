import { Router } from "express";
import { BillingController } from "../controllers/billing-controller.js";
import { requirePermissions } from "../middlewares/permissions.js";
import { asyncHandler } from "./async-handler.js";

export const billingRoutes = (controller: BillingController) => {
  const router = Router();
  router.post("/checkout-session", requirePermissions("billing:manage"), asyncHandler(controller.createCheckoutSession));
  router.post("/payment-method-session", requirePermissions("billing:manage"), asyncHandler(controller.createPaymentMethodSession));
  router.post("/customer-portal-session", requirePermissions("billing:manage"), asyncHandler(controller.createCustomerPortalSession));
  router.get("/local-complete", requirePermissions("billing:manage"), asyncHandler(controller.localComplete));
  router.get("/invoices", requirePermissions("billing:read"), asyncHandler(controller.invoices));
  router.get("/invoices/:invoiceId", requirePermissions("billing:read"), asyncHandler(controller.invoice));
  router.get("/invoices/:invoiceId/pdf", requirePermissions("billing:read"), asyncHandler(controller.invoicePdf));
  return router;
};

export const billingWebhookRoutes = (controller: BillingController) => {
  const router = Router();
  router.post("/webhook", asyncHandler(controller.webhook));
  return router;
};
