import type { Permission } from "./rbac.js";
import type { AgencyMembershipRole } from "./agency.js";

/**
 * Phase 25 — a deliberately separate, small permission model from `Permission` (rbac.ts). This one
 * governs the agency's OWN routes (`/agencies/:agencyId/...` — members, agency-level subscription,
 * business creation), distinct from `AGENCY_ROLE_BUSINESS_GRANTS` below, which governs what an
 * agency role can do on a BUSINESS the agency manages (the existing, unchanged `Permission` type,
 * checked via `requireBusinessPermission` on business-scoped routers only).
 *
 * GET routes under `/agencies/:agencyId/...` only require an active membership (any role) — these
 * permissions gate MUTATIONS only, mirroring billing.read/billing.manage's read/write split.
 */
export type AgencyPermission =
  | "agency.manage"
  | "agency.members.manage"
  | "agency.businesses.manage"
  | "agency.billing.read"
  | "agency.billing.manage";

export const AGENCY_ROLE_PERMISSIONS: Record<AgencyMembershipRole, readonly AgencyPermission[]> = {
  agency_owner: [
    "agency.manage",
    "agency.members.manage",
    "agency.businesses.manage",
    "agency.billing.read",
    "agency.billing.manage",
  ],
  agency_admin: ["agency.members.manage", "agency.businesses.manage", "agency.billing.read"],
  agency_staff: ["agency.billing.read"],
};

export function agencyRoleHasPermission(role: AgencyMembershipRole, permission: AgencyPermission): boolean {
  return AGENCY_ROLE_PERMISSIONS[role].includes(permission);
}

/**
 * What an agency role can do on a specific BUSINESS it's authorized for, expressed in the existing
 * `Permission` vocabulary (`rbac.ts`) so `requireBusinessPermission` can check it alongside the
 * normal `roleHasPermission` check with no new permission language to learn. Deliberately limited to
 * exactly the permissions the eight business-scoped routers actually check (business.routes.ts,
 * businessSubscription/Domain/Promotion/Analytics/Category/Menu/Modifier.routes.ts) — nothing
 * location-operational (orders/kitchen/tables/staff) is here at all, since those live under
 * `/restaurants/:restaurantId/...` and stay governed by the existing, untouched
 * `requireTenantMatch` — see docs/multi-tenant-storefront-architecture.md's Phase 25 section for the
 * full "business-level, not location-operational" boundary reasoning.
 */
export const AGENCY_ROLE_BUSINESS_GRANTS: Record<AgencyMembershipRole, readonly Permission[]> = {
  agency_owner: [
    "restaurant.settings.manage",
    "billing.read",
    "billing.manage",
    "restaurant.promotions.manage",
    "restaurant.analytics.read",
    "restaurant.menu.read",
    "restaurant.categories.write",
    "restaurant.menu.write",
    "restaurant.modifiers.write",
  ],
  agency_admin: [
    "restaurant.settings.manage",
    "billing.read",
    "restaurant.promotions.manage",
    "restaurant.analytics.read",
    "restaurant.menu.read",
    "restaurant.categories.write",
    "restaurant.menu.write",
    "restaurant.modifiers.write",
  ],
  agency_staff: ["billing.read", "restaurant.analytics.read", "restaurant.menu.read"],
};

export function agencyRoleGrantsBusinessPermission(role: AgencyMembershipRole, permission: Permission): boolean {
  return AGENCY_ROLE_BUSINESS_GRANTS[role].includes(permission);
}
