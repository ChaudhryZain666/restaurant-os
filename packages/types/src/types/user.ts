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
