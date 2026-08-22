export type PromotionType = "percentage" | "fixed";

export interface Promotion {
  id: string;
  restaurantId: string;
  code: string;
  name: string;
  type: PromotionType;
  value: number;
  minOrderAmount: number;
  isActive: boolean;
  startDate?: string;
  endDate?: string;
  usageLimit?: number;
  usageCount: number;
  createdAt: string;
}

export interface PromoValidationResult {
  valid: boolean;
  reason?: string;
  discount?: number;
  promotion?: Pick<Promotion, "code" | "name" | "type" | "value">;
}
