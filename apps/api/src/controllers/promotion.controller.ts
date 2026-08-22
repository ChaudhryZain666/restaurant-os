import type { Request, Response } from "express";
import type { PromotionInput, UpdatePromotionInput, ValidatePromoInput } from "@restaurant/validation";
import { Promotion } from "../models/Promotion.js";
import { ApiError } from "../utils/ApiError.js";
import { sendSuccess } from "../common/response.js";
import { validatePromoCode } from "../services/promotion.service.js";

export async function listPromotions(req: Request, res: Response) {
  const { restaurantId } = req.params;
  const promotions = await Promotion.find({ restaurantId }).sort({ createdAt: -1 });
  sendSuccess(res, { promotions: promotions.map((p) => p.toJSON()) });
}

export async function createPromotion(req: Request, res: Response) {
  const { restaurantId } = req.params;
  const body = req.body as PromotionInput;

  const existing = await Promotion.findOne({ restaurantId, code: body.code });
  if (existing) throw ApiError.conflict("A promotion with this code already exists");

  const promotion = await Promotion.create({ ...body, restaurantId });
  sendSuccess(res, { promotion: promotion.toJSON() }, 201);
}

export async function updatePromotion(req: Request, res: Response) {
  const { restaurantId, id } = req.params;
  const updates = req.body as UpdatePromotionInput;

  if (updates.code) {
    const existing = await Promotion.findOne({ restaurantId, code: updates.code, _id: { $ne: id } });
    if (existing) throw ApiError.conflict("A promotion with this code already exists");
  }

  const promotion = await Promotion.findOneAndUpdate(
    { _id: id, restaurantId },
    { $set: updates },
    { new: true, runValidators: true }
  );
  if (!promotion) throw ApiError.notFound("Promotion not found");
  sendSuccess(res, { promotion: promotion.toJSON() });
}

export async function deletePromotion(req: Request, res: Response) {
  const { restaurantId, id } = req.params;
  const promotion = await Promotion.findOneAndDelete({ _id: id, restaurantId });
  if (!promotion) throw ApiError.notFound("Promotion not found");
  res.status(204).send();
}

/**
 * Customer-facing "check my code" — read-only, never mutates usageCount (that only happens once
 * an order is actually placed, in order.controller.ts's createOrder, via the same
 * validatePromoCode call). Lets the cart show a discount before checkout without ever letting the
 * client dictate what that discount actually is.
 */
export async function checkPromoCode(req: Request, res: Response) {
  const { restaurantId } = req.params;
  const { code, subtotal } = req.body as ValidatePromoInput;

  try {
    const { promotion, discount } = await validatePromoCode(restaurantId, code, subtotal);
    sendSuccess(res, {
      valid: true,
      discount,
      promotion: { code: promotion.code, name: promotion.name, type: promotion.type, value: promotion.value },
    });
  } catch (err) {
    const reason = err instanceof ApiError ? err.message : "Invalid promo code";
    sendSuccess(res, { valid: false, reason });
  }
}
