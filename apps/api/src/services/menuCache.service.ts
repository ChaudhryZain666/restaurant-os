import { redis } from "../config/redis.js";
import { Restaurant } from "../models/Restaurant.js";

export const MENU_CACHE_TTL_SECONDS = 60;

export function menuCacheKey(restaurantId: string): string {
  return `menu:${restaurantId}:available`;
}

/** Categories and menu items are cached together under one key — either changing invalidates it. */
export async function invalidateMenuCache(restaurantId: string): Promise<void> {
  await redis.del(menuCacheKey(restaurantId));
}

/**
 * Phase 20 — a canonical (business-level) menu edit affects every location under that business,
 * unlike a location-level override edit (which only ever needs invalidateMenuCache for its own
 * restaurantId). The cache key shape itself is unchanged — still one key per location — this just
 * fans an invalidation out to every location that inherits from the edited canonical menu, via one
 * indexed lookup of that business's Restaurant ids. Not yet called from any live route this
 * session (canonical write endpoints are Phase 21) — built and unit-tested ahead of that cutover.
 */
export async function invalidateMenuCacheForBusiness(businessId: string): Promise<void> {
  const locations = await Restaurant.find({ businessId }).select("_id");
  if (locations.length === 0) return;
  await redis.del(...locations.map((l) => menuCacheKey(l.id)));
}
