import { Router } from "express";
import { menuItemOverrideSchema, menuItemSchema, updateMenuItemSchema } from "@restaurant/validation";
import { asyncHandler } from "../utils/asyncHandler.js";
import { requireAuth } from "../middleware/auth.js";
import { requirePermission } from "../middleware/rbac.js";
import { requireTenantMatch } from "../middleware/tenant.js";
import { validateBody } from "../middleware/validate.js";
import {
  createMenuItem,
  deleteMenuItem,
  deleteMenuItemOverride,
  listAllMenuItems,
  listLocationOverrides,
  listMenu,
  putMenuItemOverride,
  updateMenuItem,
} from "../controllers/menu.controller.js";

/** Mounted at /restaurants/:restaurantId/menu — mergeParams is required to see :restaurantId. */
export const menuRouter = Router({ mergeParams: true });

menuRouter.get("/", asyncHandler(listMenu));
menuRouter.get(
  "/items",
  requireAuth,
  requireTenantMatch(),
  requirePermission("restaurant.menu.read"),
  asyncHandler(listAllMenuItems)
);
// Phase 21 — every override row this location currently has, across categories/items/modifier
// groups. Same read permission as listAllMenuItems (staff already sees hidden items).
menuRouter.get(
  "/overrides",
  requireAuth,
  requireTenantMatch(),
  requirePermission("restaurant.menu.read"),
  asyncHandler(listLocationOverrides)
);
menuRouter.post(
  "/",
  requireAuth,
  requireTenantMatch(),
  requirePermission("restaurant.menu.write"),
  validateBody(menuItemSchema),
  asyncHandler(createMenuItem)
);
menuRouter.patch(
  "/:id",
  requireAuth,
  requireTenantMatch(),
  requirePermission("restaurant.menu.write"),
  validateBody(updateMenuItemSchema),
  asyncHandler(updateMenuItem)
);
menuRouter.delete(
  "/:id",
  requireAuth,
  requireTenantMatch(),
  requirePermission("restaurant.menu.write"),
  asyncHandler(deleteMenuItem)
);
// Phase 21 — per-location override on a canonical item (price/availability/sortOrder).
menuRouter.put(
  "/:id/override",
  requireAuth,
  requireTenantMatch(),
  requirePermission("restaurant.menu.write"),
  validateBody(menuItemOverrideSchema),
  asyncHandler(putMenuItemOverride)
);
menuRouter.delete(
  "/:id/override",
  requireAuth,
  requireTenantMatch(),
  requirePermission("restaurant.menu.write"),
  asyncHandler(deleteMenuItemOverride)
);
