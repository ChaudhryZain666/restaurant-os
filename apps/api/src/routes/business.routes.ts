import { Router } from "express";
import { createLocationSchema } from "@restaurant/validation";
import { asyncHandler } from "../utils/asyncHandler.js";
import { requireAuth } from "../middleware/auth.js";
import { requireTenantMatch } from "../middleware/tenant.js";
import { requireBusinessMatch } from "../middleware/businessLocation.js";
import { requirePermission } from "../middleware/rbac.js";
import { validateBody } from "../middleware/validate.js";
import {
  getMyBusiness,
  listBusinessLocations,
  getBusinessLocation,
  createLocationForBusiness,
} from "../controllers/business.controller.js";

/** Mounted at /businesses — a new, net-new namespace (Phase 18). Deliberately does not replace or
 *  modify any /restaurants/:restaurantId/... route. */
export const businessRouter = Router();

businessRouter.use(requireAuth);

businessRouter.get("/me", asyncHandler(getMyBusiness));
businessRouter.get("/:businessId/locations", requireBusinessMatch(), asyncHandler(listBusinessLocations));
// Phase 19 — owner-only (requirePermission mirrors restaurant.routes.ts's PATCH/publish/settings
// gating: restaurant.settings.manage is held only by restaurant_owner, not manager, matching how
// Settings/Delivery already restrict who can reshape a restaurant's own configuration).
businessRouter.post(
  "/:businessId/locations",
  requireBusinessMatch(),
  requirePermission("restaurant.settings.manage"),
  validateBody(createLocationSchema),
  asyncHandler(createLocationForBusiness)
);
businessRouter.get(
  "/:businessId/locations/:locationId",
  requireTenantMatch("locationId"),
  asyncHandler(getBusinessLocation)
);
