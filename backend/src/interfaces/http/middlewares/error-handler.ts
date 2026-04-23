import { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";
import { logger } from "../../../infrastructure/logging/logger.js";
import { AppError } from "../../../shared/errors/app-error.js";

export const errorHandler = (error: unknown, req: Request, res: Response, _next: NextFunction) => {
  const requestId = req.requestId;

  if (error instanceof AppError) {
    if (error.statusCode >= 500) {
      logger.error(
        { error, path: req.originalUrl, method: req.method, requestId },
        "Handled app error (5xx)"
      );
    }
    return res.status(error.statusCode).json({
      error: error.code,
      message: error.message,
      ...(requestId ? { requestId } : {}),
      ...(error.details ? { details: error.details } : {})
    });
  }

  if (error instanceof ZodError) {
    logger.info({ path: req.originalUrl, method: req.method, requestId, details: error.flatten() }, "Validation error");
    return res.status(422).json({
      error: "VALIDATION_ERROR",
      message: "Request non valida",
      ...(requestId ? { requestId } : {}),
      details: error.flatten()
    });
  }

  const isProd = process.env.NODE_ENV === "production";
  logger.error({ error, path: req.originalUrl, method: req.method, requestId }, "Unhandled internal error");
  return res.status(500).json({
    error: "INTERNAL_ERROR",
    message: isProd ? "Errore interno" : (error as Error)?.message,
    ...(requestId ? { requestId } : {})
  });
};
