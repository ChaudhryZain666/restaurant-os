import type { Request, Response } from "express";
import { Types } from "mongoose";
import { LoyaltyAccount, LoyaltyTransaction } from "../models/LoyaltyAccount.js";
import { getOrCreateAccount } from "../services/loyalty.service.js";
import { User } from "../models/User.js";
import { sendSuccess } from "../common/response.js";

export async function getMyLoyaltyAccount(req: Request, res: Response) {
  const { restaurantId } = req.params;
  const account = await getOrCreateAccount(restaurantId, req.user!.id);
  sendSuccess(res, { account: account.toJSON() });
}

export async function getMyLoyaltyHistory(req: Request, res: Response) {
  const { restaurantId } = req.params;
  const transactions = await LoyaltyTransaction.find({ restaurantId, customerId: req.user!.id }).sort({
    createdAt: -1,
  });
  sendSuccess(res, { transactions: transactions.map((t) => t.toJSON()) });
}

/**
 * Restaurant-wide loyalty aggregation for the owner dashboard. Real data only — every number here
 * comes from LoyaltyAccount/LoyaltyTransaction documents that already exist because a customer
 * actually earned or redeemed points on a real order; nothing is estimated or fabricated.
 */
export async function getLoyaltySummary(req: Request, res: Response) {
  const { restaurantId } = req.params;

  const accounts = await LoyaltyAccount.find({ restaurantId }).sort({ pointsBalance: -1 });
  const totalMembers = accounts.length;
  const activeMembers = accounts.filter((a) => a.pointsBalance > 0).length;

  const tierDistribution = { bronze: 0, silver: 0, gold: 0 };
  for (const account of accounts) {
    tierDistribution[account.tier as "bronze" | "silver" | "gold"] += 1;
  }

  const restaurantObjectId = new Types.ObjectId(restaurantId);
  const [issued, redeemed] = await Promise.all([
    LoyaltyTransaction.aggregate([
      { $match: { restaurantId: restaurantObjectId, type: "earn" } },
      { $group: { _id: null, total: { $sum: "$points" } } },
    ]),
    LoyaltyTransaction.aggregate([
      { $match: { restaurantId: restaurantObjectId, type: "redeem" } },
      { $group: { _id: null, total: { $sum: "$points" } } },
    ]),
  ]);
  const totalPointsIssued = issued[0]?.total ?? 0;
  // redeem transactions store points as a negative delta (loyalty.service.ts's redeemPoints) —
  // flip the sign so "points redeemed" reads as a positive count.
  const totalPointsRedeemed = Math.abs(redeemed[0]?.total ?? 0);

  const topAccounts = accounts.slice(0, 5);
  const recentTransactions = await LoyaltyTransaction.find({ restaurantId }).sort({ createdAt: -1 }).limit(10);

  const customerIds = [
    ...new Set([
      ...topAccounts.map((a) => a.customerId.toString()),
      ...recentTransactions.map((t) => t.customerId.toString()),
    ]),
  ];
  const users = await User.find({ _id: { $in: customerIds } }).select("name");
  const nameById = new Map(users.map((u) => [u.id as string, u.name]));

  sendSuccess(res, {
    summary: {
      totalMembers,
      activeMembers,
      totalPointsIssued,
      totalPointsRedeemed,
      tierDistribution,
      topCustomers: topAccounts.map((a) => ({
        customerId: a.customerId.toString(),
        customerName: nameById.get(a.customerId.toString()) ?? "Unknown customer",
        pointsBalance: a.pointsBalance,
        tier: a.tier,
      })),
      recentActivity: recentTransactions.map((t) => ({
        id: t.id as string,
        customerName: nameById.get(t.customerId.toString()) ?? "Unknown customer",
        type: t.type as "earn" | "redeem" | "adjustment",
        points: t.points as number,
        reason: t.reason as string,
        createdAt: (t.createdAt as Date).toISOString(),
      })),
    },
  });
}
