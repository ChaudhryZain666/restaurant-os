import { Router } from "express";
import { kbArticleSchema, kbCategorySchema, updateKbArticleSchema, updateKbCategorySchema } from "@restaurant/validation";
import { asyncHandler } from "../utils/asyncHandler.js";
import { requireAuth } from "../middleware/auth.js";
import { requirePermission } from "../middleware/rbac.js";
import { validateBody } from "../middleware/validate.js";
import {
  createArticle,
  createCategory,
  deleteArticle,
  deleteCategory,
  getAdminArticle,
  getPublicArticle,
  listAdminArticles,
  listAllCategories,
  listCategories,
  listPublicArticles,
  updateArticle,
  updateCategory,
} from "../controllers/kb.controller.js";

/**
 * Knowledge base is platform-wide (documents the product itself, not any one restaurant), so
 * there's no restaurantId/tenant scoping here — only requireAuth + support.knowledgebase.write
 * for the management surface. Public routes are genuinely public (no requireAuth at all),
 * mirroring the public /restaurants/:id/menu pattern.
 */
export const kbRouter = Router();

kbRouter.get("/categories", asyncHandler(listCategories));
kbRouter.get("/articles", asyncHandler(listPublicArticles));
kbRouter.get("/articles/:slug", asyncHandler(getPublicArticle));

kbRouter.get(
  "/admin/categories",
  requireAuth,
  requirePermission("support.knowledgebase.write"),
  asyncHandler(listAllCategories)
);
kbRouter.post(
  "/admin/categories",
  requireAuth,
  requirePermission("support.knowledgebase.write"),
  validateBody(kbCategorySchema),
  asyncHandler(createCategory)
);
kbRouter.patch(
  "/admin/categories/:id",
  requireAuth,
  requirePermission("support.knowledgebase.write"),
  validateBody(updateKbCategorySchema),
  asyncHandler(updateCategory)
);
kbRouter.delete(
  "/admin/categories/:id",
  requireAuth,
  requirePermission("support.knowledgebase.write"),
  asyncHandler(deleteCategory)
);

kbRouter.get(
  "/admin/articles",
  requireAuth,
  requirePermission("support.knowledgebase.write"),
  asyncHandler(listAdminArticles)
);
kbRouter.get(
  "/admin/articles/:id",
  requireAuth,
  requirePermission("support.knowledgebase.write"),
  asyncHandler(getAdminArticle)
);
kbRouter.post(
  "/admin/articles",
  requireAuth,
  requirePermission("support.knowledgebase.write"),
  validateBody(kbArticleSchema),
  asyncHandler(createArticle)
);
kbRouter.patch(
  "/admin/articles/:id",
  requireAuth,
  requirePermission("support.knowledgebase.write"),
  validateBody(updateKbArticleSchema),
  asyncHandler(updateArticle)
);
kbRouter.delete(
  "/admin/articles/:id",
  requireAuth,
  requirePermission("support.knowledgebase.write"),
  asyncHandler(deleteArticle)
);
