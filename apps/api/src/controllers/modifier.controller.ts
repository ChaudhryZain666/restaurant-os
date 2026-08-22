import type { Request, Response } from "express";
import type { ModifierGroupInput, ModifierGroupOverrideInput, UpdateModifierGroupInput } from "@restaurant/validation";
import { ModifierGroup } from "../models/ModifierGroup.js";
import { MenuItem } from "../models/MenuItem.js";
import { Restaurant } from "../models/Restaurant.js";
import { ModifierGroupLocationOverride } from "../models/ModifierGroupLocationOverride.js";
import { ApiError } from "../utils/ApiError.js";
import { sendSuccess } from "../common/response.js";
import { invalidateMenuCache, invalidateMenuCacheForBusiness } from "../services/menuCache.service.js";
import { assertMenuNotMigrated } from "../services/menuResolution.service.js";

async function assertMenuItemInRestaurant(restaurantId: string, menuItemId: string) {
  const exists = await MenuItem.exists({ _id: menuItemId, restaurantId });
  if (!exists) throw ApiError.notFound("Menu item not found");
}

async function assertMenuItemInBusiness(businessId: string, menuItemId: string) {
  const exists = await MenuItem.exists({ _id: menuItemId, businessId });
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

// --- Phase 21 — canonical (business-scoped) CRUD, mounted at /businesses/:businessId/menu/:menuItemId/modifiers ---

export async function listCanonicalModifierGroups(req: Request, res: Response) {
  const { businessId, menuItemId } = req.params;
  const groups = await ModifierGroup.find({ businessId, menuItemId }).sort({ sortOrder: 1, name: 1 });
  sendSuccess(res, { modifierGroups: groups.map((g) => g.toJSON()) });
}

export async function createCanonicalModifierGroup(req: Request, res: Response) {
  const { businessId, menuItemId } = req.params;
  await assertMenuItemInBusiness(businessId, menuItemId);

  const body = req.body as ModifierGroupInput;
  const group = await ModifierGroup.create({ ...body, businessId, menuItemId });
  await invalidateMenuCacheForBusiness(businessId);
  sendSuccess(res, { modifierGroup: group.toJSON() }, 201);
}

export async function updateCanonicalModifierGroup(req: Request, res: Response) {
  const { businessId, menuItemId, id } = req.params;
  const updates = req.body as UpdateModifierGroupInput;

  if (updates.minSelect !== undefined || updates.maxSelect !== undefined) {
    const existing = await ModifierGroup.findOne(
      { _id: id, businessId, menuItemId },
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
    { _id: id, businessId, menuItemId },
    { $set: updates },
    { new: true, runValidators: true }
  );
  if (!group) throw ApiError.notFound("Modifier group not found");
  await invalidateMenuCacheForBusiness(businessId);
  sendSuccess(res, { modifierGroup: group.toJSON() });
}

export async function deleteCanonicalModifierGroup(req: Request, res: Response) {
  const { businessId, menuItemId, id } = req.params;
  const group = await ModifierGroup.findOneAndDelete({ _id: id, businessId, menuItemId });
  if (!group) throw ApiError.notFound("Modifier group not found");
  await invalidateMenuCacheForBusiness(businessId);
  res.status(204).send();
}

// --- Phase 21 — per-location override CRUD, mounted at
// /restaurants/:restaurantId/menu/:menuItemId/modifiers/:id/override ---

export async function putModifierGroupOverride(req: Request, res: Response) {
  const { restaurantId, menuItemId, id } = req.params;
  const body = req.body as ModifierGroupOverrideInput;

  const restaurant = await Restaurant.findById(restaurantId).select("businessId");
  if (!restaurant?.businessId) throw ApiError.notFound("Modifier group not found");
  const group = await ModifierGroup.findOne({ _id: id, menuItemId, businessId: restaurant.businessId });
  if (!group) throw ApiError.notFound("Modifier group not found");

  if (body.optionOverrides) {
    const validOptionIds = new Set(group.options.map((o) => o._id.toString()));
    for (const opt of body.optionOverrides) {
      if (!validOptionIds.has(opt.optionId)) {
        throw ApiError.badRequest(`optionId ${opt.optionId} does not belong to this modifier group`);
      }
    }
  }

  const override = await ModifierGroupLocationOverride.findOneAndUpdate(
    { locationId: restaurantId, modifierGroupId: id },
    { $set: { ...body, businessId: restaurant.businessId, locationId: restaurantId, modifierGroupId: id } },
    { upsert: true, new: true, runValidators: true }
  );
  await invalidateMenuCache(restaurantId);
  sendSuccess(res, { override: override.toJSON() });
}

/** Idempotent — "no override" is a valid steady state, not an error to reach twice. */
export async function deleteModifierGroupOverride(req: Request, res: Response) {
  const { restaurantId, id } = req.params;
  await ModifierGroupLocationOverride.deleteOne({ locationId: restaurantId, modifierGroupId: id });
  await invalidateMenuCache(restaurantId);
  res.status(204).send();
}
