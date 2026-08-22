import { Router } from "express";
import { menuItemSchema, updateMenuItemSchema } from "@restaurant/validation";
import { asyncHandler } from "../utils/asyncHandler.js";
import { requireAuth } from "../middleware/auth.js";
import { requirePermission } from "../middleware/rbac.js";
import { requireBusinessMatch } from "../middleware/businessLocation.js";
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
 */
export const businessMenuRouter = Router({ mergeParams: true });

businessMenuRouter.use(requireAuth, requireBusinessMatch());
businessMenuRouter.get("/", requirePermission("restaurant.menu.read"), asyncHandler(listCanonicalMenu));
businessMenuRouter.post(
  "/",
  requirePermission("restaurant.menu.write"),
  validateBody(menuItemSchema),
  asyncHandler(createCanonicalMenuItem)
);
businessMenuRouter.patch(
  "/:id",
  requirePermission("restaurant.menu.write"),
  validateBody(updateMenuItemSchema),
  asyncHandler(updateCanonicalMenuItem)
);
businessMenuRouter.delete(
  "/:id",
  requirePermission("restaurant.menu.write"),
  asyncHandler(deleteCanonicalMenuItem)
);
