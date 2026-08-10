import type { Request, Response } from "express";
import type { MenuItemInput } from "@restaurant/validation";
import { MenuItem } from "../models/MenuItem.js";
import { redis } from "../config/redis.js";
import { ApiError } from "../utils/ApiError.js";
import { sendSuccess } from "../common/response.js";

const MENU_CACHE_TTL_SECONDS = 60;

function menuCacheKey(restaurantId: string) {
  return `menu:${restaurantId}:available`;
}

export async function listMenu(req: Request, res: Response) {
  const { restaurantId } = req.params;
  const cacheKey = menuCacheKey(restaurantId);

  const cached = await redis.get(cacheKey);
  if (cached) {
    return sendSuccess(res, { items: JSON.parse(cached), cached: true });
  }

  const docs = await MenuItem.find({ restaurantId, isAvailable: true }).sort({ category: 1, name: 1 });
  const items = docs.map((doc) => doc.toJSON());
  await redis.set(cacheKey, JSON.stringify(items), "EX", MENU_CACHE_TTL_SECONDS);
  return sendSuccess(res, { items, cached: false });
}

export async function createMenuItem(req: Request, res: Response) {
  const { restaurantId } = req.params;
  const body = req.body as MenuItemInput;
  const item = await MenuItem.create({ ...body, restaurantId });
  await redis.del(menuCacheKey(restaurantId));
  sendSuccess(res, { item: item.toJSON() }, 201);
}

export async function updateMenuItem(req: Request, res: Response) {
  const { restaurantId, id } = req.params;
  const item = await MenuItem.findOneAndUpdate({ _id: id, restaurantId }, req.body, { new: true });
  if (!item) throw ApiError.notFound("Menu item not found");
  await redis.del(menuCacheKey(restaurantId));
  sendSuccess(res, { item: item.toJSON() });
}

export async function deleteMenuItem(req: Request, res: Response) {
  const { restaurantId, id } = req.params;
  const item = await MenuItem.findOneAndDelete({ _id: id, restaurantId });
  if (!item) throw ApiError.notFound("Menu item not found");
  await redis.del(menuCacheKey(restaurantId));
  res.status(204).send();
}
