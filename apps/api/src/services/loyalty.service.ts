import { ClientSession, Types } from "mongoose";
import { LoyaltyAccount, LoyaltyTransaction } from "../models/LoyaltyAccount.js";
import { ApiError } from "../utils/ApiError.js";

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

export async function getOrCreateAccount(restaurantId: string, customerId: string) {
  const existing = await LoyaltyAccount.findOne({
    restaurantId: new Types.ObjectId(restaurantId),
    customerId: new Types.ObjectId(customerId),
  });
  if (existing) return existing;
  return LoyaltyAccount.create({ restaurantId, customerId });
}
