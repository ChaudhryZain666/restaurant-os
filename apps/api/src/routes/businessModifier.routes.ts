import { Router } from "express";
import { modifierGroupSchema, updateModifierGroupSchema } from "@restaurant/validation";
import { asyncHandler } from "../utils/asyncHandler.js";
import { requireAuth } from "../middleware/auth.js";
import { requireBusinessMatch, requireBusinessPermission } from "../middleware/businessLocation.js";
import { validateBody } from "../middleware/validate.js";
import {
  createCanonicalModifierGroup,
  deleteCanonicalModifierGroup,
  listCanonicalModifierGroups,
  updateCanonicalModifierGroup,
} from "../controllers/modifier.controller.js";

/**
 * Phase 21 — the canonical (business-wide) counterpart to modifier.routes.ts. Mounted at
 * /businesses/:businessId/menu/:menuItemId/modifiers. Phase 25 — requireBusinessPermission (not
 * plain requirePermission) so an agency member managing this business via requireBusinessMatch's
 * agency branch is also correctly gated.
 */
export const businessModifierRouter = Router({ mergeParams: true });

businessModifierRouter.use(requireAuth, requireBusinessMatch());
businessModifierRouter.get("/", requireBusinessPermission("restaurant.menu.read"), asyncHandler(listCanonicalModifierGroups));
businessModifierRouter.post(
  "/",
  requireBusinessPermission("restaurant.modifiers.write"),
  validateBody(modifierGroupSchema),
  asyncHandler(createCanonicalModifierGroup)
);
businessModifierRouter.patch(
  "/:id",
  requireBusinessPermission("restaurant.modifiers.write"),
  validateBody(updateModifierGroupSchema),
  asyncHandler(updateCanonicalModifierGroup)
);
businessModifierRouter.delete(
  "/:id",
  requireBusinessPermission("restaurant.modifiers.write"),
  asyncHandler(deleteCanonicalModifierGroup)
);
