import type { Request, Response } from "express";
import type { LoyaltyRewardInput, UpdateLoyaltyRewardInput } from "@restaurant/validation";
import { LoyaltyReward } from "../models/LoyaltyReward.js";
import { ApiError } from "../utils/ApiError.js";
import { sendSuccess } from "../common/response.js";

/** GET /restaurants/:restaurantId/loyalty/rewards — public (any authenticated customer), active
 *  rewards only. The customer-facing browse list. */
export async function listActiveLoyaltyRewards(req: Request, res: Response) {
  const { restaurantId } = req.params;
  const rewards = await LoyaltyReward.find({ restaurantId, isActive: true }).sort({ pointCost: 1 });
  sendSuccess(res, { rewards: rewards.map((r) => r.toJSON()) });
}

/** GET /restaurants/:restaurantId/loyalty/rewards/admin — owner/manager management view, every
 *  reward including inactive ones. */
export async function listAllLoyaltyRewards(req: Request, res: Response) {
  const { restaurantId } = req.params;
  const rewards = await LoyaltyReward.find({ restaurantId }).sort({ createdAt: -1 });
  sendSuccess(res, { rewards: rewards.map((r) => r.toJSON()) });
}

export async function createLoyaltyReward(req: Request, res: Response) {
  const { restaurantId } = req.params;
  const body = req.body as LoyaltyRewardInput;
  const reward = await LoyaltyReward.create({ restaurantId, ...body });
  sendSuccess(res, { reward: reward.toJSON() }, 201);
}

export async function updateLoyaltyReward(req: Request, res: Response) {
  const { restaurantId, rewardId } = req.params;
  const body = req.body as UpdateLoyaltyRewardInput;
  const reward = await LoyaltyReward.findOneAndUpdate({ _id: rewardId, restaurantId }, { $set: body }, { new: true });
  if (!reward) throw ApiError.notFound("Reward not found");
  sendSuccess(res, { reward: reward.toJSON() });
}

export async function deleteLoyaltyReward(req: Request, res: Response) {
  const { restaurantId, rewardId } = req.params;
  const reward = await LoyaltyReward.findOneAndDelete({ _id: rewardId, restaurantId });
  if (!reward) throw ApiError.notFound("Reward not found");
  sendSuccess(res, { message: "Reward deleted." });
}
