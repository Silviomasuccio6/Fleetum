import type {RequestHandler} from "express";
import {assertCompanyResourceView} from "../../../infrastructure/auth/company-resource-access.js";

// Run before multipart parsing so denied company uploads do not reach staging
// storage. Services/controllers repeat the guard for their other entry points.
export const requireCompanyResourceView: RequestHandler = (req, _res, next) => {
  try {
    assertCompanyResourceView(req.auth!.tenantId);
    next();
  } catch (error) {
    next(error);
  }
};
