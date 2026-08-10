export type LoyaltyTransactionType = "earn" | "redeem" | "adjustment";

export interface LoyaltyAccount {
  id: string;
  restaurantId: string;
  customerId: string;
  pointsBalance: number;
  tier: "bronze" | "silver" | "gold";
}

export interface LoyaltyTransaction {
  id: string;
  restaurantId: string;
  customerId: string;
  orderId?: string;
  type: LoyaltyTransactionType;
  points: number;
  reason: string;
  createdAt: string;
}
