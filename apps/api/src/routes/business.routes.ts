import { Router } from "express";
import rateLimit from "express-rate-limit";
import { createBusinessSelfServeSchema, createLocationSchema } from "@restaurant/validation";
import { asyncHandler } from "../utils/asyncHandler.js";
import { requireAuth } from "../middleware/auth.js";
import { requireTenantMatch } from "../middleware/tenant.js";
import { requireBusinessMatch, requireBusinessPermission } from "../middleware/businessLocation.js";
import { validateBody } from "../middleware/validate.js";
import { jsonRateLimitHandler } from "../middleware/rateLimitHandler.js";
import {
  getMyBusiness,
  listBusinessLocations,
  getBusinessLocation,
  createLocationForBusiness,
  createBusinessSelfServe,
} from "../controllers/business.controller.js";
import { getLocationLimitHandler } from "../controllers/subscription.controller.js";

/** Mounted at /businesses — a new, net-new namespace (Phase 18). Deliberately does not replace or
 *  modify any /restaurants/:restaurantId/... route. */
export const businessRouter = Router();

businessRouter.use(requireAuth);

// Phase 37 — same posture as authLimiter (auth.routes.ts): a real signup-adjacent action open to
// any authenticated account, not just an already-provisioned owner/manager, so it gets its own
// throttle rather than relying on the 1000/15min app-wide floor alone.
const selfServeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  handler: jsonRateLimitHandler,
});

businessRouter.post(
  "/self-serve",
  selfServeLimiter,
  validateBody(createBusinessSelfServeSchema),
  asyncHandler(createBusinessSelfServe)
);

businessRouter.get("/me", asyncHandler(getMyBusiness));
businessRouter.get("/:businessId/locations", requireBusinessMatch(), asyncHandler(listBusinessLocations));
// Phase 27 — a pre-check for the "add location" UI affordance, gated the same as creation itself.
businessRouter.get(
  "/:businessId/locations/limit",
  requireBusinessMatch(),
  requireBusinessPermission("restaurant.settings.manage"),
  asyncHandler(getLocationLimitHandler)
);
// Phase 19 — owner-only (requirePermission mirrors restaurant.routes.ts's PATCH/publish/settings
// gating: restaurant.settings.manage is held only by restaurant_owner, not manager, matching how
// Settings/Delivery already restrict who can reshape a restaurant's own configuration).
businessRouter.post(
  "/:businessId/locations",
  requireBusinessMatch(),
  requireBusinessPermission("restaurant.settings.manage"),
  validateBody(createLocationSchema),
  asyncHandler(createLocationForBusiness)
);
businessRouter.get(
  "/:businessId/locations/:locationId",
  requireTenantMatch("locationId"),
  asyncHandler(getBusinessLocation)
);
