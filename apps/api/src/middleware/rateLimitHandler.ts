import type { Request, Response, NextFunction } from "express";
import { ApiError } from "../utils/ApiError.js";

/**
 * express-rate-limit's default handler sends a bare plain-text body ("Too many requests, please
 * try again later.") — every other error in this API is the standard `{success:false, error:...}`
 * JSON envelope, and the frontend's apiClient unconditionally calls `res.json()` on every
 * non-204 response. Without this, hitting a rate limit doesn't surface as a friendly error at
 * all — it throws a raw "Unexpected token 'T', 'Too many r'... is not valid JSON" SyntaxError from
 * inside the fetch wrapper, crashing whatever tried to log in/search/etc. Pass this as every
 * `rateLimit({ ... })` call's `handler` so a 429 is just another `ApiError` through the same
 * `errorHandler` middleware as everything else.
 */
export function jsonRateLimitHandler(_req: Request, _res: Response, next: NextFunction) {
  next(ApiError.tooManyRequests("Too many requests. Please wait a few minutes and try again."));
}
