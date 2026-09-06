# Agency / Owner / Staff / Platform Boundary (Portal UX phase, Part D)

This documents the real permission and portal boundary between Platform Admin, Agency, Restaurant
Owner/Manager, and Staff, exactly as implemented today. It is a documentation-only deliverable — no
permission code changed while writing it. It exists so the Agency and Owner portals (both `apps/
admin`) can be reorganized for clarity without anyone (a future contributor, or a future AI session)
guessing at the real authorization boundary from the UI alone.

## Two separate permission vocabularies, on purpose

There are two distinct, non-overlapping `Permission`-shaped types in this codebase, and conflating
them is the single easiest way to introduce a real authorization bug here:

1. **`Permission`** (`packages/types/src/types/rbac.ts`) — the site-wide vocabulary
   (`restaurant.menu.write`, `billing.manage`, `platform.users.manage`, ...), granted per `UserRole`
   via `ROLE_PERMISSIONS` and checked with `roleHasPermission(role, permission)`. This governs
   restaurant-owner-side and platform-side routes/nav.
2. **`AgencyPermission`** (`packages/types/src/types/agencyRbac.ts`) — a small, separate vocabulary
   (`agency.manage`, `agency.members.manage`, `agency.businesses.manage`, `agency.billing.read`,
   `agency.billing.manage`) granted per `AgencyMembershipRole` via `AGENCY_ROLE_PERMISSIONS` and
   checked with `agencyRoleHasPermission`. This governs only the agency's own resources — its team,
   its own subscription, and creating new client businesses. It has **no relationship** to what that
   agency can do inside a client's restaurant.

A third mapping, **`AGENCY_ROLE_GRANTS`** (also in `agencyRbac.ts`), bridges the two: it expresses
what an `AgencyMembershipRole` can do **once it has entered a specific managed business**, in the
*first* vocabulary (`Permission`), so the exact same `requireBusinessPermission`/
`requireTenantPermission` middleware an owner/staff account hits also governs an agency account —
there is no separate, parallel authorization path for "agency acting on a business."

## The capability matrix, as implemented

| Capability | Platform Admin | Agency (owner/admin) | Agency (staff) | Restaurant Owner | Manager | Staff | Kitchen staff |
|---|---|---|---|---|---|---|---|
| Manage agencies (suspend, cross-agency visibility) | Yes (`platform.restaurants.manage`, read-only `/platform/agencies`) | No | No | No | No | No | No |
| Create/manage own agency, invite team | N/A | Yes (`agency.manage`/`agency.members.manage`) | No (read-only) | N/A | N/A | N/A | N/A |
| Create a client business | Yes (via `/platform/restaurants/new`) | Yes (`agency.businesses.manage`) | No | No | No | No | No |
| Agency's own subscription | N/A | owner: full; admin: read (`agency.billing.read`/`.manage`) | Read only | N/A | N/A | N/A | N/A |
| Enter/manage a client business | N/A (platform never "enters" a business) | Yes, scoped by `AGENCY_ROLE_GRANTS` | Yes, but only businesses in their `AgencyMembership.businessIds`, and only the read-ish grants below | Full (own business) | Broad, no `restaurant.settings.manage`/`billing.manage` | Orders/POS only | Orders only |
| Restaurant settings / business hours | No | owner/admin: yes | No | Yes | No | No | No |
| Menu (read/write) | No | owner/admin: yes | Read only | Yes | Yes | Read only | No |
| Orders (read/manage) | No | owner/admin: yes | Read only | Yes | Yes | Yes | Yes |
| Staff management | No | owner only | No | Yes | No | No | No |
| Payments (restaurant's own payment-provider connection) | No | **No agency role, ever** — deliberately excluded | No | Yes | Yes | No | No |
| Client's restaurant-subscription billing | No | owner/admin: read (`billing.read`) | Read only | Yes (`billing.manage`) | Read only | No | No |
| POS operation | N/A | owner/admin: yes (`restaurant.pos.operate`) | No | Yes | Yes | Yes | No |
| Restaurant audit log | No | owner/admin: yes | No | Yes | Yes | No | No |

Notes on the table, tied to the actual source:
- **Payments are the one permission never granted to any agency role at all** —
  `restaurant.payments.manage` does not appear in any `AGENCY_ROLE_GRANTS` entry. This is
  deliberate (`agencyRbac.ts`'s own doc comment): a restaurant's own payment-provider credentials
  stay owner-only, regardless of agency role.
- **`agency_staff` is the narrowest role in the whole system** — read-only even inside a business
  it's been granted access to (`billing.read`, `restaurant.analytics.read`, `restaurant.menu.read`,
  `restaurant.orders.read` only — no `.manage`/`.write` of any kind).
- **Platform Admin never "enters" a business the way an agency does.** Its restaurant-level access
  (`/platform/restaurants/:id`) is a distinct, platform-scoped surface, not a run through
  `BusinessContext`/`AGENCY_ROLE_GRANTS`.
- **A restaurant's own staff/manager roles are entirely independent of agencies.** An agency
  relationship changes nothing about `ROLE_PERMISSIONS` for `restaurant_manager`/`restaurant_staff`/
  `kitchen_staff` — those grants are identical whether or not the business has an agency.

## The "entering a business" mechanism (`BusinessContext`)

`enterBusiness()` (`apps/admin/src/context/BusinessContext.tsx`) is a **client-side UI preference
only** — it writes `{businessId, agencyId, agencyRole}` to `localStorage` and re-points the app's
active-business state at it. It is never treated as an authorization input server-side. Every
request the frontend then makes is independently re-verified by
`requireBusinessMatch`/`requireTenantMatch` (`apps/api/src/middleware/businessLocation.ts`), which
re-derive access from the database on each call: `agency_owner`/`agency_admin` get implicit access
to any business under their agency (`Business.agencyId` match); `agency_staff` needs an additional
check against `AgencyMembership.businessIds`. There is no session, token, or identity change when
entering a business — the authenticated user is always still the agency member, and the server
would refuse the exact same request if the client tried to fabricate a different `businessId` it
doesn't actually have access to.

## What this means for the portal IA

- The Agency Portal (`/agency/*`) and the "entered business" operational surface
  (`/menu`, `/orders`, `/settings`, ...) are the same React app but genuinely different permission
  regimes — the nav switch between `AGENCY_GROUPS` and `RESTAURANT_GROUPS` in `Layout.tsx` reflects
  a real boundary, not just a cosmetic grouping.
- Nothing in the Portal UX phase changed any of the above — every nav/label/page change reuses the
  exact same `roleHasPermission`/`agencyRoleHasPermission`/`agencyRoleGrantsPermission` checks that
  already existed, so RBAC visibility cannot have drifted from what the API actually enforces.
