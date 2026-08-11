import type { Request, Response } from "express";
import type { CategoryInput, UpdateCategoryInput } from "@restaurant/validation";
import { Category } from "../models/Category.js";
import { MenuItem } from "../models/MenuItem.js";
import { ApiError } from "../utils/ApiError.js";
import { sendSuccess } from "../common/response.js";
import { invalidateMenuCache } from "../services/menuCache.service.js";

export async function listCategories(req: Request, res: Response) {
  const { restaurantId } = req.params;
  const categories = await Category.find({ restaurantId }).sort({ sortOrder: 1, name: 1 });
  sendSuccess(res, { categories: categories.map((c) => c.toJSON()) });
}

export async function createCategory(req: Request, res: Response) {
  const { restaurantId } = req.params;
  const body = req.body as CategoryInput;
  const category = await Category.create({ ...body, restaurantId });
  await invalidateMenuCache(restaurantId);
  sendSuccess(res, { category: category.toJSON() }, 201);
}

export async function updateCategory(req: Request, res: Response) {
  const { restaurantId, id } = req.params;
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

  const itemCount = await MenuItem.countDocuments({ restaurantId, categoryId: id });
  if (itemCount > 0) {
    throw ApiError.conflict("Move or delete this category's menu items before deleting it");
  }

  const category = await Category.findOneAndDelete({ _id: id, restaurantId });
  if (!category) throw ApiError.notFound("Category not found");
  await invalidateMenuCache(restaurantId);
  res.status(204).send();
}
