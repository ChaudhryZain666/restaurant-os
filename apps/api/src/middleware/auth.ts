import type { NextFunction, Request, Response } from "express";
import type { AgencyMembershipRole, UserRole } from "@restaurant/types";
import { verifyAccessToken } from "../services/token.service.js";
import { ApiError } from "../utils/ApiError.js";

declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        role: UserRole;
        restaurantId?: string;
        // Phase 18, additive — see token.service.ts's AccessTokenPayload. Not read by any
        // pre-Phase-18 route; backs middleware/businessLocation.ts only.
        businessId?: string;
        locationIds?: string[];
        // Phase 25, additive — mirrors locationIds' shape (an array claim, refreshed at
        // login/refresh only). See token.service.ts's AccessTokenPayload doc comment.
        agencyMemberships?: Array<{ agencyId: string; role: AgencyMembershipRole }>;
      };
      // Phase 25 — set by middleware/businessLocation.ts's requireBusinessMatch ONLY when access
      // was granted via agency membership (not the direct businessId/platform_admin branches), so
      // requireBusinessPermission knows which agency role to check. Absent otherwise — never
      // confused with req.user.role, which stays the person's own flat site role throughout.
      agencyRole?: AgencyMembershipRole;
    }
  }
}

export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    return next(ApiError.unauthorized("Missing access token"));
  }

  try {
    const payload = verifyAccessToken(header.slice("Bearer ".length));
    req.user = {
      id: payload.sub,
      role: payload.role,
      restaurantId: payload.restaurantId,
      businessId: payload.businessId,
      locationIds: payload.locationIds,
      agencyMemberships: payload.agencyMemberships,
    };
    next();
  } catch {
    next(ApiError.unauthorized("Invalid or expired access token"));
  }
}

export function requireRole(...roles: UserRole[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) return next(ApiError.unauthorized());
    if (!roles.includes(req.user.role)) return next(ApiError.forbidden());
    next();
  };
}
