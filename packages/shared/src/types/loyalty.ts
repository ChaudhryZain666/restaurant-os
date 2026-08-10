export type LoyaltyTransactionType = "earn" | "redeem" | "adjustment";

export interface LoyaltyAccount {
  id: string;
  customerId: string;
  pointsBalance: number;
  tier: "bronze" | "silver" | "gold";
}

export interface LoyaltyTransaction {
  id: string;
  customerId: string;
  orderId?: string;
  type: LoyaltyTransactionType;
  points: number;
  reason: string;
  createdAt: string;
}
