import type { NextFunction, Request, Response } from "express";
import { Restaurant } from "../models/Restaurant.js";
import { ApiError } from "../utils/ApiError.js";

/**
 * Phase 18 — additive alongside tenant.ts's requireTenantMatch, not a replacement for it. No
 * pre-Phase-18 route uses these; they guard the new /businesses routes only (routes/business.routes.ts).
 *
 * Confirms the business in the URL matches the authenticated user's own business.
 * platform_admin is exempt (manages all tenants). req.user.businessId being unset (a not-yet-
 * migrated account, or a token issued before Phase 18) is always a DENY, never a throw.
 */
export function requireBusinessMatch(paramName = "businessId") {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) return next(ApiError.unauthorized());
    if (req.user.role === "platform_admin") return next();

    const targetBusinessId = req.params[paramName];
    if (!req.user.businessId || req.user.businessId !== targetBusinessId) {
      return next(ApiError.forbidden("You do not have access to this business"));
    }
    next();
  };
}

/**
 * Confirms the authenticated user has access to the specific location (Restaurant) in the URL.
 * platform_admin is exempt. Owner/manager get access to ANY location under their own businessId
 * (one indexed lookup — the JWT only carries businessId for them, not every location id, so this
 * is a genuine cross-check, not a JWT-only claim). Staff/kitchen_staff need explicit membership in
 * their own locationIds — no business-wide bypass for those roles.
 */
export function requireLocationAccess(paramName = "locationId") {
  return async (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) return next(ApiError.unauthorized());
    if (req.user.role === "platform_admin") return next();

    const targetLocationId = req.params[paramName];
    const isOwnerOrManager = req.user.role === "restaurant_owner" || req.user.role === "restaurant_manager";

    if (isOwnerOrManager) {
      if (!req.user.businessId) return next(ApiError.forbidden("You do not have access to this location"));
      try {
        const location = await Restaurant.findById(targetLocationId).select("businessId");
        if (!location?.businessId || location.businessId.toString() !== req.user.businessId) {
          return next(ApiError.forbidden("You do not have access to this location"));
        }
      } catch {
        // A malformed ObjectId in the URL is a bad request, not a server error — findById throws
        // a CastError for it, which reads the same as "not found" from the caller's perspective.
        return next(ApiError.forbidden("You do not have access to this location"));
      }
      return next();
    }

    const locationIds = req.user.locationIds ?? [];
    if (!locationIds.includes(targetLocationId)) {
      return next(ApiError.forbidden("You do not have access to this location"));
    }
    next();
  };
}
