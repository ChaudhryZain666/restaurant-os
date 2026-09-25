import { Router } from "express";
import { asyncHandler } from "../utils/asyncHandler.js";
import { handleMarketplaceWebhook } from "../controllers/marketplaceWebhook.controller.js";

/** Mounted at /webhooks/marketplace — see marketplaceWebhook.controller.ts's header comment for
 *  why this is a single `/:provider` endpoint (no per-restaurant/integration URL segment) for all
 *  three providers, unlike the BYOC delivery webhooks. */
export const marketplaceWebhookRouter = Router();

marketplaceWebhookRouter.post("/:provider", asyncHandler(handleMarketplaceWebhook));
