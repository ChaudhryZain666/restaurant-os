import { Router } from "express";
import { createRestaurantSchema, updateRestaurantSchema } from "@restaurant/validation";
import { asyncHandler } from "../utils/asyncHandler.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { requirePermission } from "../middleware/rbac.js";
import { requireTenantMatch } from "../middleware/tenant.js";
import { validateBody } from "../middleware/validate.js";
import {
  createRestaurant,
  getMyRestaurant,
  getRestaurantById,
  getRestaurantBySlug,
  getRestaurantReadiness,
  previewRestaurantBySlug,
  publishRestaurant,
  unpublishRestaurant,
  updateRestaurant,
} from "../controllers/restaurant.controller.js";

export const restaurantRouter = Router();

restaurantRouter.post(
  "/",
  requireAuth,
  requireRole("platform_admin"),
  validateBody(createRestaurantSchema),
  asyncHandler(createRestaurant)
);
restaurantRouter.get("/me", requireAuth, asyncHandler(getMyRestaurant));
restaurantRouter.get("/by-slug/:slug", asyncHandler(getRestaurantBySlug));
// Mounted before the generic PATCH/:restaurantId route registrations below since Express matches
// in declaration order and "by-slug/:slug/preview" must not be shadowed by "by-slug/:slug" — it
// isn't (different full path), but kept adjacent to getRestaurantBySlug for readability.
restaurantRouter.get("/by-slug/:slug/preview", requireAuth, asyncHandler(previewRestaurantBySlug));
// Phase 19 — the multi-location-safe sibling of /me (see getRestaurantById's doc comment). No
// extra permission beyond requireTenantMatch, mirroring /me's own openness (every restaurant-
// scoped role, including staff/kitchen_staff, can read their own location's basic info). Declared
// AFTER the /by-slug/... routes above (both literal two-segment paths, so there's no real
// collision either way, but keeping the single-segment :restaurantId wildcard last matches this
// file's existing convention of literal-prefix routes before generic ones).
restaurantRouter.get("/:restaurantId", requireAuth, requireTenantMatch(), asyncHandler(getRestaurantById));
restaurantRouter.patch(
  "/:restaurantId",
  requireAuth,
  requireTenantMatch(),
  requirePermission("restaurant.settings.manage"),
  validateBody(updateRestaurantSchema),
  asyncHandler(updateRestaurant)
);
restaurantRouter.get(
  "/:restaurantId/readiness",
  requireAuth,
  requireTenantMatch(),
  requirePermission("restaurant.settings.manage"),
  asyncHandler(getRestaurantReadiness)
);
restaurantRouter.patch(
  "/:restaurantId/publish",
  requireAuth,
  requireTenantMatch(),
  requirePermission("restaurant.settings.manage"),
  asyncHandler(publishRestaurant)
);
restaurantRouter.patch(
  "/:restaurantId/unpublish",
  requireAuth,
  requireTenantMatch(),
  requirePermission("restaurant.settings.manage"),
  asyncHandler(unpublishRestaurant)
);
