import type { Permission } from "./rbac.js";
import type { AgencyMembershipRole } from "./agency.js";

/**
 * Phase 25 — a deliberately separate, small permission model from `Permission` (rbac.ts). This one
 * governs the agency's OWN routes (`/agencies/:agencyId/...` — members, agency-level subscription,
 * business creation), distinct from `AGENCY_ROLE_GRANTS` below, which governs what an
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
 * What an agency role can do on a specific BUSINESS it's authorized for — AND, as of Phase 26, on
 * that business's individual LOCATIONS too — expressed in the existing `Permission` vocabulary
 * (`rbac.ts`) so `requireBusinessPermission` (business-scoped routers) and `requireTenantPermission`
 * (location-scoped routers) can both check it alongside the normal `roleHasPermission` check, with
 * no new permission language to learn.
 *
 * `Permission` is a single flat vocabulary already reused across business- and location-scoped
 * routes (e.g. `restaurant.settings.manage` gates both a business-level domain list AND a
 * location-level domain write) — kept as ONE map, not two, specifically to avoid drift on the
 * permissions that appear at both scopes.
 *
 * Phase 25 established this as business-level only (menu/settings/promotions/analytics/billing —
 * the eight business-scoped routers). Phase 26 crosses that deliberate boundary and adds the
 * location-operational permissions (orders/tables/staff/audit) needed for an agency member to
 * actually operate a managed business's Orders/Kitchen/Tables/Staff pages — see
 * docs/multi-tenant-storefront-architecture.md's Phase 26 section for the full reasoning, including
 * why `restaurant.payments.manage` is deliberately excluded from every agency role (restaurant
 * payment-provider credentials stay owner-only) and why `agency_staff`'s explicit
 * `AgencyMembership.businessIds` assignment grants every location under that business rather than
 * introducing a second, location-level assignment axis.
 */
export const AGENCY_ROLE_GRANTS: Record<AgencyMembershipRole, readonly Permission[]> = {
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
    "restaurant.orders.read",
    "restaurant.orders.manage",
    "restaurant.tables.manage",
    "restaurant.staff.manage",
    "restaurant.audit.read",
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
    "restaurant.orders.read",
    "restaurant.orders.manage",
    "restaurant.tables.manage",
    "restaurant.audit.read",
  ],
  agency_staff: ["billing.read", "restaurant.analytics.read", "restaurant.menu.read", "restaurant.orders.read"],
};

export function agencyRoleGrantsPermission(role: AgencyMembershipRole, permission: Permission): boolean {
  return AGENCY_ROLE_GRANTS[role].includes(permission);
}
