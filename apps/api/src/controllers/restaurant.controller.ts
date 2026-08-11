import type { Request, Response } from "express";
import type { CreateRestaurantInput, UpdateRestaurantInput } from "@restaurant/validation";
import { Restaurant } from "../models/Restaurant.js";
import { User } from "../models/User.js";
import { ApiError } from "../utils/ApiError.js";
import { sendSuccess } from "../common/response.js";
import { computeAvailability } from "../services/restaurantAvailability.service.js";

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
  sendSuccess(res, { restaurant: restaurant.toJSON(), availability: computeAvailability(restaurant.settings) });
}

export async function getMyRestaurant(req: Request, res: Response) {
  if (!req.user?.restaurantId) throw ApiError.notFound("You are not associated with a restaurant");
  const restaurant = await Restaurant.findById(req.user.restaurantId);
  if (!restaurant) throw ApiError.notFound("Restaurant not found");
  sendSuccess(res, { restaurant: restaurant.toJSON(), availability: computeAvailability(restaurant.settings) });
}

/**
 * Builds a dot-notation $set document so a partial `settings` update only touches the fields
 * actually supplied — a plain `{ $set: { settings: partialInput } }` would replace the whole
 * settings subdocument, silently wiping out every setting the caller didn't mention.
 */
function buildRestaurantUpdateSet(input: UpdateRestaurantInput): Record<string, unknown> {
  const { settings, ...profileFields } = input;
  const set: Record<string, unknown> = { ...profileFields };
  if (settings) {
    for (const [key, value] of Object.entries(settings)) {
      if (value !== undefined) set[`settings.${key}`] = value;
    }
  }
  return set;
}

export async function updateRestaurant(req: Request, res: Response) {
  const { restaurantId } = req.params;
  const updates = req.body as UpdateRestaurantInput;

  const restaurant = await Restaurant.findByIdAndUpdate(
    restaurantId,
    { $set: buildRestaurantUpdateSet(updates) },
    { new: true, runValidators: true }
  );
  if (!restaurant) throw ApiError.notFound("Restaurant not found");
  sendSuccess(res, { restaurant: restaurant.toJSON(), availability: computeAvailability(restaurant.settings) });
}
