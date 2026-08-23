import { Router } from "express";
import {
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
import {
  getPlatformOverview,
  getPlatformRestaurantDetail,
  listPlatformAgencies,
  listPlatformRestaurants,
  listPlatformSubscriptions,
  listPlatformUsers,
  resendOwnerInvite,
  updateRestaurantStatus,
  updateUserStatus,
} from "../controllers/platform.controller.js";

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
  requirePermission("platform.restaurants.manage"),
  asyncHandler(resendOwnerInvite)
);
platformRouter.get(
  "/subscriptions",
  requirePermission("platform.restaurants.manage"),
  validateQuery(paginationQuerySchema),
  asyncHandler(listPlatformSubscriptions)
);
platformRouter.get(
  "/agencies",
  requirePermission("platform.restaurants.manage"),
  validateQuery(paginationQuerySchema),
  asyncHandler(listPlatformAgencies)
);
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
