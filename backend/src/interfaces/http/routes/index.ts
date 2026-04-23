import { Router } from "express";
import { AcceptInviteUseCase } from "../../../application/usecases/auth/accept-invite-usecase.js";
import { LoginUseCase } from "../../../application/usecases/auth/login-usecase.js";
import { ManageProfileUseCase } from "../../../application/usecases/auth/manage-profile-usecase.js";
import { ImportMasterDataUseCase } from "../../../application/usecases/master-data/import-master-data-usecase.js";
import { RequestPasswordResetUseCase } from "../../../application/usecases/auth/request-password-reset-usecase.js";
import { ResetPasswordUseCase } from "../../../application/usecases/auth/reset-password-usecase.js";
import { SignupUseCase } from "../../../application/usecases/auth/signup-usecase.js";
import { SendReminderUseCase } from "../../../application/usecases/reminders/send-reminder-usecase.js";
import { ManageSitesUseCases } from "../../../application/usecases/sites/manage-sites-usecases.js";
import { GetDashboardStatsUseCase } from "../../../application/usecases/stats/get-dashboard-stats-usecase.js";
import { ManageStoppagesUseCases } from "../../../application/usecases/stoppages/manage-stoppages-usecases.js";
import { ManageUsersUseCases } from "../../../application/usecases/users/manage-users-usecases.js";
import { ManageVehiclesUseCases } from "../../../application/usecases/vehicles/manage-vehicles-usecases.js";
import { ManageWorkshopsUseCases } from "../../../application/usecases/workshops/manage-workshops-usecases.js";
import { AuditService } from "../../../application/services/audit-service.js";
import { AuthSessionService } from "../../../application/services/auth-session-service.js";
import { AuthThreatDetectionService } from "../../../application/services/auth-threat-detection-service.js";
import { LicensePolicyService } from "../../../application/services/license-policy-service.js";
import { NotificationsService } from "../../../application/services/notifications-service.js";
import { SocialOAuthService } from "../../../application/services/social-oauth-service.js";
import { SettingsService } from "../../../application/services/settings-service.js";
import { prisma } from "../../../infrastructure/database/prisma/client.js";
import { EmailQueueService } from "../../../infrastructure/email/email-queue-service.js";
import { PrismaAuditLogRepository } from "../../../infrastructure/repositories/prisma-audit-log-repository.js";
import { PrismaNotificationsRepository } from "../../../infrastructure/repositories/prisma-notifications-repository.js";
import { PrismaReminderRepository } from "../../../infrastructure/repositories/prisma-reminder-repository.js";
import { PrismaSiteRepository } from "../../../infrastructure/repositories/prisma-site-repository.js";
import { PrismaStoppageOpsRepository } from "../../../infrastructure/repositories/prisma-stoppage-ops-repository.js";
import { PrismaStoppageRepository } from "../../../infrastructure/repositories/prisma-stoppage-repository.js";
import { PrismaUserRepository } from "../../../infrastructure/repositories/prisma-user-repository.js";
import { PrismaVehicleRepository } from "../../../infrastructure/repositories/prisma-vehicle-repository.js";
import { PrismaWorkshopRepository } from "../../../infrastructure/repositories/prisma-workshop-repository.js";
import { AuthController } from "../controllers/auth-controller.js";
import { AuditController } from "../controllers/audit-controller.js";
import { MasterDataController } from "../controllers/master-data-controller.js";
import { NotificationsController } from "../controllers/notifications-controller.js";
import { SettingsController } from "../controllers/settings-controller.js";
import { StatsController } from "../controllers/stats-controller.js";
import { StoppagesController } from "../controllers/stoppages-controller.js";
import { UsersController } from "../controllers/users-controller.js";
import { RentalBookingsController } from "../controllers/rental-bookings-controller.js";
import { RentalPricingController } from "../controllers/rental-pricing-controller.js";
import { requireAuth } from "../middlewares/auth.js";
import { requireCsrfProtection } from "../middlewares/csrf-protection.js";
import { createRequireFeature } from "../middlewares/feature-entitlements.js";
import { requireValidLicense } from "../middlewares/license-guard.js";
import { authRoutes } from "./auth-routes.js";
import { auditRoutes } from "./audit-routes.js";
import { masterDataRoutes } from "./master-data-routes.js";
import { notificationsRoutes } from "./notifications-routes.js";
import { settingsRoutes } from "./settings-routes.js";
import { statsRoutes } from "./stats-routes.js";
import { stoppagesRoutes } from "./stoppages-routes.js";
import { uploadsRoutes } from "./uploads-routes.js";
import { usersRoutes } from "./users-routes.js";
import { rentalBookingsRoutes } from "./rental-bookings-routes.js";
import { contractTemplatesRoutes } from "./contract-templates-routes.js";
import { rentalCustomersRoutes } from "./rental-customers-routes.js";
import { rentalPricingRoutes } from "./rental-pricing-routes.js";
import { TokenService } from "../../../application/services/token-service.js";
import { asyncHandler } from "./async-handler.js";

const userRepo = new PrismaUserRepository();
const siteRepo = new PrismaSiteRepository();
const workshopRepo = new PrismaWorkshopRepository();
const vehicleRepo = new PrismaVehicleRepository();
const stoppageRepo = new PrismaStoppageRepository();
const stoppageOpsRepo = new PrismaStoppageOpsRepository();
const reminderRepo = new PrismaReminderRepository();
const auditRepo = new PrismaAuditLogRepository();
const notificationsRepo = new PrismaNotificationsRepository();
const emailQueueService = new EmailQueueService();
const settingsService = new SettingsService(auditRepo);
const auditService = new AuditService(auditRepo);
const notificationsService = new NotificationsService(notificationsRepo);
const licensePolicyService = new LicensePolicyService(auditRepo);
const requireFeature = createRequireFeature(licensePolicyService, auditRepo);
const tokenService = new TokenService();
const authSessionService = new AuthSessionService(tokenService, userRepo);
const authThreatDetectionService = new AuthThreatDetectionService(auditRepo);
const socialOAuthService = new SocialOAuthService();

const signupUseCase = new SignupUseCase(userRepo);
const loginUseCase = new LoginUseCase(userRepo, tokenService, licensePolicyService, authSessionService);
const requestPasswordResetUseCase = new RequestPasswordResetUseCase(emailQueueService);
const resetPasswordUseCase = new ResetPasswordUseCase();
const acceptInviteUseCase = new AcceptInviteUseCase();
const manageProfileUseCase = new ManageProfileUseCase(userRepo, authSessionService);
const usersUseCases = new ManageUsersUseCases(userRepo, emailQueueService);
const sitesUseCases = new ManageSitesUseCases(siteRepo);
const workshopsUseCases = new ManageWorkshopsUseCases(workshopRepo);
const vehiclesUseCases = new ManageVehiclesUseCases(vehicleRepo);
const importMasterDataUseCase = new ImportMasterDataUseCase();
const stoppagesUseCases = new ManageStoppagesUseCases(stoppageRepo);
const reminderUseCase = new SendReminderUseCase(stoppageRepo, reminderRepo, emailQueueService);
const statsUseCase = new GetDashboardStatsUseCase();

export const reminderCronUseCase = reminderUseCase;
export const emailQueueCronService = emailQueueService;

const authController = new AuthController(
  signupUseCase,
  loginUseCase,
    requestPasswordResetUseCase,
    resetPasswordUseCase,
    acceptInviteUseCase,
    manageProfileUseCase,
    licensePolicyService,
    authSessionService,
    authThreatDetectionService,
    socialOAuthService
);
const usersController = new UsersController(usersUseCases);
const masterDataController = new MasterDataController(
  sitesUseCases,
  workshopsUseCases,
  vehiclesUseCases,
  importMasterDataUseCase
);
const stoppagesController = new StoppagesController(stoppagesUseCases, reminderUseCase, stoppageOpsRepo);
const statsController = new StatsController(statsUseCase);
const notificationsController = new NotificationsController(notificationsService);
const settingsController = new SettingsController(settingsService);
const auditController = new AuditController(auditService);
const rentalBookingsController = new RentalBookingsController(emailQueueService);
const rentalPricingController = new RentalPricingController();

export const apiRouter = Router();
apiRouter.get("/health", (_req, res) => res.json({ ok: true, service: "fermi-backend", timestamp: new Date().toISOString() }));
apiRouter.get("/calendar/apple/feed.ics", asyncHandler(stoppagesController.appleCalendarFeedPublic));
apiRouter.get("/calendar/google/callback", asyncHandler(stoppagesController.googleCalendarCallback));
apiRouter.get("/contracts/public/:token", asyncHandler(rentalBookingsController.downloadContractPdfPublic));
apiRouter.get("/ready", async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ ok: true, db: "up" });
  } catch {
    res.status(503).json({
      ok: false,
      db: "down",
      message: process.env.NODE_ENV === "production" ? "Database non disponibile" : "Database query failed"
    });
  }
});
apiRouter.use("/auth", authRoutes(authController));
apiRouter.use(requireAuth);
apiRouter.use(requireValidLicense(licensePolicyService));
apiRouter.use(requireCsrfProtection);
apiRouter.use("/users", usersRoutes(usersController));
apiRouter.use("/master-data", masterDataRoutes(masterDataController));
apiRouter.use("/stoppages", stoppagesRoutes(stoppagesController, requireFeature));
apiRouter.use("/stats", statsRoutes(statsController, requireFeature));
apiRouter.use("/notifications", notificationsRoutes(notificationsController));
apiRouter.use("/settings", settingsRoutes(settingsController));
apiRouter.use("/audit", auditRoutes(auditController));
apiRouter.use("/uploads", uploadsRoutes());
apiRouter.use("/rental-bookings", rentalBookingsRoutes(rentalBookingsController));
apiRouter.use("/rental-pricing", rentalPricingRoutes(rentalPricingController));
apiRouter.use("/rental-customers", rentalCustomersRoutes(rentalBookingsController));
apiRouter.use("/contract-templates", contractTemplatesRoutes(rentalBookingsController));
