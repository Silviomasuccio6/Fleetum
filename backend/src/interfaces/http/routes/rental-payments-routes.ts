import { Router } from "express";
import { RentalPaymentsController } from "../controllers/rental-payments-controller.js";
import { requirePermissions } from "../middlewares/permissions.js";
import { asyncHandler } from "./async-handler.js";

export const rentalPaymentsRoutes = (controller: RentalPaymentsController) => {
  const router = Router();

  router.get("/bookings/:bookingId/summary", requirePermissions("rental-payments:read"), asyncHandler(controller.summary));
  router.post("/bookings/:bookingId/setup-session", requirePermissions("rental-payments:write"), asyncHandler(controller.setupSession));
  router.get("/customers/:customerId/payment-methods", requirePermissions("rental-payments:read"), asyncHandler(controller.paymentMethods));

  router.post("/bookings/:bookingId/deposits", requirePermissions("rental-payments:charge"), asyncHandler(controller.createDeposit));
  router.post("/deposits/:depositId/capture", requirePermissions("rental-payments:charge"), asyncHandler(controller.captureDeposit));
  router.post("/deposits/:depositId/release", requirePermissions("rental-payments:charge"), asyncHandler(controller.releaseDeposit));

  router.post("/bookings/:bookingId/extra-charges", requirePermissions("rental-payments:write"), asyncHandler(controller.createExtraCharge));
  router.post("/extra-charges/:extraChargeId/approve", requirePermissions("rental-payments:charge"), asyncHandler(controller.approveExtraCharge));
  router.post("/extra-charges/:extraChargeId/notify", requirePermissions("rental-payments:write"), asyncHandler(controller.notifyExtraCharge));
  router.post("/extra-charges/:extraChargeId/charge", requirePermissions("rental-payments:charge"), asyncHandler(controller.chargeExtraCharge));
  router.post("/extra-charges/:extraChargeId/cancel", requirePermissions("rental-payments:write"), asyncHandler(controller.cancelExtraCharge));

  return router;
};
