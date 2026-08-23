import { Router } from "express";
import { menuItemSchema, updateMenuItemSchema } from "@restaurant/validation";
import { asyncHandler } from "../utils/asyncHandler.js";
import { requireAuth } from "../middleware/auth.js";
import { requireBusinessMatch, requireBusinessPermission } from "../middleware/businessLocation.js";
import { validateBody } from "../middleware/validate.js";
import {
  createCanonicalMenuItem,
  deleteCanonicalMenuItem,
  listCanonicalMenu,
  updateCanonicalMenuItem,
} from "../controllers/menu.controller.js";

/**
 * Phase 21 — the canonical (business-wide) counterpart to menu.routes.ts. Mounted at
 * /businesses/:businessId/menu. Unlike the location-scoped router's GET /, there is no public
 * unauthenticated read here — canonical defaults alone aren't the effective menu any location
 * actually sells (that's resolveMenuForLocation's job), so this stays a staff-only view.
 * Phase 25 — requireBusinessPermission (not plain requirePermission) so an agency member managing
 * this business via requireBusinessMatch's agency branch is also correctly gated.
 */
export const businessMenuRouter = Router({ mergeParams: true });

businessMenuRouter.use(requireAuth, requireBusinessMatch());
businessMenuRouter.get("/", requireBusinessPermission("restaurant.menu.read"), asyncHandler(listCanonicalMenu));
businessMenuRouter.post(
  "/",
  requireBusinessPermission("restaurant.menu.write"),
  validateBody(menuItemSchema),
  asyncHandler(createCanonicalMenuItem)
);
businessMenuRouter.patch(
  "/:id",
  requireBusinessPermission("restaurant.menu.write"),
  validateBody(updateMenuItemSchema),
  asyncHandler(updateCanonicalMenuItem)
);
businessMenuRouter.delete(
  "/:id",
  requireBusinessPermission("restaurant.menu.write"),
  asyncHandler(deleteCanonicalMenuItem)
);
