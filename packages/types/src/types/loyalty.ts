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

export interface LoyaltyTopCustomer {
  customerId: string;
  customerName: string;
  pointsBalance: number;
  tier: "bronze" | "silver" | "gold";
}

export interface LoyaltyActivityEntry {
  id: string;
  customerName: string;
  type: LoyaltyTransactionType;
  points: number;
  reason: string;
  createdAt: string;
}

/** Restaurant-wide loyalty aggregation shown on the owner's Loyalty dashboard. */
export interface LoyaltySummary {
  totalMembers: number;
  activeMembers: number;
  totalPointsIssued: number;
  totalPointsRedeemed: number;
  tierDistribution: { bronze: number; silver: number; gold: number };
  topCustomers: LoyaltyTopCustomer[];
  recentActivity: LoyaltyActivityEntry[];
}
