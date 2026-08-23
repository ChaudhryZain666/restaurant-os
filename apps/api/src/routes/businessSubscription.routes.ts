import { Router } from "express";
import { createSubscriptionSchema, changeSubscriptionPlanSchema, mockAdvanceSubscriptionSchema } from "@restaurant/validation";
import { asyncHandler } from "../utils/asyncHandler.js";
import { requireAuth } from "../middleware/auth.js";
import { requireBusinessMatch, requireBusinessPermission as requirePermission } from "../middleware/businessLocation.js";
import { validateBody } from "../middleware/validate.js";
import { env } from "../config/env.js";
import {
  cancelSubscriptionHandler,
  changePlanHandler,
  createSubscription,
  getEntitlementsHandler,
  getSubscription,
  reactivateSubscriptionHandler,
} from "../controllers/subscription.controller.js";
import { mockAdvanceSubscription } from "../controllers/billingMockDriver.controller.js";

/**
 * Mounted at /businesses/:businessId/subscription — billing.read (owner+manager) for the two GET
 * routes, billing.manage (owner-only) for everything that changes state. A dedicated permission
 * pair rather than reusing restaurant.settings.manage: billing is a higher-sensitivity domain with
 * its own read/write split a single settings permission doesn't offer (see the Phase 24 plan).
 */
export const businessSubscriptionRouter = Router({ mergeParams: true });

businessSubscriptionRouter.use(requireAuth, requireBusinessMatch());

businessSubscriptionRouter.get("/", requirePermission("billing.read"), asyncHandler(getSubscription));
businessSubscriptionRouter.get("/entitlements", requirePermission("billing.read"), asyncHandler(getEntitlementsHandler));

businessSubscriptionRouter.post(
  "/",
  requirePermission("billing.manage"),
  validateBody(createSubscriptionSchema),
  asyncHandler(createSubscription)
);
businessSubscriptionRouter.post("/cancel", requirePermission("billing.manage"), asyncHandler(cancelSubscriptionHandler));
businessSubscriptionRouter.post("/reactivate", requirePermission("billing.manage"), asyncHandler(reactivateSubscriptionHandler));
businessSubscriptionRouter.post(
  "/change-plan",
  requirePermission("billing.manage"),
  validateBody(changeSubscriptionPlanSchema),
  asyncHandler(changePlanHandler)
);

// Only exists at all when the mock provider is active — a deployment configured for a real
// provider has no route here, mirroring payment.routes.ts's mock-complete route exactly.
if (env.BILLING_PROVIDER === "mock") {
  businessSubscriptionRouter.post(
    "/mock-advance",
    requirePermission("billing.manage"),
    validateBody(mockAdvanceSubscriptionSchema),
    asyncHandler(mockAdvanceSubscription)
  );
}
