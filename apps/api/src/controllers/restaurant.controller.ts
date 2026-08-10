import type { Request, Response } from "express";
import type { CreateRestaurantInput } from "@restaurant/validation";
import { Restaurant } from "../models/Restaurant.js";
import { User } from "../models/User.js";
import { ApiError } from "../utils/ApiError.js";
import { sendSuccess } from "../common/response.js";

export async function createRestaurant(req: Request, res: Response) {
  const { name, slug, ownerId } = req.body as CreateRestaurantInput;

  const existingSlug = await Restaurant.findOne({ slug });
  if (existingSlug) throw ApiError.conflict("That restaurant slug is already taken");

  const owner = await User.findById(ownerId);
  if (!owner) throw ApiError.badRequest("ownerId does not reference an existing user");
  if (owner.restaurantId) throw ApiError.conflict("That user already owns a restaurant");

  const restaurant = await Restaurant.create({ name, slug, ownerId, status: "active" });
  owner.role = "restaurant_owner";
  owner.restaurantId = restaurant._id;
  await owner.save();

  sendSuccess(res, { restaurant: restaurant.toJSON() }, 201);
}

export async function getRestaurantBySlug(req: Request, res: Response) {
  const restaurant = await Restaurant.findOne({ slug: req.params.slug, status: "active" });
  if (!restaurant) throw ApiError.notFound("Restaurant not found");
  sendSuccess(res, { restaurant: restaurant.toJSON() });
}

export async function getMyRestaurant(req: Request, res: Response) {
  if (!req.user?.restaurantId) throw ApiError.notFound("You are not associated with a restaurant");
  const restaurant = await Restaurant.findById(req.user.restaurantId);
  if (!restaurant) throw ApiError.notFound("Restaurant not found");
  sendSuccess(res, { restaurant: restaurant.toJSON() });
}
