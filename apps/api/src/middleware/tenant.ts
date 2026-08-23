import type { NextFunction, Request, Response } from "express";
import { agencyRoleGrantsPermission, roleHasPermission, type AgencyMembershipRole, type Permission } from "@restaurant/types";
import { Restaurant } from "../models/Restaurant.js";
import { agencyGrantsBusinessAccess } from "./businessLocation.js";
import { ApiError } from "../utils/ApiError.js";

interface TenantUser {
  // Optional (Phase 26): the two real restaurant-role fast paths (single-location, staff
  // locationIds) never need it; only the agency_staff businessIds lookup does. Socket-handshake
  // callers that construct a TenantUser from the raw JWT payload should still pass it (payload.sub)
  // so an agency_staff account gets a correct answer over sockets too, not just REST.
  id?: string;
  role: string;
  restaurantId?: string;
  businessId?: string;
  locationIds?: string[];
  // Phase 26, additive — see middleware/auth.ts's Express.Request augmentation.
  agencyMemberships?: Array<{ agencyId: string; role: AgencyMembershipRole }>;
}

interface TenantAccessResult {
  allowed: boolean;
  // Set only when access was granted via agency membership (not a direct owner/manager/staff
  // fast path) — mirrors requireBusinessMatch's req.agencyRole, consumed by requireTenantPermission.
  agencyRole?: AgencyMembershipRole;
}

/**
 * The one real implementation behind both `canAccessRestaurant` (below, a thin boolean wrapper kept
 * for the Socket.IO handshake's existing call site) and `requireTenantMatch`. Extracted (Phase 26)
 * so requireTenantMatch can learn WHICH agency role granted access (needed by
 * requireTenantPermission), without a second DB round-trip or a parallel implementation.
 *
 * Phase 26 — gained one new branch after the existing owner/manager/staff/kitchen_staff checks all
 * fail: if the user holds any agency membership, resolve the target restaurant's businessId (one
 * read — the same read the owner/manager branch already does) and reuse
 * businessLocation.ts's agencyGrantsBusinessAccess verbatim (one hop deeper than its own
 * business-scoped use) rather than re-deriving agency-access logic a second time.
 * `agency_owner`/`agency_admin` get implicit access to every location under a business their agency
 * manages; `agency_staff` needs the business itself in their explicit `AgencyMembership.businessIds`
 * (a considered choice: business, not location, stays the unit of explicit assignment — see
 * docs/multi-tenant-storefront-architecture.md's Phase 26 section).
 */
export async function resolveTenantAccess(user: TenantUser, targetRestaurantId: string | undefined): Promise<TenantAccessResult> {
  if (!targetRestaurantId) return { allowed: false };

  // Single-location fast path: still a single-location account acting on their own restaurant.
  if (user.restaurantId && user.restaurantId === targetRestaurantId) return { allowed: true };

  // Staff/kitchen_staff: explicit membership only, no implicit business-wide access, no DB call.
  if (user.role === "restaurant_staff" || user.role === "kitchen_staff") {
    return { allowed: (user.locationIds ?? []).includes(targetRestaurantId) };
  }

  let targetBusinessId: string | undefined;
  try {
    const target = await Restaurant.findById(targetRestaurantId).select("businessId");
    targetBusinessId = target?.businessId?.toString();
  } catch {
    // A malformed ObjectId reads the same as "not found" from the caller's perspective.
    return { allowed: false };
  }

  // Owner/manager: implicit access to every location under their own business.
  if (user.businessId && targetBusinessId === user.businessId) return { allowed: true };

  // Agency: only reached once the real restaurant-role fast paths above have failed.
  const memberships = user.agencyMemberships ?? [];
  if (memberships.length > 0 && targetBusinessId && user.id) {
    const agencyRole = await agencyGrantsBusinessAccess(user.id, memberships, targetBusinessId);
    if (agencyRole) return { allowed: true, agencyRole };
  }

  return { allowed: false };
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
 * why running two parallel copies of this logic was rejected. A thin boolean wrapper around
 * resolveTenantAccess (Phase 26) so the socket handshake's existing call site needs no change.
 */
export async function canAccessRestaurant(user: TenantUser, targetRestaurantId: string | undefined): Promise<boolean> {
  return (await resolveTenantAccess(user, targetRestaurantId)).allowed;
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

    const result = await resolveTenantAccess(req.user, req.params[paramName]);
    if (!result.allowed) return next(ApiError.forbidden("You do not have access to this restaurant"));
    // Set only on the agency-membership branch (see resolveTenantAccess) — mirrors
    // requireBusinessMatch's identical req.agencyRole assignment, consumed below.
    if (result.agencyRole) req.agencyRole = result.agencyRole;
    next();
  };
}

/**
 * Phase 26 — the location-scoped analog of businessLocation.ts's requireBusinessPermission,
 * swapped in for `requirePermission` only on the location routers an agency member should be able
 * to reach (orders, tables, staff, location domains). Shares the same AGENCY_ROLE_GRANTS map
 * (agencyRbac.ts) — one map governs both business- and location-scoped agency permission checks,
 * since Permission is a single flat vocabulary reused at both scopes.
 */
export function requireTenantPermission(...permissions: Permission[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) return next(ApiError.unauthorized());
    const hasAll = permissions.every(
      (p) => roleHasPermission(req.user!.role, p) || (req.agencyRole !== undefined && agencyRoleGrantsPermission(req.agencyRole, p))
    );
    if (!hasAll) return next(ApiError.forbidden());
    next();
  };
}
