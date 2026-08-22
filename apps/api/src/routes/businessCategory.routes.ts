import { Router } from "express";
import { categorySchema, updateCategorySchema } from "@restaurant/validation";
import { asyncHandler } from "../utils/asyncHandler.js";
import { requireAuth } from "../middleware/auth.js";
import { requirePermission } from "../middleware/rbac.js";
import { requireBusinessMatch } from "../middleware/businessLocation.js";
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
 */
export const businessCategoryRouter = Router({ mergeParams: true });

businessCategoryRouter.use(requireAuth, requireBusinessMatch());
businessCategoryRouter.get("/", requirePermission("restaurant.menu.read"), asyncHandler(listCanonicalCategories));
businessCategoryRouter.post(
  "/",
  requirePermission("restaurant.categories.write"),
  validateBody(categorySchema),
  asyncHandler(createCanonicalCategory)
);
businessCategoryRouter.patch(
  "/:id",
  requirePermission("restaurant.categories.write"),
  validateBody(updateCategorySchema),
  asyncHandler(updateCanonicalCategory)
);
businessCategoryRouter.delete(
  "/:id",
  requirePermission("restaurant.categories.write"),
  asyncHandler(deleteCanonicalCategory)
);
