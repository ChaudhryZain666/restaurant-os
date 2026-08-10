import type { NextFunction, Request, Response } from "express";
import { ApiError } from "../utils/ApiError.js";
import { ErrorCode } from "../common/errorCodes.js";
import { logger } from "../common/logger.js";

export function notFoundHandler(req: Request, res: Response) {
  res.status(404).json({
    success: false,
    error: { code: ErrorCode.NOT_FOUND, message: `Route not found: ${req.method} ${req.originalUrl}` },
    requestId: res.locals.requestId,
  });
}

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof ApiError) {
    if (err.statusCode >= 500) {
      logger.error(err.message, { requestId: res.locals.requestId, code: err.code, stack: err.stack });
    }
    return res.status(err.statusCode).json({
      success: false,
      error: { code: err.code, message: err.message, details: err.details },
      requestId: res.locals.requestId,
    });
  }

  const message = err instanceof Error ? err.message : "Unknown error";
  logger.error(message, {
    requestId: res.locals.requestId,
    stack: err instanceof Error ? err.stack : undefined,
  });

  return res.status(500).json({
    success: false,
    error: { code: ErrorCode.INTERNAL_ERROR, message: "Internal server error" },
    requestId: res.locals.requestId,
  });
}
