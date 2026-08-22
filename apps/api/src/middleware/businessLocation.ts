import type { NextFunction, Request, Response } from "express";
import { ApiError } from "../utils/ApiError.js";

/**
 * Phase 18 — additive alongside tenant.ts's requireTenantMatch, not a replacement for it. No
 * pre-Phase-18 route uses this; it guards the new /businesses routes only (routes/business.routes.ts).
 *
 * Confirms the business in the URL matches the authenticated user's own business.
 * platform_admin is exempt (manages all tenants). req.user.businessId being unset (a not-yet-
 * migrated account, or a token issued before Phase 18) is always a DENY, never a throw.
 *
 * Phase 19 note: this file used to also export requireLocationAccess, a location-level analog of
 * this business-level check. It's been retired — its exact logic (owner/manager: businessId
 * match via a DB lookup; staff/kitchen_staff: explicit locationIds membership) is now folded
 * directly into middleware/tenant.ts's requireTenantMatch, since that's the function every real
 * restaurant-scoped route actually depends on. Keeping requireLocationAccess around as a second,
 * parallel implementation of the same logic — used by nothing except the one /businesses route
 * that's since switched to requireTenantMatch('locationId') — would just be a second place for
 * this authorization logic to drift out of sync. requireBusinessMatch stays here: it's a genuinely
 * different check (business-level, not location-level) with no equivalent in tenant.ts.
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
