import { Router } from "express";
import { modifierGroupSchema, updateModifierGroupSchema } from "@restaurant/validation";
import { asyncHandler } from "../utils/asyncHandler.js";
import { requireAuth } from "../middleware/auth.js";
import { requirePermission } from "../middleware/rbac.js";
import { requireBusinessMatch } from "../middleware/businessLocation.js";
import { validateBody } from "../middleware/validate.js";
import {
  createCanonicalModifierGroup,
  deleteCanonicalModifierGroup,
  listCanonicalModifierGroups,
  updateCanonicalModifierGroup,
} from "../controllers/modifier.controller.js";

/**
 * Phase 21 — the canonical (business-wide) counterpart to modifier.routes.ts. Mounted at
 * /businesses/:businessId/menu/:menuItemId/modifiers.
 */
export const businessModifierRouter = Router({ mergeParams: true });

businessModifierRouter.use(requireAuth, requireBusinessMatch());
businessModifierRouter.get("/", requirePermission("restaurant.menu.read"), asyncHandler(listCanonicalModifierGroups));
businessModifierRouter.post(
  "/",
  requirePermission("restaurant.modifiers.write"),
  validateBody(modifierGroupSchema),
  asyncHandler(createCanonicalModifierGroup)
);
businessModifierRouter.patch(
  "/:id",
  requirePermission("restaurant.modifiers.write"),
  validateBody(updateModifierGroupSchema),
  asyncHandler(updateCanonicalModifierGroup)
);
businessModifierRouter.delete(
  "/:id",
  requirePermission("restaurant.modifiers.write"),
  asyncHandler(deleteCanonicalModifierGroup)
);
