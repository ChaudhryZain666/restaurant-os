import type { NextFunction, Request, Response } from "express";
import { Restaurant } from "../models/Restaurant.js";
import { ApiError } from "../utils/ApiError.js";

interface TenantUser {
  role: string;
  restaurantId?: string;
  businessId?: string;
  locationIds?: string[];
}

/**
 * Confirms an authenticated user is actually allowed to touch a given restaurant (location).
 * platform_admin is exempt (manages all tenants) — callers that need to special-case platform_admin
 * differently (e.g. requireTenantMatch's early-return-next()) check that separately; this function
 * itself does NOT exempt platform_admin, so it's also safe to call for a plain "does this specific
 * user have real tenant access" question.
 *
 * Extracted as a plain, non-Express function (Phase 19) so both requireTenantMatch (below) and the
 * Socket.IO handshake (apps/api/src/realtime/socket.ts, which needs the identical answer for a
 * client-supplied locationId) share ONE implementation — see requireTenantMatch's doc comment for
 * why running two parallel copies of this logic was rejected.
 */
export async function canAccessRestaurant(user: TenantUser, targetRestaurantId: string | undefined): Promise<boolean> {
  if (!targetRestaurantId) return false;

  // Single-location fast path: still a single-location account acting on their own restaurant.
  if (user.restaurantId && user.restaurantId === targetRestaurantId) return true;

  // Staff/kitchen_staff: explicit membership only, no implicit business-wide access, no DB call.
  if (user.role === "restaurant_staff" || user.role === "kitchen_staff") {
    return (user.locationIds ?? []).includes(targetRestaurantId);
  }

  // Owner/manager: implicit access to every location under their own business.
  // businessId unset (not yet migrated, or a token issued before Phase 18) is always a deny, never
  // a DB call — nothing to check it against.
  if (!user.businessId) return false;
  try {
    const target = await Restaurant.findById(targetRestaurantId).select("businessId");
    return Boolean(target?.businessId && target.businessId.toString() === user.businessId);
  } catch {
    // A malformed ObjectId reads the same as "not found" from the caller's perspective.
    return false;
  }
}

/**
 * Confirms the restaurant (location) in the URL is one the authenticated user is actually
 * allowed to touch.
 *
 * The route param is only ever used to identify *which* resource is being requested —
 * authorization always comes from verified claims on req.user (set from the JWT in
 * requireAuth), never from the URL itself. platform_admin is exempt (manages all tenants).
 *
 * Phase 19 correction: this used to be a single strict-equality check against
 * req.user.restaurantId — correct for the single-location product Phase 18 found, but it meant
 * an owner/manager with Phase 18's new businessId-based access to a SECOND location could never
 * actually reach it through any real route (orders, menu, kitchen, staff, ...), since this
 * function is what every one of them is guarded by. Phase 18 deliberately left this function
 * untouched and added a separate requireLocationAccess instead, to avoid touching every existing
 * route's live behavior — but that meant the new access model was wired into zero real routes.
 * Now that the product actually needs multi-location access to work, this function is unified
 * to grant it directly (requireLocationAccess is retired — see middleware/businessLocation.ts's
 * removal note) rather than run two parallel authorization systems side by side.
 *
 * The single-restaurantId fast path inside canAccessRestaurant is checked FIRST and is completely
 * unchanged (synchronous, no DB call) — the single-location case, still the overwhelming majority
 * of accounts, pays zero cost for this.
 */
export function requireTenantMatch(paramName = "restaurantId") {
  return async (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) return next(ApiError.unauthorized());
    if (req.user.role === "platform_admin") return next();

    const allowed = await canAccessRestaurant(req.user, req.params[paramName]);
    if (!allowed) return next(ApiError.forbidden("You do not have access to this restaurant"));
    next();
  };
}
