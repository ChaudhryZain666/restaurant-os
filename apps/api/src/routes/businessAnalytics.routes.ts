import { Router } from "express";
import { asyncHandler } from "../utils/asyncHandler.js";
import { requireAuth } from "../middleware/auth.js";
import { requirePermission } from "../middleware/rbac.js";
import { requireBusinessMatch } from "../middleware/businessLocation.js";
import { getBusinessOverview, getBusinessProducts, getBusinessTrends } from "../controllers/businessAnalytics.controller.js";

/** Mounted at /businesses/:businessId/analytics — reuses restaurant.analytics.read (already
 *  owner+manager, not staff/kitchen_staff/platform_admin), the same permission that already gates
 *  the single-location analytics page, rather than inventing a business-specific one. */
export const businessAnalyticsRouter = Router({ mergeParams: true });

businessAnalyticsRouter.use(requireAuth, requireBusinessMatch(), requirePermission("restaurant.analytics.read"));
businessAnalyticsRouter.get("/overview", asyncHandler(getBusinessOverview));
businessAnalyticsRouter.get("/trends", asyncHandler(getBusinessTrends));
businessAnalyticsRouter.get("/products", asyncHandler(getBusinessProducts));
