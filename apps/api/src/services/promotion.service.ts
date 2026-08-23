import type { ClientSession } from "mongoose";
import { Promotion, type PromotionDoc } from "../models/Promotion.js";
import { ApiError } from "../utils/ApiError.js";

function roundCurrency(amount: number): number {
  return Math.round(amount * 100) / 100;
}

/**
 * The single source of truth for whether a promo code applies and how much it's worth — used by
 * both the customer-facing "check my code" preview and createOrder itself, so a code can never be
 * accepted at preview time and rejected (or priced differently) when the order is actually placed.
 * Throws ApiError.badRequest with a customer-facing reason on any invalid/inapplicable code.
 *
 * Phase 23 — `businessId` (optional, the order's own restaurant.businessId, already loaded at the
 * one real call site so this costs no extra query) makes the lookup resolve BOTH a location
 * promotion (restaurantId matches directly, unchanged from before this phase) AND a business
 * promotion (businessId matches AND `locationIds` contains this specific restaurantId — an exact
 * membership check, not "any location of the same business"). A business promotion targeting
 * Location A must never resolve at Location B of the same business: the `locationIds: restaurantId`
 * clause is what enforces that, and it's tested explicitly (promotion.controller.test.ts).
 */
export async function validatePromoCode(
  restaurantId: string,
  rawCode: string,
  subtotal: number,
  businessId?: string
): Promise<{ promotion: PromotionDoc & { id: string }; discount: number }> {
  const code = rawCode.trim().toUpperCase();
  const promotion = await Promotion.findOne({
    code,
    $or: [
      { restaurantId },
      ...(businessId ? [{ businessId, locationIds: restaurantId }] : []),
    ],
  });
  if (!promotion) throw ApiError.badRequest("Invalid promo code");
  if (!promotion.isActive) throw ApiError.badRequest("This promo code is no longer active");

  const now = new Date();
  if (promotion.startDate && now < promotion.startDate) {
    throw ApiError.badRequest("This promo code isn't active yet");
  }
  if (promotion.endDate && now > promotion.endDate) {
    throw ApiError.badRequest("This promo code has expired");
  }
  if (promotion.usageLimit !== undefined && promotion.usageLimit !== null && promotion.usageCount >= promotion.usageLimit) {
    throw ApiError.badRequest("This promo code has reached its usage limit");
  }
  if (subtotal < promotion.minOrderAmount) {
    throw ApiError.badRequest(`This promo code requires a minimum order of ${promotion.minOrderAmount}`);
  }

  const discount =
    promotion.type === "percentage"
      ? roundCurrency(subtotal * (promotion.value / 100))
      : Math.min(promotion.value, subtotal);

  return { promotion: promotion as PromotionDoc & { id: string }, discount };
}

/**
 * Increments usageCount only if the limit hasn't already been reached — the filter itself is the
 * guard, re-checked atomically by MongoDB at write time, not just at validatePromoCode's earlier
 * read. Two concurrent orders that both passed validatePromoCode's read-only check (a genuine
 * TOCTOU window — that read happens before this codebase's transaction even starts) can no longer
 * both increment past usageLimit: only requests that still find the condition true when MongoDB
 * actually applies the write get modifiedCount 1. The loser gets false back and must abort its
 * order transaction rather than silently oversubscribing the promo.
 */
export async function recordPromoUsage(promotionId: string, session?: ClientSession): Promise<boolean> {
  const result = await Promotion.updateOne(
    {
      _id: promotionId,
      $or: [{ usageLimit: { $exists: false } }, { usageLimit: null }, { $expr: { $lt: ["$usageCount", "$usageLimit"] } }],
    },
    { $inc: { usageCount: 1 } },
    { session }
  );
  return result.modifiedCount === 1;
}
