import { Router } from "express";
import { categoryOverrideSchema, categorySchema, updateCategorySchema } from "@restaurant/validation";
import { asyncHandler } from "../utils/asyncHandler.js";
import { requireAuth } from "../middleware/auth.js";
// Phase 59 — was requirePermission from middleware/rbac.js (plain, non-agency-aware); see
// menu.routes.ts's identical fix for the full reasoning (this router has the exact same gap).
import { requireTenantMatch, requireTenantPermission as requirePermission } from "../middleware/tenant.js";
import { validateBody } from "../middleware/validate.js";
import {
  createCategory,
  deleteCategory,
  deleteCategoryOverride,
  listCategories,
  putCategoryOverride,
  updateCategory,
} from "../controllers/category.controller.js";

/** Mounted at /restaurants/:restaurantId/categories — mergeParams is required to see :restaurantId. */
export const categoryRouter = Router({ mergeParams: true });

categoryRouter.use(requireAuth, requireTenantMatch());
categoryRouter.get("/", asyncHandler(listCategories));
categoryRouter.post(
  "/",
  requirePermission("restaurant.categories.write"),
  validateBody(categorySchema),
  asyncHandler(createCategory)
);
categoryRouter.patch(
  "/:id",
  requirePermission("restaurant.categories.write"),
  validateBody(updateCategorySchema),
  asyncHandler(updateCategory)
);
categoryRouter.delete("/:id", requirePermission("restaurant.categories.write"), asyncHandler(deleteCategory));
// Phase 21 — per-location override on a canonical category (isActive/sortOrder).
categoryRouter.put(
  "/:id/override",
  requirePermission("restaurant.categories.write"),
  validateBody(categoryOverrideSchema),
  asyncHandler(putCategoryOverride)
);
categoryRouter.delete(
  "/:id/override",
  requirePermission("restaurant.categories.write"),
  asyncHandler(deleteCategoryOverride)
);
