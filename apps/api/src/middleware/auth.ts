import type { NextFunction, Request, Response } from "express";
import type { AgencyMembershipRole, UserRole } from "@restaurant/types";
import { verifyAccessToken } from "../services/token.service.js";
import { ApiError } from "../utils/ApiError.js";

// Phase 28 — the only routes a mustChangePassword:true session may reach. Exact, full paths
// (req.originalUrl always starts with the app's fixed /api/v1 prefix — see app.ts), not prefixes,
// so this can never accidentally widen to cover an unrelated route that happens to start the same.
const PASSWORD_CHANGE_ALLOWED_PATHS = new Set(["/api/v1/auth/me", "/api/v1/auth/change-password"]);

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
        // Phase 28, additive — see token.service.ts's AccessTokenPayload doc comment.
        mustChangePassword?: boolean;
        // Phase 32, additive — see token.service.ts's AccessTokenPayload doc comment.
        isDemoAccount?: boolean;
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
      mustChangePassword: payload.mustChangePassword,
      isDemoAccount: payload.isDemoAccount,
    };
    // Server-side enforcement, not just a client-side redirect: a temporary-password session can
    // reach nothing except "who am I" and "change my password" until it does. /auth/refresh and
    // /auth/logout deliberately don't go through requireAuth at all (see auth.routes.ts), so they
    // stay reachable without needing an entry here.
    if (payload.mustChangePassword && !PASSWORD_CHANGE_ALLOWED_PATHS.has(req.originalUrl.split("?")[0])) {
      return next(ApiError.passwordChangeRequired());
    }
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
