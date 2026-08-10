import type { Request, Response } from "express";
import { z } from "zod";
import { MenuItem } from "../models/MenuItem.js";
import { redis } from "../config/redis.js";
import { ApiError } from "../utils/ApiError.js";

const MENU_CACHE_KEY = "menu:available";
const MENU_CACHE_TTL_SECONDS = 60;

export const menuItemSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(1000).optional(),
  price: z.number().nonnegative(),
  category: z.string().min(1).max(60),
  imageUrl: z.string().url().optional(),
  isAvailable: z.boolean().optional(),
});

export async function listMenu(_req: Request, res: Response) {
  const cached = await redis.get(MENU_CACHE_KEY);
  if (cached) {
    return res.json({ items: JSON.parse(cached), cached: true });
  }

  const docs = await MenuItem.find({ isAvailable: true }).sort({ category: 1, name: 1 });
  const items = docs.map((doc) => doc.toJSON());
  await redis.set(MENU_CACHE_KEY, JSON.stringify(items), "EX", MENU_CACHE_TTL_SECONDS);
  return res.json({ items, cached: false });
}

export async function createMenuItem(req: Request, res: Response) {
  const item = await MenuItem.create(req.body);
  await redis.del(MENU_CACHE_KEY);
  res.status(201).json({ item });
}

export async function updateMenuItem(req: Request, res: Response) {
  const item = await MenuItem.findByIdAndUpdate(req.params.id, req.body, { new: true });
  if (!item) throw ApiError.notFound("Menu item not found");
  await redis.del(MENU_CACHE_KEY);
  res.json({ item });
}

export async function deleteMenuItem(req: Request, res: Response) {
  const item = await MenuItem.findByIdAndDelete(req.params.id);
  if (!item) throw ApiError.notFound("Menu item not found");
  await redis.del(MENU_CACHE_KEY);
  res.status(204).send();
}
