import { Router } from "express";
import { asyncHandler } from "../utils/asyncHandler.js";
import { requireAuth } from "../middleware/auth.js";
import { requireBusinessMatch, requireBusinessPermission as requirePermission } from "../middleware/businessLocation.js";
import { requireEntitlement } from "../services/entitlementLimit.service.js";
import { getBusinessOverview, getBusinessProducts, getBusinessTrends } from "../controllers/businessAnalytics.controller.js";

/** Mounted at /businesses/:businessId/analytics — reuses restaurant.analytics.read (already
 *  owner+manager, not staff/kitchen_staff/platform_admin), the same permission that already gates
 *  the single-location analytics page, rather than inventing a business-specific one. Phase 27 —
 *  also gated on the business_analytics plan entitlement (the first real enforcement of an
 *  entitlement that has existed as inert Plan data since Phase 24). */
export const businessAnalyticsRouter = Router({ mergeParams: true });

businessAnalyticsRouter.use(
  requireAuth,
  requireBusinessMatch(),
  requirePermission("restaurant.analytics.read"),
  requireEntitlement("business_analytics")
);
businessAnalyticsRouter.get("/overview", asyncHandler(getBusinessOverview));
businessAnalyticsRouter.get("/trends", asyncHandler(getBusinessTrends));
businessAnalyticsRouter.get("/products", asyncHandler(getBusinessProducts));
