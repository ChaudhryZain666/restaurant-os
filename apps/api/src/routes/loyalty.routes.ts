import { Router } from "express";
import { asyncHandler } from "../utils/asyncHandler.js";
import { requireAuth } from "../middleware/auth.js";
import { requirePermission } from "../middleware/rbac.js";
import { requireTenantMatch } from "../middleware/tenant.js";
import { getLoyaltySummary, getMyLoyaltyAccount, getMyLoyaltyHistory } from "../controllers/loyalty.controller.js";

/** Mounted at /restaurants/:restaurantId/loyalty — mergeParams is required to see :restaurantId. */
export const loyaltyRouter = Router({ mergeParams: true });

loyaltyRouter.use(requireAuth);
loyaltyRouter.get("/me", asyncHandler(getMyLoyaltyAccount));
loyaltyRouter.get("/me/history", asyncHandler(getMyLoyaltyHistory));

// Restaurant-wide aggregate, not identity-scoped like /me — only the owner/manager may see it.
loyaltyRouter.get(
  "/summary",
  requireTenantMatch(),
  requirePermission("restaurant.analytics.read"),
  asyncHandler(getLoyaltySummary)
);
