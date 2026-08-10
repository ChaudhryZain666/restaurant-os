import type { Request, Response } from "express";
import { LoyaltyTransaction } from "../models/LoyaltyAccount.js";
import { getOrCreateAccount } from "../services/loyalty.service.js";

export async function getMyLoyaltyAccount(req: Request, res: Response) {
  const account = await getOrCreateAccount(req.user!.id);
  res.json({ account });
}

export async function getMyLoyaltyHistory(req: Request, res: Response) {
  const transactions = await LoyaltyTransaction.find({ customerId: req.user!.id }).sort({
    createdAt: -1,
  });
  res.json({ transactions });
}
