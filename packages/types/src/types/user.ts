import type { UserRole } from "./rbac.js";
import type { AgencyMembershipRole } from "./agency.js";

export interface PublicUser {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  /** Present only for restaurant-scoped roles (owner/manager/staff/kitchen_staff). */
  restaurantId?: string;
  /** Phase 19 — present once a Business/Location foundation exists for this account (Phase 18
   *  migration or a Phase-18-or-later invite/creation). Lets the admin frontend know whether to
   *  offer any multi-location UI at all. */
  businessId?: string;
  /** Owner/manager: not populated here — they get implicit access to every location under
   *  businessId (see apps/api's requireTenantMatch), so this stays empty for them by design, not
   *  by omission. Staff/kitchen_staff: the specific locations they're scoped to. */
  locationIds?: string[];
  /** Phase 25 — every AGENCY this account has an active (accepted) membership in, and their role
   *  in each. Empty for accounts with no agency affiliation. Drives AgencyContext's agency
   *  switcher; never trusted as the sole authorization source (the server re-verifies on every
   *  request — see requireBusinessMatch/requireAgencyMatch). */
  agencyMemberships?: Array<{ agencyId: string; role: AgencyMembershipRole }>;
  phone?: string;
  createdAt: string;
  /** Phase 28 — true only for an agency-provisioned "direct access" account (a real temporary
   *  password) that hasn't set its own password yet. The frontend (RequireAuth) redirects to a
   *  forced change-password screen whenever this is true; the server enforces the same restriction
   *  independently (see middleware/auth.ts) so this is defense-in-depth, not the only guard. */
  mustChangePassword?: boolean;
  /** Phase 32 — true only for a throwaway account created by POST /auth/demo-session (the public
   *  storefront playground). Never true for a real registered or invited account. */
  isDemoAccount?: boolean;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

/** A restaurant's manager/staff/kitchen_staff account, as shown on the owner's Staff page. */
export interface StaffMember {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  phone?: string;
  isActive: boolean;
  /** True until they've followed their invite email and set their own password. */
  invitePending: boolean;
  /** Phase 19 — which locations (Restaurant ids) this staff member can act on. Only meaningful
   *  for restaurant_staff/kitchen_staff — a manager gets implicit access to every location under
   *  the business regardless of what's here (see requireTenantMatch), so this is always empty for
   *  managers by design. */
  locationIds?: string[];
  createdAt: string;
}
