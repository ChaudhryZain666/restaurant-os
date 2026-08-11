import { Router } from "express";
import { menuItemSchema, updateMenuItemSchema } from "@restaurant/validation";
import { asyncHandler } from "../utils/asyncHandler.js";
import { requireAuth } from "../middleware/auth.js";
import { requirePermission } from "../middleware/rbac.js";
import { requireTenantMatch } from "../middleware/tenant.js";
import { validateBody } from "../middleware/validate.js";
import {
  createMenuItem,
  deleteMenuItem,
  listAllMenuItems,
  listMenu,
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
