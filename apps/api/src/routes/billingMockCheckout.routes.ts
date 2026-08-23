import { Router } from "express";
import { asyncHandler } from "../utils/asyncHandler.js";
import { completeMockCheckout } from "../controllers/billingMockDriver.controller.js";

/**
 * Mounted at /billing/mock-checkout/:token/complete — public (no auth), keyed by the opaque
 * checkout token alone. Only ever registered when BILLING_PROVIDER=mock (see routes/index.ts); a
 * deployment configured for a real provider has no such route, mirroring
 * businessSubscription.routes.ts's mock-advance route's own gating exactly.
 */
export const billingMockCheckoutRouter = Router();

billingMockCheckoutRouter.post("/:token/complete", asyncHandler(completeMockCheckout));
