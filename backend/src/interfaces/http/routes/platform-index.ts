import { Router } from "express";
import { PlatformAdminService } from "../../../application/services/platform-admin-service.js";
import { InvoiceService } from "../../../application/services/invoice-service.js";
import { PlatformConsoleService } from "../../../application/services/platform-console-service.js";
import { PlatformAlertService } from "../../../application/services/platform-alert-service.js";
import { PlatformLoginGuardService } from "../../../application/services/platform-login-guard-service.js";
import { PrismaPlatformAdminRepository } from "../../../infrastructure/repositories/prisma-platform-admin-repository.js";
import { PlatformAdminController } from "../controllers/platform-admin-controller.js";
import { platformAdminRoutes } from "./platform-admin-routes.js";

const platformRepo = new PrismaPlatformAdminRepository();
export const platformAlertService = new PlatformAlertService();
const loginGuard = new PlatformLoginGuardService();
const platformService = new PlatformAdminService(platformRepo, platformAlertService, loginGuard);
const invoiceService = new InvoiceService();
const platformConsoleService = new PlatformConsoleService();
const platformController = new PlatformAdminController(platformService, invoiceService, platformConsoleService);

export const platformRouter = Router();
platformRouter.use(platformAdminRoutes(platformController));
