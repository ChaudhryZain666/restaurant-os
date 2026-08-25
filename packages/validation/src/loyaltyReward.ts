import { z } from "zod";

export const loyaltyRewardSchema = z.object({
  name: z.string().min(2).max(80),
  description: z.string().max(300).optional(),
  pointCost: z.number().int().positive(),
  isActive: z.boolean().default(true),
});
export type LoyaltyRewardInput = z.infer<typeof loyaltyRewardSchema>;

export const updateLoyaltyRewardSchema = loyaltyRewardSchema.partial();
export type UpdateLoyaltyRewardInput = z.infer<typeof updateLoyaltyRewardSchema>;
