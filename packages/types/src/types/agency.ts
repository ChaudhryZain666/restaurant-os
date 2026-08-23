/**
 * Phase 25 — Agency → Business → Location. An Agency is a new top-level entity, not a Business
 * variant: it organizationally manages zero or more Businesses (via `Business.agencyId`, additive
 * and optional — an individually-owned Business never has this set) without ever replacing
 * `Business.ownerId`, which stays the real business-owner `User` regardless of who manages it.
 *
 * Deliberately no `ownerId` field on Agency, unlike Business — an Agency's ownership IS its
 * membership (an `agency_owner` row), not a single ref. Business predates membership modeling and
 * keeps its legacy singular owner; Agency has no such baggage to preserve.
 */
export type AgencyStatus = "pending" | "active" | "suspended";

export interface Agency {
  id: string;
  name: string;
  slug: string;
  description?: string;
  logo?: string;
  contactEmail: string;
  status: AgencyStatus;
  /** Maintained counter, incremented atomically on business creation — the entitlement guard for
   *  `max_businesses` (see agencyEntitlement.service.ts). Never computed by counting on read. */
  businessCount: number;
  createdAt: string;
  updatedAt: string;
}

export const AGENCY_MEMBERSHIP_ROLES = ["agency_owner", "agency_admin", "agency_staff"] as const;
export type AgencyMembershipRole = (typeof AGENCY_MEMBERSHIP_ROLES)[number];

export const AGENCY_MEMBERSHIP_STATUSES = ["invited", "active", "revoked", "deactivated"] as const;
export type AgencyMembershipStatus = (typeof AGENCY_MEMBERSHIP_STATUSES)[number];

/**
 * The explicit join model — never a singular `User.agencyId`. A user can hold one membership row
 * per agency (unique `{agencyId, userId}`) across multiple agencies, each with an independent role,
 * which is exactly why this can't be a singular field the way `User.businessId` is.
 *
 * `businessIds` is optional, explicit per-business assignment — mirrors `User.locationIds` for
 * restaurant_staff exactly. `agency_owner`/`agency_admin` get IMPLICIT access to every business
 * under the agency (this field is ignored for them); `agency_staff` gets access ONLY to the
 * businesses explicitly listed here (empty/absent = no business access yet, never implicit-allow).
 */
export interface AgencyMembership {
  id: string;
  agencyId: string;
  userId: string;
  role: AgencyMembershipRole;
  status: AgencyMembershipStatus;
  businessIds?: string[];
  invitedBy?: string;
  acceptedAt?: string;
  createdAt: string;
  updatedAt: string;
}
