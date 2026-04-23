import { Router } from "express";
import { RentalBookingsController } from "../controllers/rental-bookings-controller.js";
import { requirePermissions } from "../middlewares/permissions.js";
import { asyncHandler } from "./async-handler.js";

export const rentalCustomersRoutes = (controller: RentalBookingsController) => {
  const router = Router();

  router.get("/", requirePermissions("vehicles:read"), asyncHandler(controller.listCustomerRegistry));
  router.get("/:customerId", requirePermissions("vehicles:read"), asyncHandler(controller.getCustomerProfile));
  router.patch("/:customerId", requirePermissions("vehicles:write"), asyncHandler(controller.updateCustomer));
  router.get("/:customerId/contracts", requirePermissions("vehicles:read"), asyncHandler(controller.listCustomerContracts));
  router.get("/:customerId/bookings", requirePermissions("vehicles:read"), asyncHandler(controller.listCustomerBookings));

  return router;
};
