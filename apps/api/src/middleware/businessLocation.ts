import type { NextFunction, Request, Response } from "express";
import { agencyRoleGrantsBusinessPermission, roleHasPermission, type Permission } from "@restaurant/types";
import { Business } from "../models/Business.js";
import { AgencyMembership } from "../models/AgencyMembership.js";
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
 *
 * Phase 25 — gained one new branch: an agency member whose agency manages this specific business
 * (`Business.agencyId`) is granted access too, via one DB read (mirrors tenant.ts's
 * canAccessRestaurant owner/manager branch — the same cost/shape already accepted elsewhere in
 * this codebase, not a new pattern). `agency_owner`/`agency_admin` get IMPLICIT access to every
 * business under their agency; `agency_staff` needs EXPLICIT `AgencyMembership.businessIds`
 * inclusion (one further read, only for that role) — mirrors `User.locationIds` for
 * restaurant_staff exactly. On success via this branch, `req.agencyRole` is set so a following
 * requireBusinessPermission() knows which agency role applies. Every existing
 * `/businesses/:businessId/...` router becomes agency-aware for free from this one change — no
 * per-route rewrites. Deliberately does NOT touch requireTenantMatch/canAccessRestaurant — see
 * docs/multi-tenant-storefront-architecture.md's Phase 25 section for the "business-level, not
 * location-operational" boundary this stops at.
 */
export function requireBusinessMatch(paramName = "businessId") {
  return async (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) return next(ApiError.unauthorized());
    if (req.user.role === "platform_admin") return next();

    const targetBusinessId = req.params[paramName];
    if (req.user.businessId && req.user.businessId === targetBusinessId) return next();

    const memberships = req.user.agencyMemberships ?? [];
    if (memberships.length > 0 && targetBusinessId) {
      const allowed = await agencyGrantsBusinessAccess(req.user.id, memberships, targetBusinessId);
      if (allowed) {
        req.agencyRole = allowed;
        return next();
      }
    }

    return next(ApiError.forbidden("You do not have access to this business"));
  };
}

async function agencyGrantsBusinessAccess(
  userId: string,
  memberships: Array<{ agencyId: string; role: "agency_owner" | "agency_admin" | "agency_staff" }>,
  targetBusinessId: string
) {
  let business;
  try {
    business = await Business.findById(targetBusinessId).select("agencyId");
  } catch {
    return undefined; // a malformed ObjectId reads the same as "not found"
  }
  if (!business?.agencyId) return undefined;

  const membership = memberships.find((m) => m.agencyId === business!.agencyId!.toString());
  if (!membership) return undefined;
  if (membership.role === "agency_owner" || membership.role === "agency_admin") return membership.role;

  // agency_staff: explicit membership.businessIds only, no implicit agency-wide access — this
  // one field isn't in the JWT (unbounded, business-specific list, a poor fit for a token claim),
  // so it costs one further DB read, kept out of the hot owner/admin path above.
  const row = await AgencyMembership.findOne({ agencyId: business.agencyId, userId, status: "active" }).select("businessIds");
  if (row?.businessIds?.some((id) => id.toString() === targetBusinessId)) return "agency_staff";
  return undefined;
}

/**
 * Phase 25 — swapped in for `requirePermission` ONLY on the eight business-scoped routers
 * (business, businessSubscription, businessDomain, businessPromotion, businessAnalytics,
 * businessCategory, businessMenu, businessModifier). An agency member's own site-wide `role` is
 * `"agency_member"`, which grants nothing in ROLE_PERMISSIONS (see rbac.ts) — every real
 * capability they have flows through their per-business `req.agencyRole` (set by
 * requireBusinessMatch above) instead. Location-scoped routers keep plain `requirePermission`,
 * completely unchanged.
 */
export function requireBusinessPermission(...permissions: Permission[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) return next(ApiError.unauthorized());
    const hasAll = permissions.every(
      (p) => roleHasPermission(req.user!.role, p) || (req.agencyRole !== undefined && agencyRoleGrantsBusinessPermission(req.agencyRole, p))
    );
    if (!hasAll) return next(ApiError.forbidden());
    next();
  };
}
