import type { Request, Response } from "express";
import type { MenuItemInput, UpdateMenuItemInput } from "@restaurant/validation";
import { MenuItem } from "../models/MenuItem.js";
import { Category } from "../models/Category.js";
import { ModifierGroup } from "../models/ModifierGroup.js";
import { redis } from "../config/redis.js";
import { ApiError } from "../utils/ApiError.js";
import { sendSuccess } from "../common/response.js";
import { menuCacheKey, invalidateMenuCache, MENU_CACHE_TTL_SECONDS } from "../services/menuCache.service.js";
import {
  assertMenuNotMigrated,
  resolveCanonicalBusinessId,
  resolveMenuForLocation,
} from "../services/menuResolution.service.js";

/** Throws if categoryId doesn't reference an existing category owned by this restaurant. */
async function assertCategoryInRestaurant(restaurantId: string, categoryId: string) {
  const exists = await Category.exists({ _id: categoryId, restaurantId });
  if (!exists) {
    throw ApiError.badRequest("categoryId does not reference a category on this restaurant");
  }
}

/** Legacy (pre-Phase-20), restaurantId-scoped query — unchanged from before this phase. */
async function loadLegacyPublicMenu(restaurantId: string) {
  const [itemDocs, categoryDocs, modifierGroupDocs] = await Promise.all([
    MenuItem.find({ restaurantId, isAvailable: true }).sort({ categoryId: 1, sortOrder: 1, name: 1 }),
    Category.find({ restaurantId, isActive: true }).sort({ sortOrder: 1, name: 1 }),
    ModifierGroup.find({ restaurantId, isActive: true }).sort({ sortOrder: 1, name: 1 }),
  ]);
  return {
    items: itemDocs.map((doc) => doc.toJSON()),
    categories: categoryDocs.map((doc) => doc.toJSON()),
    // Individually-deactivated options aren't filtered at the ModifierGroup query level above
    // (only whole groups are) — strip them here so the public menu never offers a choice that
    // priceOrderItems would then reject at checkout.
    modifierGroups: modifierGroupDocs.map((doc) => {
      const json = doc.toJSON() as { options: Array<{ isActive: boolean }> };
      return { ...json, options: json.options.filter((o) => o.isActive) };
    }),
  };
}

export async function listMenu(req: Request, res: Response) {
  const { restaurantId } = req.params;
  const cacheKey = menuCacheKey(restaurantId);

  const cached = await redis.get(cacheKey);
  if (cached) {
    return sendSuccess(res, { ...JSON.parse(cached), cached: true });
  }

  const canonicalBusinessId = await resolveCanonicalBusinessId(restaurantId);
  const payload = canonicalBusinessId
    ? await resolveMenuForLocation(canonicalBusinessId, restaurantId, { includeHidden: false })
    : await loadLegacyPublicMenu(restaurantId);

  await redis.set(cacheKey, JSON.stringify(payload), "EX", MENU_CACHE_TTL_SECONDS);
  return sendSuccess(res, { ...payload, cached: false });
}

/**
 * Staff-only, uncached, and deliberately separate from listMenu: listMenu is public and its
 * response is cached in Redis, so it must never include unavailable items — a request that
 * populated the shared cache with hidden items included would leak them to every subsequent
 * public customer request reading that same cache entry. Restaurant staff need to see hidden
 * items too (to be able to un-hide them), hence this endpoint.
 */
export async function listAllMenuItems(req: Request, res: Response) {
  const { restaurantId } = req.params;
  const canonicalBusinessId = await resolveCanonicalBusinessId(restaurantId);
  if (canonicalBusinessId) {
    const resolved = await resolveMenuForLocation(canonicalBusinessId, restaurantId, { includeHidden: true });
    sendSuccess(res, { items: resolved.items });
    return;
  }
  const items = await MenuItem.find({ restaurantId }).sort({ categoryId: 1, sortOrder: 1, name: 1 });
  sendSuccess(res, { items: items.map((doc) => doc.toJSON()) });
}

export async function createMenuItem(req: Request, res: Response) {
  const { restaurantId } = req.params;
  await assertMenuNotMigrated(restaurantId);
  const body = req.body as MenuItemInput;
  await assertCategoryInRestaurant(restaurantId, body.categoryId);

  const item = await MenuItem.create({ ...body, restaurantId });
  await invalidateMenuCache(restaurantId);
  sendSuccess(res, { item: item.toJSON() }, 201);
}

export async function updateMenuItem(req: Request, res: Response) {
  const { restaurantId, id } = req.params;
  await assertMenuNotMigrated(restaurantId);
  // updateMenuItemSchema has no restaurantId field, so req.body (already parsed by
  // validateBody) cannot carry one through — the filter below is what scopes this update
  // to the caller's own tenant; restaurantId itself is never part of the $set. categoryId IS
  // allowed here, but is re-verified against the caller's own restaurant first — an item can
  // move between categories, but never to another restaurant's category (Phase 1 audit item).
  const updates = req.body as UpdateMenuItemInput;
  if (updates.categoryId) {
    await assertCategoryInRestaurant(restaurantId, updates.categoryId);
  }

  const item = await MenuItem.findOneAndUpdate(
    { _id: id, restaurantId },
    { $set: updates },
    { new: true, runValidators: true }
  );
  if (!item) throw ApiError.notFound("Menu item not found");
  await invalidateMenuCache(restaurantId);
  sendSuccess(res, { item: item.toJSON() });
}

export async function deleteMenuItem(req: Request, res: Response) {
  const { restaurantId, id } = req.params;
  await assertMenuNotMigrated(restaurantId);
  const item = await MenuItem.findOneAndDelete({ _id: id, restaurantId });
  if (!item) throw ApiError.notFound("Menu item not found");
  await invalidateMenuCache(restaurantId);
  res.status(204).send();
}
