import { Router } from "express";
import { asyncHandler } from "../utils/asyncHandler.js";
import { handleBillingProviderWebhook } from "../controllers/billingWebhook.controller.js";

/** Mounted at /webhooks/billing/:provider — top-level, not under /businesses, mirroring
 *  paymentWebhook.routes.ts exactly and for the same reason: a webhook is authenticated by its
 *  signature, not a user session. */
export const billingWebhookRouter = Router();

billingWebhookRouter.post("/:provider", asyncHandler(handleBillingProviderWebhook));
