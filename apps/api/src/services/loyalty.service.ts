import { ClientSession, Types, type HydratedDocument } from "mongoose";
import { LoyaltyAccount, LoyaltyTransaction } from "../models/LoyaltyAccount.js";
import { Order, type OrderDoc } from "../models/Order.js";
import { ApiError } from "../utils/ApiError.js";

// Phase 17 currency-correctness review: 1 point is earned per 1 major unit of the restaurant's
// OWN configured currency spent (pointsForSpend), and 1 point redeems for exactly 1 major unit of
// discount in that SAME currency (order.controller.ts's `loyaltyDiscount = Math.min(pointsToRedeem,
// subtotal)`). Earn and redeem are symmetric and both expressed purely in the restaurant's own
// currency — nothing here assumes USD/PKR or any fixed points-per-dollar exchange rate, and a
// restaurant never mixes currencies within its own loyalty program. A JPY or PKR restaurant simply
// earns/redeems proportionally more points per order than a USD one for an equivalent-value meal,
// which is an economics/tuning question for the restaurant owner (a future per-restaurant
// points-per-unit setting, if ever wanted), not a currency-correctness bug. Conclusion: safe as-is.
const POINTS_PER_CURRENCY_UNIT = 1;
const TIER_THRESHOLDS: Array<{ tier: "bronze" | "silver" | "gold"; minPoints: number }> = [
  { tier: "gold", minPoints: 2000 },
  { tier: "silver", minPoints: 500 },
  { tier: "bronze", minPoints: 0 },
];

function tierForPoints(points: number): "bronze" | "silver" | "gold" {
  return TIER_THRESHOLDS.find((t) => points >= t.minPoints)!.tier;
}

export function pointsForSpend(subtotal: number): number {
  return Math.floor(subtotal * POINTS_PER_CURRENCY_UNIT);
}

export async function earnPoints(
  restaurantId: string,
  customerId: string,
  orderId: string,
  subtotal: number,
  session?: ClientSession
) {
  const points = pointsForSpend(subtotal);
  if (points <= 0) return 0;

  const account = await LoyaltyAccount.findOneAndUpdate(
    { restaurantId, customerId },
    { $inc: { pointsBalance: points } },
    { new: true, upsert: true, session }
  );
  account.tier = tierForPoints(account.pointsBalance);
  await account.save({ session });

  await LoyaltyTransaction.create(
    [{ restaurantId, customerId, orderId, type: "earn", points, reason: "Order placed" }],
    { session }
  );

  return points;
}

export async function redeemPoints(
  restaurantId: string,
  customerId: string,
  points: number,
  orderId?: string,
  session?: ClientSession
) {
  if (points <= 0) throw ApiError.badRequest("Points to redeem must be positive");

  const account = await LoyaltyAccount.findOne({ restaurantId, customerId }).session(session ?? null);
  if (!account || account.pointsBalance < points) {
    throw ApiError.badRequest("Insufficient loyalty points balance");
  }

  account.pointsBalance -= points;
  account.tier = tierForPoints(account.pointsBalance);
  await account.save({ session });

  await LoyaltyTransaction.create(
    [{ restaurantId, customerId, orderId, type: "redeem", points: -points, reason: "Redeemed on order" }],
    { session }
  );
}

/**
 * Reverses the points this order earned and refunds the points it spent — without this, a
 * customer could cancel-and-reorder to farm points indefinitely, and a refunded order would keep
 * paying out points that were never actually earned (see docs — Phase 16 loyalty audit).
 *
 * The earned-points clawback is clamped to the account's CURRENT balance rather than allowed to go
 * negative: if the customer already spent those points on a later order before this one was
 * cancelled/refunded, only what's actually left is reclaimed. A full "points debt" ledger is a
 * deliberate, documented out-of-scope trade-off, not an oversight.
 */
async function reverseLoyaltyForOrder(
  restaurantId: string,
  customerId: string,
  orderId: string,
  pointsEarned: number,
  pointsRedeemed: number,
  session?: ClientSession
) {
  const account = await LoyaltyAccount.findOne({ restaurantId, customerId }).session(session ?? null);
  if (!account) return;

  let changed = false;

  if (pointsEarned > 0) {
    const clawback = Math.min(pointsEarned, account.pointsBalance);
    if (clawback > 0) {
      account.pointsBalance -= clawback;
      changed = true;
      await LoyaltyTransaction.create(
        [
          {
            restaurantId,
            customerId,
            orderId,
            type: "adjustment",
            points: -clawback,
            reason: "Order cancelled/refunded — earned points reversed",
          },
        ],
        { session }
      );
    }
  }

  if (pointsRedeemed > 0) {
    account.pointsBalance += pointsRedeemed;
    changed = true;
    await LoyaltyTransaction.create(
      [
        {
          restaurantId,
          customerId,
          orderId,
          type: "adjustment",
          points: pointsRedeemed,
          reason: "Order cancelled/refunded — redeemed points refunded",
        },
      ],
      { session }
    );
  }

  if (changed) {
    account.tier = tierForPoints(account.pointsBalance);
    await account.save({ session });
  }
}

/**
 * Entry point callers (cancelMyOrder, updateOrderStatus, refundPayment) actually use — guards
 * reverseLoyaltyForOrder above with an atomic flip of Order.loyaltyReversed so the same order's
 * points can never be reversed twice, including under a race between (for example) a customer
 * cancelling and staff issuing a refund around the same moment. A plain "has this been reversed"
 * read-then-write would reopen exactly the kind of race this codebase has already had to fix
 * elsewhere (see auth.controller.ts's acceptInvite/resetPassword).
 */
export async function reverseLoyaltyForOrderIfNeeded(order: HydratedDocument<OrderDoc>, session?: ClientSession): Promise<void> {
  if ((order.loyaltyPointsEarned ?? 0) <= 0 && (order.loyaltyPointsRedeemed ?? 0) <= 0) return;

  const flipped = await Order.findOneAndUpdate(
    { _id: order._id, loyaltyReversed: false },
    { $set: { loyaltyReversed: true } },
    { session }
  );
  if (!flipped) return; // already reversed (or lost a race to a concurrent reversal) — nothing to do

  await reverseLoyaltyForOrder(
    order.restaurantId.toString(),
    order.customerId.toString(),
    order.id as string,
    order.loyaltyPointsEarned ?? 0,
    order.loyaltyPointsRedeemed ?? 0,
    session
  );
}

export async function getOrCreateAccount(restaurantId: string, customerId: string) {
  const existing = await LoyaltyAccount.findOne({
    restaurantId: new Types.ObjectId(restaurantId),
    customerId: new Types.ObjectId(customerId),
  });
  if (existing) return existing;
  return LoyaltyAccount.create({ restaurantId, customerId });
}
