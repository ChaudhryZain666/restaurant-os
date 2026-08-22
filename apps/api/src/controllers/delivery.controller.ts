import type { Request, Response } from "express";
import type { CheckDeliveryInput } from "@restaurant/validation";
import { Restaurant } from "../models/Restaurant.js";
import { ApiError } from "../utils/ApiError.js";
import { sendSuccess } from "../common/response.js";
import { checkDeliveryEligibility } from "../services/delivery.service.js";

/**
 * Customer-facing "is my address deliverable" preview — read-only, mirrors
 * promotion.controller.ts's checkPromoCode. Lets the cart show delivery eligibility/fee before
 * checkout without the client ever supplying (or being trusted for) the distance or fee itself.
 */
export async function checkDelivery(req: Request, res: Response) {
  const { restaurantId } = req.params;
  const { latitude, longitude } = req.body as CheckDeliveryInput;

  const restaurant = await Restaurant.findOne({ _id: restaurantId, status: "active" });
  if (!restaurant) throw ApiError.notFound("Restaurant not found");

  const result = checkDeliveryEligibility(restaurant, latitude, longitude);
  sendSuccess(res, result);
}
