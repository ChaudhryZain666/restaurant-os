import type { Request, Response } from "express";
import { LoyaltyTransaction } from "../models/LoyaltyAccount.js";
import { getOrCreateAccount } from "../services/loyalty.service.js";
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
