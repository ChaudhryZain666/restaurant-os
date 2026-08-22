import { Router } from "express";
import { asyncHandler } from "../utils/asyncHandler.js";
import { requireAuth } from "../middleware/auth.js";
import { requirePermission } from "../middleware/rbac.js";
import { requireTenantMatch } from "../middleware/tenant.js";
import { getAnalytics, getAnalyticsTimeSeries } from "../controllers/analytics.controller.js";

/** Mounted at /restaurants/:restaurantId/analytics — a separate resource from orders, gated by
 *  its own restaurant.analytics.read permission (owner/manager only, not staff/kitchen_staff). */
export const analyticsRouter = Router({ mergeParams: true });

analyticsRouter.use(requireAuth, requireTenantMatch(), requirePermission("restaurant.analytics.read"));
analyticsRouter.get("/", asyncHandler(getAnalytics));
analyticsRouter.get("/timeseries", asyncHandler(getAnalyticsTimeSeries));
