import type { NextFunction, Request, Response } from "express";
import { ApiError } from "../utils/ApiError.js";

export function notFoundHandler(req: Request, res: Response) {
  res.status(404).json({ error: `Route not found: ${req.method} ${req.originalUrl}` });
}

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof ApiError) {
    return res.status(err.statusCode).json({ error: err.message, details: err.details });
  }

  console.error("[unhandled error]", err);
  return res.status(500).json({ error: "Internal server error" });
}
