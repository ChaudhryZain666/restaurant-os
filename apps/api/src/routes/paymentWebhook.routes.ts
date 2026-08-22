import { Router } from "express";
import { asyncHandler } from "../utils/asyncHandler.js";
import { handleProviderWebhook } from "../controllers/paymentWebhook.controller.js";

/**
 * Mounted at /webhooks/payments/:provider — top-level, not under /restaurants: a webhook
 * delivery is authenticated by its signature (see paymentWebhook.controller.ts), not a user
 * session, and arrives with no relationship to any browser's cookies/auth headers at all. No
 * requireAuth, no tenant middleware — trusting an arbitrary caller here would be exactly the
 * "no trust in arbitrary client requests" failure this route exists to avoid, which is why
 * everything of substance happens after signature verification, not before it.
 */
export const paymentWebhookRouter = Router();

paymentWebhookRouter.post("/:provider", asyncHandler(handleProviderWebhook));
