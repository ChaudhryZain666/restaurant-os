import { Router } from "express";
import { categorySchema, updateCategorySchema } from "@restaurant/validation";
import { asyncHandler } from "../utils/asyncHandler.js";
import { requireAuth } from "../middleware/auth.js";
import { requireBusinessMatch, requireBusinessPermission } from "../middleware/businessLocation.js";
import { validateBody } from "../middleware/validate.js";
import {
  createCanonicalCategory,
  deleteCanonicalCategory,
  listCanonicalCategories,
  updateCanonicalCategory,
} from "../controllers/category.controller.js";

/**
 * Phase 21 — the canonical (business-wide) counterpart to category.routes.ts. Mounted at
 * /businesses/:businessId/categories. Reuses the exact same restaurant.categories.write
 * permission as the location-scoped router (owner/manager already hold it; requireBusinessMatch
 * naturally excludes staff/kitchen_staff, who hold neither) — no new RBAC entry needed.
 * Phase 25 — requireBusinessPermission (not plain requirePermission) so an agency member managing
 * this business via requireBusinessMatch's agency branch is also correctly gated.
 */
export const businessCategoryRouter = Router({ mergeParams: true });

businessCategoryRouter.use(requireAuth, requireBusinessMatch());
businessCategoryRouter.get("/", requireBusinessPermission("restaurant.menu.read"), asyncHandler(listCanonicalCategories));
businessCategoryRouter.post(
  "/",
  requireBusinessPermission("restaurant.categories.write"),
  validateBody(categorySchema),
  asyncHandler(createCanonicalCategory)
);
businessCategoryRouter.patch(
  "/:id",
  requireBusinessPermission("restaurant.categories.write"),
  validateBody(updateCategorySchema),
  asyncHandler(updateCanonicalCategory)
);
businessCategoryRouter.delete(
  "/:id",
  requireBusinessPermission("restaurant.categories.write"),
  asyncHandler(deleteCanonicalCategory)
);
