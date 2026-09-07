import { Router } from "express";
import rateLimit from "express-rate-limit";
import { contactFormSchema } from "@restaurant/validation";
import { asyncHandler } from "../utils/asyncHandler.js";
import { jsonRateLimitHandler } from "../middleware/rateLimitHandler.js";
import { validateBody } from "../middleware/validate.js";
import { submitContactForm } from "../controllers/contact.controller.js";
import { env } from "../config/env.js";

/** Mounted at /public/contact — genuinely unauthenticated, like publicPlan.routes.ts. Tighter than
 *  geocoding's limiter: this triggers a real email send per request, and unlike autocomplete has no
 *  legitimate reason to be called more than a handful of times by the same visitor. */
export const contactRouter = Router();

const contactLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: env.CONTACT_RATE_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  handler: jsonRateLimitHandler,
});

contactRouter.post("/", contactLimiter, validateBody(contactFormSchema), asyncHandler(submitContactForm));
