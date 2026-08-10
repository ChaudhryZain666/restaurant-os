import type { Response } from "express";

export function sendSuccess<T>(res: Response, data: T, status = 200): Response {
  return res.status(status).json({ success: true, data, requestId: res.locals.requestId });
}
