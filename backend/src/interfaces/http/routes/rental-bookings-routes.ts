import { Router } from "express";
import { uploadRentalCustomerAttachments } from "../../../infrastructure/storage/multer.js";
import { RentalBookingsController } from "../controllers/rental-bookings-controller.js";
import { requirePermissions } from "../middlewares/permissions.js";
import { asyncHandler } from "./async-handler.js";

export const rentalBookingsRoutes = (controller: RentalBookingsController) => {
  const router = Router();

  router.get("/", requirePermissions("vehicles:read"), asyncHandler(controller.list));
  router.get("/contracts", requirePermissions("vehicles:read"), asyncHandler(controller.listContractsMonitoring));
  router.get("/suggest/vehicles", requirePermissions("vehicles:read"), asyncHandler(controller.suggestVehicles));
  router.get("/suggest/customers", requirePermissions("vehicles:read"), asyncHandler(controller.suggestCustomers));
  router.get("/availability/day", requirePermissions("vehicles:read"), asyncHandler(controller.dayAvailability));
  router.get("/availability/month", requirePermissions("vehicles:read"), asyncHandler(controller.monthAvailability));
  router.get("/customers", requirePermissions("vehicles:read"), asyncHandler(controller.listCustomers));
  router.post(
    "/customers/parse-document",
    requirePermissions("vehicles:write"),
    uploadRentalCustomerAttachments.fields([
      { name: "file", maxCount: 1 },
      { name: "files", maxCount: 10 }
    ]),
    asyncHandler(controller.parseCustomerDocument)
  );
  router.post("/customers", requirePermissions("vehicles:write"), asyncHandler(controller.createCustomer));
  router.get("/customers/:customerId", requirePermissions("vehicles:read"), asyncHandler(controller.getCustomerById));
  router.patch("/customers/:customerId", requirePermissions("vehicles:write"), asyncHandler(controller.updateCustomer));
  router.post("/:id/contract/generate", requirePermissions("vehicles:write"), asyncHandler(controller.generateContract));
  router.get("/:id/contract", requirePermissions("vehicles:read"), asyncHandler(controller.getContract));
  router.patch("/:id/contract", requirePermissions("vehicles:write"), asyncHandler(controller.updateContractDocument));
  router.get("/:id/contract/pdf", requirePermissions("vehicles:read"), asyncHandler(controller.downloadContractPdf));
  router.post("/:id/contract/email", requirePermissions("vehicles:write"), asyncHandler(controller.sendContractEmail));
  router.post("/:id/contract/whatsapp", requirePermissions("vehicles:write"), asyncHandler(controller.sendContractWhatsapp));
  router.post("/:id/contract/share/revoke", requirePermissions("vehicles:write"), asyncHandler(controller.revokeContractShareLinks));
  router.post("/:id/contract/mark-signed", requirePermissions("vehicles:write"), asyncHandler(controller.markContractSigned));
  router.get("/:id/pricing", requirePermissions("vehicles:read"), asyncHandler(controller.getPricing));
  router.patch("/:id/pricing", requirePermissions("vehicles:write"), asyncHandler(controller.updatePricing));
  router.get("/:id/quick", requirePermissions("vehicles:read"), asyncHandler(controller.quickDetail));
  router.get("/:id", requirePermissions("vehicles:read"), asyncHandler(controller.getById));
  router.post("/", requirePermissions("vehicles:write"), asyncHandler(controller.create));
  router.patch("/:id", requirePermissions("vehicles:write"), asyncHandler(controller.update));
  router.delete("/:id", requirePermissions("vehicles:write"), asyncHandler(controller.remove));
  router.post("/:id/transition", requirePermissions("vehicles:write"), asyncHandler(controller.transition));
  router.post("/:id/contract", requirePermissions("vehicles:write"), asyncHandler(controller.setContract));
  router.post("/:id/cargos", requirePermissions("vehicles:write"), asyncHandler(controller.setCargosStatus));
  router.post("/:id/notes", requirePermissions("vehicles:write"), asyncHandler(controller.addNote));

  return router;
};
