import type { NextFunction, Request, Response } from "express";
import { ApiError } from "../utils/ApiError.js";

/**
 * Confirms the restaurant in the URL matches the authenticated user's own tenant.
 *
 * The route param is only ever used to identify *which* resource is being requested —
 * authorization always comes from req.user.restaurantId (set from the verified JWT in
 * requireAuth), never from the URL itself. A restaurant_owner/manager/staff/kitchen_staff
 * user can only touch their own tenant's data even if they edit the URL by hand.
 * platform_admin is exempt (manages all tenants).
 */
export function requireTenantMatch(paramName = "restaurantId") {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) return next(ApiError.unauthorized());
    if (req.user.role === "platform_admin") return next();

    const targetRestaurantId = req.params[paramName];
    if (!req.user.restaurantId || req.user.restaurantId !== targetRestaurantId) {
      return next(ApiError.forbidden("You do not have access to this restaurant"));
    }
    next();
  };
}
