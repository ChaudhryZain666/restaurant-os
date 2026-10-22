import { Router } from "express";
import {
  createSubscriptionSchema,
  linkFoodpandaIntegrationSchema,
  listPlatformRestaurantsQuerySchema,
  listPlatformUsersQuerySchema,
  paginationQuerySchema,
  updateRestaurantStatusSchema,
  updateUserStatusSchema,
} from "@restaurant/validation";
import { asyncHandler } from "../utils/asyncHandler.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { requirePermission } from "../middleware/rbac.js";
import { validateBody, validateQuery } from "../middleware/validate.js";
import { inviteResendLimiter } from "../middleware/inviteResendLimiter.js";
import {
  getPlatformAnalytics,
  getPlatformConfig,
  getPlatformOverview,
  getPlatformRestaurantDetail,
  getPlatformRevenue,
  linkFoodpandaIntegration,
  listPlatformAgencies,
  listPlatformRestaurants,
  listPlatformSubscriptions,
  listPlatformUsers,
  resendOwnerInvite,
  updateRestaurantStatus,
  updateUserStatus,
} from "../controllers/platform.controller.js";
import {
  assignAgencyPlanHandler,
  assignBusinessPlanHandler,
  listPlatformPlans,
} from "../controllers/platformSubscription.controller.js";

/** Cross-tenant platform-admin views — not restaurant-scoped. Mounted at /platform. */
export const platformRouter = Router();

platformRouter.use(requireAuth, requireRole("platform_admin"));
platformRouter.get("/overview", requirePermission("platform.restaurants.manage"), asyncHandler(getPlatformOverview));
platformRouter.get(
  "/restaurants",
  requirePermission("platform.restaurants.manage"),
  validateQuery(listPlatformRestaurantsQuerySchema),
  asyncHandler(listPlatformRestaurants)
);
platformRouter.get(
  "/restaurants/:id",
  requirePermission("platform.restaurants.manage"),
  asyncHandler(getPlatformRestaurantDetail)
);
platformRouter.patch(
  "/restaurants/:id/status",
  requirePermission("platform.restaurants.manage"),
  validateBody(updateRestaurantStatusSchema),
  asyncHandler(updateRestaurantStatus)
);
platformRouter.post(
  "/restaurants/:id/resend-owner-invite",
  inviteResendLimiter,
  requirePermission("platform.restaurants.manage"),
  asyncHandler(resendOwnerInvite)
);
platformRouter.post(
  "/restaurants/:id/marketplace-integrations/foodpanda/link",
  requirePermission("platform.restaurants.manage"),
  validateBody(linkFoodpandaIntegrationSchema),
  asyncHandler(linkFoodpandaIntegration)
);
platformRouter.get(
  "/subscriptions",
  requirePermission("platform.restaurants.manage"),
  validateQuery(paginationQuerySchema),
  asyncHandler(listPlatformSubscriptions)
);
// Lane A — assign an existing eligible plan (public or client-specific) as a no-card trial, through
// the same lifecycle service owners use. See platformSubscription.controller.ts.
platformRouter.get("/plans", requirePermission("platform.restaurants.manage"), asyncHandler(listPlatformPlans));
platformRouter.post(
  "/businesses/:businessId/subscription",
  requirePermission("platform.restaurants.manage"),
  validateBody(createSubscriptionSchema),
  asyncHandler(assignBusinessPlanHandler)
);
platformRouter.post(
  "/agencies/:agencyId/subscription",
  requirePermission("platform.restaurants.manage"),
  validateBody(createSubscriptionSchema),
  asyncHandler(assignAgencyPlanHandler)
);
platformRouter.get(
  "/agencies",
  requirePermission("platform.restaurants.manage"),
  validateQuery(paginationQuerySchema),
  asyncHandler(listPlatformAgencies)
);
platformRouter.get("/revenue", requirePermission("platform.restaurants.manage"), asyncHandler(getPlatformRevenue));
platformRouter.get("/analytics", requirePermission("platform.restaurants.manage"), asyncHandler(getPlatformAnalytics));
platformRouter.get("/config", requirePermission("platform.restaurants.manage"), asyncHandler(getPlatformConfig));
platformRouter.get(
  "/users",
  requirePermission("platform.users.manage"),
  validateQuery(listPlatformUsersQuerySchema),
  asyncHandler(listPlatformUsers)
);
platformRouter.patch(
  "/users/:id/status",
  requirePermission("platform.users.manage"),
  validateBody(updateUserStatusSchema),
  asyncHandler(updateUserStatus)
);
