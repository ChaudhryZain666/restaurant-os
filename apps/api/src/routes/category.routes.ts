import { Router } from "express";
import { categorySchema, updateCategorySchema } from "@restaurant/validation";
import { asyncHandler } from "../utils/asyncHandler.js";
import { requireAuth } from "../middleware/auth.js";
import { requirePermission } from "../middleware/rbac.js";
import { requireTenantMatch } from "../middleware/tenant.js";
import { validateBody } from "../middleware/validate.js";
import {
  createCategory,
  deleteCategory,
  listCategories,
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
