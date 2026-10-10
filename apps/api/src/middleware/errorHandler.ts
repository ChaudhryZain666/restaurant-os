import type { NextFunction, Request, Response } from "express";
import mongoose from "mongoose";
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

/** Client-facing messages for express.json()/body-parser failures, keyed by its error `type`.
 *  Never the parser's own message, which can quote fragments of the request body. */
const BODY_PARSER_MESSAGES: Record<string, string> = {
  "entity.parse.failed": "Request body is not valid JSON.",
  "entity.too.large": "Request body is too large.",
  "encoding.unsupported": "Unsupported content encoding.",
  "charset.unsupported": "Unsupported request charset.",
  "request.aborted": "Request was aborted.",
  "request.size.invalid": "Request body size did not match its Content-Length.",
  "stream.encoding.set": "Invalid request stream.",
  "parameters.too.many": "Too many parameters in the request body.",
};

/** A body-parser (http-errors) client error: carries its own 4xx status and a `type`. */
function bodyParserError(err: unknown): { status: number; message: string } | null {
  if (!err || typeof err !== "object") return null;
  const { type, status } = err as { type?: unknown; status?: unknown };
  if (typeof type !== "string" || !(type in BODY_PARSER_MESSAGES)) return null;
  if (typeof status !== "number" || status < 400 || status > 499) return null;
  return { status, message: BODY_PARSER_MESSAGES[type] };
}

export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  // Phase 88 — malformed/oversized request bodies are the client's error (400/413/415), never a 500.
  const parseError = bodyParserError(err);
  if (parseError) {
    logger.warn("rejected request body", { requestId: res.locals.requestId, method: req.method, path: req.path, status: parseError.status });
    return res.status(parseError.status).json({
      success: false,
      error: { code: ErrorCode.VALIDATION_ERROR, message: parseError.message },
      requestId: res.locals.requestId,
    });
  }

  // Phase 88 — a malformed identifier (e.g. /restaurants/not-an-id) that reached a query: the
  // client sent an invalid value, so 400 — naming the field, never echoing the value back.
  if (err instanceof mongoose.Error.CastError) {
    logger.warn("rejected malformed identifier", { requestId: res.locals.requestId, method: req.method, path: req.path, field: err.path, kind: err.kind });
    return res.status(400).json({
      success: false,
      error: { code: ErrorCode.VALIDATION_ERROR, message: `Invalid ${err.path === "_id" ? "id" : err.path}.` },
      requestId: res.locals.requestId,
    });
  }

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
