import type { Request, Response } from "express";
import type { CategoryInput, CategoryOverrideInput, UpdateCategoryInput } from "@restaurant/validation";
import { Category } from "../models/Category.js";
import { MenuItem } from "../models/MenuItem.js";
import { Restaurant } from "../models/Restaurant.js";
import { CategoryLocationOverride } from "../models/CategoryLocationOverride.js";
import { ApiError } from "../utils/ApiError.js";
import { sendSuccess } from "../common/response.js";
import { invalidateMenuCache, invalidateMenuCacheForBusiness } from "../services/menuCache.service.js";
import { assertMenuNotMigrated } from "../services/menuResolution.service.js";

export async function listCategories(req: Request, res: Response) {
  const { restaurantId } = req.params;
  const categories = await Category.find({ restaurantId }).sort({ sortOrder: 1, name: 1 });
  sendSuccess(res, { categories: categories.map((c) => c.toJSON()) });
}

export async function createCategory(req: Request, res: Response) {
  const { restaurantId } = req.params;
  await assertMenuNotMigrated(restaurantId);
  const body = req.body as CategoryInput;
  const category = await Category.create({ ...body, restaurantId });
  await invalidateMenuCache(restaurantId);
  sendSuccess(res, { category: category.toJSON() }, 201);
}

export async function updateCategory(req: Request, res: Response) {
  const { restaurantId, id } = req.params;
  await assertMenuNotMigrated(restaurantId);
  const updates = req.body as UpdateCategoryInput;
  const category = await Category.findOneAndUpdate(
    { _id: id, restaurantId },
    { $set: updates },
    { new: true, runValidators: true }
  );
  if (!category) throw ApiError.notFound("Category not found");
  await invalidateMenuCache(restaurantId);
  sendSuccess(res, { category: category.toJSON() });
}

export async function deleteCategory(req: Request, res: Response) {
  const { restaurantId, id } = req.params;
  await assertMenuNotMigrated(restaurantId);

  const itemCount = await MenuItem.countDocuments({ restaurantId, categoryId: id });
  if (itemCount > 0) {
    throw ApiError.conflict("Move or delete this category's menu items before deleting it");
  }

  const category = await Category.findOneAndDelete({ _id: id, restaurantId });
  if (!category) throw ApiError.notFound("Category not found");
  await invalidateMenuCache(restaurantId);
  res.status(204).send();
}

// --- Phase 21 — canonical (business-scoped) CRUD, mounted at /businesses/:businessId/categories ---

export async function listCanonicalCategories(req: Request, res: Response) {
  const { businessId } = req.params;
  const categories = await Category.find({ businessId }).sort({ sortOrder: 1, name: 1 });
  sendSuccess(res, { categories: categories.map((c) => c.toJSON()) });
}

export async function createCanonicalCategory(req: Request, res: Response) {
  const { businessId } = req.params;
  const body = req.body as CategoryInput;
  const category = await Category.create({ ...body, businessId });
  await invalidateMenuCacheForBusiness(businessId);
  sendSuccess(res, { category: category.toJSON() }, 201);
}

export async function updateCanonicalCategory(req: Request, res: Response) {
  const { businessId, id } = req.params;
  const updates = req.body as UpdateCategoryInput;
  const category = await Category.findOneAndUpdate(
    { _id: id, businessId },
    { $set: updates },
    { new: true, runValidators: true }
  );
  if (!category) throw ApiError.notFound("Category not found");
  await invalidateMenuCacheForBusiness(businessId);
  sendSuccess(res, { category: category.toJSON() });
}

/**
 * Fresh, businessId-scoped item-count guard — deliberately not a patch to deleteCategory's own
 * restaurantId-scoped guard above, which stays correct as-is for its only remaining audience
 * (not-yet-migrated businesses, gated out here by assertMenuNotMigrated) — see the Phase 21 docs
 * section for why the two guards are intentionally separate rather than unified.
 */
export async function deleteCanonicalCategory(req: Request, res: Response) {
  const { businessId, id } = req.params;

  const itemCount = await MenuItem.countDocuments({ businessId, categoryId: id });
  if (itemCount > 0) {
    throw ApiError.conflict("Move or delete this category's menu items before deleting it");
  }

  const category = await Category.findOneAndDelete({ _id: id, businessId });
  if (!category) throw ApiError.notFound("Category not found");
  await invalidateMenuCacheForBusiness(businessId);
  res.status(204).send();
}

// --- Phase 21 — per-location override CRUD, mounted at /restaurants/:restaurantId/categories/:id/override ---

export async function putCategoryOverride(req: Request, res: Response) {
  const { restaurantId, id } = req.params;
  const body = req.body as CategoryOverrideInput;

  const restaurant = await Restaurant.findById(restaurantId).select("businessId");
  if (!restaurant?.businessId) throw ApiError.notFound("Category not found");
  const category = await Category.exists({ _id: id, businessId: restaurant.businessId });
  if (!category) throw ApiError.notFound("Category not found");

  const override = await CategoryLocationOverride.findOneAndUpdate(
    { locationId: restaurantId, categoryId: id },
    { $set: { ...body, businessId: restaurant.businessId, locationId: restaurantId, categoryId: id } },
    { upsert: true, new: true, runValidators: true }
  );
  await invalidateMenuCache(restaurantId);
  sendSuccess(res, { override: override.toJSON() });
}

/** Idempotent — "no override" is a valid steady state, not an error to reach twice. */
export async function deleteCategoryOverride(req: Request, res: Response) {
  const { restaurantId, id } = req.params;
  await CategoryLocationOverride.deleteOne({ locationId: restaurantId, categoryId: id });
  await invalidateMenuCache(restaurantId);
  res.status(204).send();
}
