import { NextFunction, Request, Response } from "express";
import { AuthorizationPolicyService } from "../../../application/services/authorization-policy-service.js";
import { AppError } from "../../../shared/errors/app-error.js";

const policy = new AuthorizationPolicyService();

export const requirePermissions = (...required: string[]) => {
  return (req: Request, _res: Response, next: NextFunction) => {
    const permissions = req.auth?.permissions ?? [];
    if (!req.auth) {
      throw new AppError("Utente non autenticato", 401, "UNAUTHORIZED");
    }
    policy.assertPermissions({ permissions, roles: req.auth.roles }, required);
    next();
  };
};
