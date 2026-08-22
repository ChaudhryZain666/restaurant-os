import { Router } from "express";
import { modifierGroupOverrideSchema, modifierGroupSchema, updateModifierGroupSchema } from "@restaurant/validation";
import { asyncHandler } from "../utils/asyncHandler.js";
import { requireAuth } from "../middleware/auth.js";
import { requirePermission } from "../middleware/rbac.js";
import { requireTenantMatch } from "../middleware/tenant.js";
import { validateBody } from "../middleware/validate.js";
import {
  createModifierGroup,
  deleteModifierGroup,
  deleteModifierGroupOverride,
  listModifierGroups,
  putModifierGroupOverride,
  updateModifierGroup,
} from "../controllers/modifier.controller.js";

/**
 * Mounted at /restaurants/:restaurantId/menu/:menuItemId/modifiers — mergeParams is required
 * to see both :restaurantId and :menuItemId.
 */
export const modifierRouter = Router({ mergeParams: true });

modifierRouter.use(requireAuth, requireTenantMatch());
modifierRouter.get("/", asyncHandler(listModifierGroups));
modifierRouter.post(
  "/",
  requirePermission("restaurant.modifiers.write"),
  validateBody(modifierGroupSchema),
  asyncHandler(createModifierGroup)
);
modifierRouter.patch(
  "/:id",
  requirePermission("restaurant.modifiers.write"),
  validateBody(updateModifierGroupSchema),
  asyncHandler(updateModifierGroup)
);
modifierRouter.delete(
  "/:id",
  requirePermission("restaurant.modifiers.write"),
  asyncHandler(deleteModifierGroup)
);
// Phase 21 — per-location override on a canonical modifier group (isActive, per-option
// isActive/priceAdjustment).
modifierRouter.put(
  "/:id/override",
  requirePermission("restaurant.modifiers.write"),
  validateBody(modifierGroupOverrideSchema),
  asyncHandler(putModifierGroupOverride)
);
modifierRouter.delete(
  "/:id/override",
  requirePermission("restaurant.modifiers.write"),
  asyncHandler(deleteModifierGroupOverride)
);
