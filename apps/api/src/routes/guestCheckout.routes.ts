import { Router } from "express";
import rateLimit from "express-rate-limit";
import {
  claimGuestCheckoutForUserSchema,
  claimGuestCheckoutSchema,
  guestCheckoutStatusQuerySchema,
  startGuestCheckoutSchema,
} from "@restaurant/validation";
import { asyncHandler } from "../utils/asyncHandler.js";
import { jsonRateLimitHandler } from "../middleware/rateLimitHandler.js";
import { requireAuth } from "../middleware/auth.js";
import { validateBody } from "../middleware/validate.js";
import { env } from "../config/env.js";
import {
  claimGuestCheckoutForUserHandler,
  claimGuestCheckoutHandler,
  getGuestCheckoutConfigHandler,
  getCheckoutHandoffHandler,
  getGuestCheckoutStatusHandler,
  startGuestCheckoutHandler,
} from "../controllers/guestCheckout.controller.js";

/** Mounted at /public/checkout — the pay-now checkout on garnishtable.com (Launch, 2026-11-21).
 *  Unauthenticated except the signed-in claim. Limits are per IP over 15 minutes; outside
 *  production they are loose so test suites aren't throttled. */
export const guestCheckoutRouter = Router();

const limiter = (limit: number) =>
  rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: env.NODE_ENV === "production" ? limit : Math.max(limit, 10_000),
    standardHeaders: true,
    legacyHeaders: false,
    handler: jsonRateLimitHandler,
  });

guestCheckoutRouter.get("/config", limiter(300), asyncHandler(getGuestCheckoutConfigHandler));
guestCheckoutRouter.post("/", limiter(30), validateBody(startGuestCheckoutSchema), asyncHandler(startGuestCheckoutHandler));
// Polled by the checkout page while the webhook confirms the payment (every few seconds). POST, so
// the set-up token never appears in a URL (request logs record paths with their query).
guestCheckoutRouter.post("/status", limiter(600), validateBody(guestCheckoutStatusQuerySchema), asyncHandler(getGuestCheckoutStatusHandler));
// In-app Subscribe, handed to this site (services/checkoutHandoff.service.ts). Same {token} body shape.
guestCheckoutRouter.post("/handoff", limiter(60), validateBody(guestCheckoutStatusQuerySchema), asyncHandler(getCheckoutHandoffHandler));
guestCheckoutRouter.post("/claim", limiter(20), validateBody(claimGuestCheckoutSchema), asyncHandler(claimGuestCheckoutHandler));
guestCheckoutRouter.post("/claim/signed-in", limiter(20), requireAuth, validateBody(claimGuestCheckoutForUserSchema), asyncHandler(claimGuestCheckoutForUserHandler));
