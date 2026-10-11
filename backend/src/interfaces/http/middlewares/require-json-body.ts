import { NextFunction, Request, Response } from "express";
import { AppError } from "../../../shared/errors/app-error.js";

/**
 * Cookie-issuing credential endpoints accept JSON only. Browser forms cannot
 * submit application/json without a CORS preflight, which prevents login CSRF
 * and refresh-token session fixation through cross-site form posts.
 */
export const requireJsonBody = (req: Request, _res: Response, next: NextFunction) => {
  if (!req.is("application/json")) {
    return next(new AppError("Content-Type application/json richiesto", 415, "JSON_CONTENT_TYPE_REQUIRED"));
  }
  return next();
};
