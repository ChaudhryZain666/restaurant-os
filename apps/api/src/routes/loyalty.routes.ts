import { Router } from "express";
import { loyaltyRewardSchema, updateLoyaltyRewardSchema } from "@restaurant/validation";
import { asyncHandler } from "../utils/asyncHandler.js";
import { requireAuth } from "../middleware/auth.js";
import { requirePermission } from "../middleware/rbac.js";
import { requireTenantMatch } from "../middleware/tenant.js";
import { validateBody } from "../middleware/validate.js";
import { getLoyaltySummary, getMyLoyaltyAccount, getMyLoyaltyHistory } from "../controllers/loyalty.controller.js";
import {
  createLoyaltyReward,
  deleteLoyaltyReward,
  listActiveLoyaltyRewards,
  listAllLoyaltyRewards,
  updateLoyaltyReward,
} from "../controllers/loyaltyReward.controller.js";

/** Mounted at /restaurants/:restaurantId/loyalty — mergeParams is required to see :restaurantId. */
export const loyaltyRouter = Router({ mergeParams: true });

loyaltyRouter.use(requireAuth);
loyaltyRouter.get("/me", asyncHandler(getMyLoyaltyAccount));
loyaltyRouter.get("/me/history", asyncHandler(getMyLoyaltyHistory));

// Phase 28 — the customer-facing reward catalog. Public to any authenticated customer, same
// posture as /me — restaurant-scoped, never cross-tenant (requireTenantMatch not needed here since
// the query itself is already scoped to :restaurantId and returns only active rewards, nothing
// sensitive).
loyaltyRouter.get("/rewards", asyncHandler(listActiveLoyaltyRewards));

// Restaurant-wide aggregate, not identity-scoped like /me — only the owner/manager may see it.
loyaltyRouter.get(
  "/summary",
  requireTenantMatch(),
  requirePermission("restaurant.analytics.read"),
  asyncHandler(getLoyaltySummary)
);

// Reward catalog management — owner/manager only.
loyaltyRouter.get(
  "/rewards/admin",
  requireTenantMatch(),
  requirePermission("restaurant.loyalty.manage"),
  asyncHandler(listAllLoyaltyRewards)
);
loyaltyRouter.post(
  "/rewards",
  requireTenantMatch(),
  requirePermission("restaurant.loyalty.manage"),
  validateBody(loyaltyRewardSchema),
  asyncHandler(createLoyaltyReward)
);
loyaltyRouter.patch(
  "/rewards/:rewardId",
  requireTenantMatch(),
  requirePermission("restaurant.loyalty.manage"),
  validateBody(updateLoyaltyRewardSchema),
  asyncHandler(updateLoyaltyReward)
);
loyaltyRouter.delete(
  "/rewards/:rewardId",
  requireTenantMatch(),
  requirePermission("restaurant.loyalty.manage"),
  asyncHandler(deleteLoyaltyReward)
);
