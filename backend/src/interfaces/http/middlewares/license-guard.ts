import { NextFunction, Request, Response } from "express";
import { LicensePolicyService } from "../../../application/services/license-policy-service.js";
import { AppError } from "../../../shared/errors/app-error.js";

declare global {
  namespace Express {
    interface Request {
      license?: {
        plan: "STARTER" | "PRO" | "ENTERPRISE";
        seats: number;
        status: "PENDING" | "ACTIVE" | "SUSPENDED" | "EXPIRED" | "TRIAL" | "PAST_DUE" | "CANCELED";
        expiresAt: string | null;
        daysRemaining: number | null;
        expiringSoon: boolean;
        priceMonthly: number | null;
        billingCycle: "monthly" | "yearly";
      };
    }
  }
}

export const requireValidLicense = (licensePolicyService: LicensePolicyService) => {
  return (req: Request, _res: Response, next: NextFunction) => {
    const run = async () => {
      const tenantId = req.auth?.tenantId;
      if (!tenantId) throw new AppError("Tenant non valido", 401, "UNAUTHORIZED");

      const access = await licensePolicyService.evaluateAccess(tenantId);
      if (access.blocked) {
        if (access.reason === "TENANT_INACTIVE") {
          throw new AppError("Tenant disattivato. Contatta l'amministratore.", 403, "TENANT_INACTIVE");
        }
        if (access.reason === "LICENSE_SUSPENDED") {
          throw new AppError("Licenza sospesa. Contatta il supporto.", 403, "LICENSE_SUSPENDED");
        }
        if (access.reason === "LICENSE_PENDING") {
          throw new AppError("Completa Stripe Checkout con una carta valida per attivare la prova di 14 giorni e usare il gestionale.", 402, "LICENSE_PENDING");
        }
        if (access.reason === "LICENSE_PAST_DUE") {
          throw new AppError("Pagamento non riuscito. Sostituisci la carta o completa il pagamento per riattivare l'accesso.", 402, "LICENSE_PAST_DUE");
        }
        if (access.reason === "LICENSE_CANCELED") {
          throw new AppError("Abbonamento cancellato. Riattiva il piano per continuare.", 402, "LICENSE_CANCELED");
        }
        throw new AppError("Licenza scaduta. Rinnova per continuare.", 402, "LICENSE_EXPIRED");
      }

      req.license = access.license;
      next();
    };

    run().catch(next);
  };
};
