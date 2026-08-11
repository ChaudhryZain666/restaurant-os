import { redis } from "../config/redis.js";

export const MENU_CACHE_TTL_SECONDS = 60;

export function menuCacheKey(restaurantId: string): string {
  return `menu:${restaurantId}:available`;
}

/** Categories and menu items are cached together under one key — either changing invalidates it. */
export async function invalidateMenuCache(restaurantId: string): Promise<void> {
  await redis.del(menuCacheKey(restaurantId));
}
