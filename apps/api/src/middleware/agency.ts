import type { NextFunction, Request, Response } from "express";
import { agencyRoleHasPermission, type AgencyPermission } from "@restaurant/types";
import { ApiError } from "../utils/ApiError.js";

/**
 * Phase 25 — the agency-level analog of requireBusinessMatch, guarding `/agencies/:agencyId/...`
 * routes themselves (not businesses they manage — that's requireBusinessMatch's extended branch).
 * platform_admin is exempt (read-only platform visibility, via /platform/agencies — never write
 * access through this surface). Zero DB read: membership is a JWT array claim, mirroring
 * requireBusinessMatch's own zero-DB-read direct-match branch. `req.user.agencyMemberships` being
 * unset/empty, or lacking a row for this specific agencyId, is always a DENY, never a throw.
 */
export function requireAgencyMatch(paramName = "agencyId") {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) return next(ApiError.unauthorized());
    if (req.user.role === "platform_admin") return next();

    const targetAgencyId = req.params[paramName];
    const membership = (req.user.agencyMemberships ?? []).find((m) => m.agencyId === targetAgencyId);
    if (!membership) return next(ApiError.forbidden("You do not have access to this agency"));

    req.agencyRole = membership.role;
    next();
  };
}

/**
 * Requires the CURRENT agency membership role (set by requireAgencyMatch, always called first) to
 * grant every given AgencyPermission — governs mutations on the agency's own resources (members,
 * agency-level subscription, business creation). GET routes under `/agencies/:agencyId/...` only
 * need requireAgencyMatch (any active membership, any role) — this is layered on top only for
 * writes, mirroring billing.read/billing.manage's read/write split.
 */
export function requireAgencyPermission(...permissions: AgencyPermission[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) return next(ApiError.unauthorized());
    // Deliberately NOT exempting platform_admin here (unlike requireAgencyMatch/requireBusinessMatch)
    // — platform_admin gets read-only agency visibility only (/platform/agencies), never write
    // access through this surface. A platform_admin has no req.agencyRole (requireAgencyMatch
    // exempts them without setting one), so this naturally denies without a special case.
    if (!req.agencyRole) return next(ApiError.forbidden());
    const hasAll = permissions.every((p) => agencyRoleHasPermission(req.agencyRole!, p));
    if (!hasAll) return next(ApiError.forbidden());
    next();
  };
}
