import { Router } from "express";
import { BillingController } from "../controllers/billing-controller.js";
import { asyncHandler } from "./async-handler.js";

export const billingRoutes = (controller: BillingController) => {
  const router = Router();
  router.post("/checkout-session", asyncHandler(controller.createCheckoutSession));
  router.get("/local-complete", asyncHandler(controller.localComplete));
  router.get("/invoices", asyncHandler(controller.invoices));
  router.get("/invoices/:invoiceId", asyncHandler(controller.invoice));
  router.get("/invoices/:invoiceId/pdf", asyncHandler(controller.invoicePdf));
  return router;
};

export const billingWebhookRoutes = (controller: BillingController) => {
  const router = Router();
  router.post("/webhook", asyncHandler(controller.webhook));
  return router;
};
