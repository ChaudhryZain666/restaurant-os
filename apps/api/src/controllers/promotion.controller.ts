import type { Request, Response } from "express";
import type { PromotionInput, UpdatePromotionInput, ValidatePromoInput } from "@restaurant/validation";
import { Promotion } from "../models/Promotion.js";
import { Restaurant } from "../models/Restaurant.js";
import { ApiError } from "../utils/ApiError.js";
import { sendSuccess } from "../common/response.js";
import { validatePromoCode } from "../services/promotion.service.js";
import { recordAuditEvent } from "../services/audit.service.js";

/**
 * Phase 23 — also returns any business-wide promotion whose `locationIds` include this location,
 * clearly tagged `scope: "business"` alongside this location's own `scope: "location"` promotions
 * — a location admin should see everything actually affecting their storefront, not just what they
 * personally own. Business promotions are still only ever EDITED from the business-level page
 * (businessPromotion.controller.ts); this stays read-only for them.
 */
export async function listPromotions(req: Request, res: Response) {
  const { restaurantId } = req.params;
  const restaurant = await Restaurant.findById(restaurantId).select("businessId");

  const [locationPromotions, businessPromotions] = await Promise.all([
    Promotion.find({ restaurantId }).sort({ createdAt: -1 }),
    restaurant?.businessId
      ? Promotion.find({ businessId: restaurant.businessId, locationIds: restaurantId }).sort({ createdAt: -1 })
      : Promise.resolve([]),
  ]);

  const promotions = [
    ...locationPromotions.map((p) => ({ ...p.toJSON(), scope: "location" as const })),
    ...businessPromotions.map((p) => ({ ...p.toJSON(), scope: "business" as const })),
  ];
  sendSuccess(res, { promotions });
}

export async function createPromotion(req: Request, res: Response) {
  const { restaurantId } = req.params;
  const body = req.body as PromotionInput;

  const existing = await Promotion.findOne({ restaurantId, code: body.code });
  if (existing) throw ApiError.conflict("A promotion with this code already exists");

  const promotion = await Promotion.create({ ...body, restaurantId });

  await recordAuditEvent({
    restaurantId: promotion.restaurantId!,
    actorUserId: req.user!.id,
    actorRole: req.user!.role,
    action: "promotion.created",
    targetType: "promotion",
    targetId: promotion._id,
    metadata: { code: promotion.code, scope: "location" },
  });

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

  await recordAuditEvent({
    restaurantId: promotion.restaurantId!,
    actorUserId: req.user!.id,
    actorRole: req.user!.role,
    action: typeof updates.isActive === "boolean" ? (updates.isActive ? "promotion.activated" : "promotion.deactivated") : "promotion.updated",
    targetType: "promotion",
    targetId: promotion._id,
    metadata: { code: promotion.code, scope: "location" },
  });

  sendSuccess(res, { promotion: promotion.toJSON() });
}

export async function deletePromotion(req: Request, res: Response) {
  const { restaurantId, id } = req.params;
  const promotion = await Promotion.findOneAndDelete({ _id: id, restaurantId });
  if (!promotion) throw ApiError.notFound("Promotion not found");

  await recordAuditEvent({
    restaurantId: promotion.restaurantId!,
    actorUserId: req.user!.id,
    actorRole: req.user!.role,
    action: "promotion.deleted",
    targetType: "promotion",
    targetId: promotion._id,
    metadata: { code: promotion.code, scope: "location" },
  });

  res.status(204).send();
}

/**
 * Customer-facing "check my code" — read-only, never mutates usageCount (that only happens once
 * an order is actually placed, in order.controller.ts's createOrder, via the same
 * validatePromoCode call). Lets the cart show a discount before checkout without ever letting the
 * client dictate what that discount actually is. Loads the restaurant's businessId so a business
 * promotion previews identically to how it will actually validate at order time.
 */
export async function checkPromoCode(req: Request, res: Response) {
  const { restaurantId } = req.params;
  const { code, subtotal } = req.body as ValidatePromoInput;

  try {
    const restaurant = await Restaurant.findById(restaurantId).select("businessId");
    const { promotion, discount } = await validatePromoCode(restaurantId, code, subtotal, restaurant?.businessId?.toString());
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
