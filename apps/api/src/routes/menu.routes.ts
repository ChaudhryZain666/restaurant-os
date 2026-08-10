import { Router } from "express";
import { menuItemSchema } from "@restaurant/validation";
import { asyncHandler } from "../utils/asyncHandler.js";
import { requireAuth } from "../middleware/auth.js";
import { requirePermission } from "../middleware/rbac.js";
import { requireTenantMatch } from "../middleware/tenant.js";
import { validateBody } from "../middleware/validate.js";
import {
  createMenuItem,
  deleteMenuItem,
  listMenu,
  updateMenuItem,
} from "../controllers/menu.controller.js";

/** Mounted at /restaurants/:restaurantId/menu — mergeParams is required to see :restaurantId. */
export const menuRouter = Router({ mergeParams: true });

menuRouter.get("/", asyncHandler(listMenu));
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
  asyncHandler(updateMenuItem)
);
menuRouter.delete(
  "/:id",
  requireAuth,
  requireTenantMatch(),
  requirePermission("restaurant.menu.write"),
  asyncHandler(deleteMenuItem)
);
