export type PromotionType = "percentage" | "fixed";

/**
 * Phase 23 — a promotion is EITHER location-scoped (`restaurantId` set, `businessId`/`locationIds`
 * unset — the original shape) OR business-scoped (`businessId` + `locationIds` set, `restaurantId`
 * unset). `scope` is only present on the combined GET /restaurants/:restaurantId/promotions list
 * (Phase 23), which tags each row so a location admin can tell what they're looking at — it's not
 * a stored field, just a read-time label.
 */
export interface Promotion {
  id: string;
  restaurantId?: string;
  businessId?: string;
  locationIds?: string[];
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
  scope?: "location" | "business";
}

export interface PromoValidationResult {
  valid: boolean;
  reason?: string;
  discount?: number;
  promotion?: Pick<Promotion, "code" | "name" | "type" | "value">;
}
