import type { Request, Response } from "express";
import type { ModifierGroupInput, UpdateModifierGroupInput } from "@restaurant/validation";
import { ModifierGroup } from "../models/ModifierGroup.js";
import { MenuItem } from "../models/MenuItem.js";
import { ApiError } from "../utils/ApiError.js";
import { sendSuccess } from "../common/response.js";
import { invalidateMenuCache } from "../services/menuCache.service.js";
import { assertMenuNotMigrated } from "../services/menuResolution.service.js";

async function assertMenuItemInRestaurant(restaurantId: string, menuItemId: string) {
  const exists = await MenuItem.exists({ _id: menuItemId, restaurantId });
  if (!exists) throw ApiError.notFound("Menu item not found");
}

export async function listModifierGroups(req: Request, res: Response) {
  const { restaurantId, menuItemId } = req.params;
  const groups = await ModifierGroup.find({ restaurantId, menuItemId }).sort({ sortOrder: 1, name: 1 });
  sendSuccess(res, { modifierGroups: groups.map((g) => g.toJSON()) });
}

export async function createModifierGroup(req: Request, res: Response) {
  const { restaurantId, menuItemId } = req.params;
  await assertMenuNotMigrated(restaurantId);
  await assertMenuItemInRestaurant(restaurantId, menuItemId);

  const body = req.body as ModifierGroupInput;
  const group = await ModifierGroup.create({ ...body, restaurantId, menuItemId });
  await invalidateMenuCache(restaurantId);
  sendSuccess(res, { modifierGroup: group.toJSON() }, 201);
}

export async function updateModifierGroup(req: Request, res: Response) {
  const { restaurantId, menuItemId, id } = req.params;
  await assertMenuNotMigrated(restaurantId);
  const updates = req.body as UpdateModifierGroupInput;

  // The zod schema only catches minSelect > maxSelect when both are sent together — a partial
  // update touching just one of them (e.g. `{ minSelect: 2 }` against an existing maxSelect: 1)
  // needs the current stored values to know whether the *resulting* group would still be
  // satisfiable. Checked against the merged view before writing, not after.
  if (updates.minSelect !== undefined || updates.maxSelect !== undefined) {
    const existing = await ModifierGroup.findOne(
      { _id: id, restaurantId, menuItemId },
      { minSelect: 1, maxSelect: 1 }
    );
    if (!existing) throw ApiError.notFound("Modifier group not found");
    const mergedMin = updates.minSelect ?? existing.minSelect;
    const mergedMax = updates.maxSelect ?? existing.maxSelect;
    if (mergedMin > mergedMax) {
      throw ApiError.badRequest("minSelect cannot be greater than maxSelect");
    }
  }

  const group = await ModifierGroup.findOneAndUpdate(
    { _id: id, restaurantId, menuItemId },
    { $set: updates },
    { new: true, runValidators: true }
  );
  if (!group) throw ApiError.notFound("Modifier group not found");
  await invalidateMenuCache(restaurantId);
  sendSuccess(res, { modifierGroup: group.toJSON() });
}

export async function deleteModifierGroup(req: Request, res: Response) {
  const { restaurantId, menuItemId, id } = req.params;
  await assertMenuNotMigrated(restaurantId);
  const group = await ModifierGroup.findOneAndDelete({ _id: id, restaurantId, menuItemId });
  if (!group) throw ApiError.notFound("Modifier group not found");
  await invalidateMenuCache(restaurantId);
  res.status(204).send();
}
