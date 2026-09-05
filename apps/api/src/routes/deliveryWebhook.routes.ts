import { Router } from "express";
import { asyncHandler } from "../utils/asyncHandler.js";
import { handleDeliveryProviderWebhook } from "../controllers/deliveryWebhook.controller.js";

/**
 * Mounted at /webhooks/deliveries/:provider/:accountId — mirrors paymentWebhook.routes.ts's own
 * BYOC route exactly (see handleRestaurantAccountWebhook there). There is no single-segment
 * "/:provider" sibling route the way payments has: every third-party delivery provider here is
 * BYOC-only (no platform-pooled account — see restaurantDeliveryProvider.ts), so the account must
 * always be named up front. No requireAuth: authenticated by signature, not a session.
 */
export const deliveryWebhookRouter = Router();

deliveryWebhookRouter.post("/:provider/:accountId", asyncHandler(handleDeliveryProviderWebhook));
