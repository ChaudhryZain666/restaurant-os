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

export type AgencyDomainStatus = "pending_verification" | "verified";

/**
 * A custom sender address on the agency's own domain. The platform's email transport is generic
 * SMTP, which has no API for verifying a sending domain, so this is a truthful manual workflow:
 *  - pending_domain: the address's domain isn't the agency's DNS-verified domain (yet);
 *  - pending_authorization: domain ownership is verified; waiting for a platform admin to confirm
 *    the SMTP relay is authorized to send for it (SPF/DKIM set up at the provider);
 *  - verified: confirmed — the only state in which the address is ever used as "From";
 *  - failed: a platform admin rejected it (see failureReason).
 */
export const AGENCY_EMAIL_SENDER_STATUSES = ["pending_domain", "pending_authorization", "verified", "failed"] as const;
export type AgencyEmailSenderStatus = (typeof AGENCY_EMAIL_SENDER_STATUSES)[number];

export interface AgencyEmailSender {
  address: string;
  status: AgencyEmailSenderStatus;
  requestedAt: string;
  verifiedAt?: string;
  failureReason?: string;
}

export const AGENCY_WHITE_LABEL_FEATURES = [
  "storefront_branding",
  "custom_domain",
  "hide_platform_branding",
  "support_branding",
  "email_branding",
  "branded_login",
] as const;
export type AgencyWhiteLabelFeature = (typeof AGENCY_WHITE_LABEL_FEATURES)[number];

export interface Agency {
  id: string;
  name: string;
  slug: string;
  description?: string;
  logo?: string;
  /** Public-facing brand name; falls back to `name` when unset. */
  brandName?: string;
  /** Strict six-digit hex color used by agency-branded customer-facing surfaces. */
  brandPrimaryColor?: string;
  /** False by default so existing agencies retain the current GarnishTable experience. */
  whiteLabelEnabled?: boolean;
  /** Capabilities this agency chooses to offer to its client restaurants. */
  whiteLabelOfferings?: AgencyWhiteLabelFeature[];
  /** Customer-facing support contact, shown only when `support_branding` is active for a client. */
  supportEmail?: string;
  /** https-only customer-facing help URL, shown only when `support_branding` is active. */
  supportUrl?: string;
  /** Optional custom "From" address for branded email. Never used until `status` is "verified". */
  emailSender?: AgencyEmailSender;
  contactEmail: string;
  status: AgencyStatus;
  /** Maintained counter, incremented atomically on business creation — the entitlement guard for
   *  `max_businesses` (see agencyEntitlement.service.ts). Never computed by counting on read. */
  businessCount: number;
  /** Phase 58, Section 12A — the agency's candidate white-label domain and its DNS-TXT ownership
   *  verification status. Verifying ownership does NOT enable sending email from this domain or
   *  branding invitation emails — no per-tenant email-sending infrastructure exists yet. See
   *  docs/agency-white-label-domain.md for exactly what is and isn't real. */
  domain?: string;
  domainStatus?: AgencyDomainStatus;
  /** The exact value to publish in a DNS TXT record (plaintext, not a bearer credential — see
   *  Agency.ts's own doc comment for why this differs from this codebase's invite/reset tokens). */
  domainVerificationToken?: string;
  domainVerifiedAt?: string;
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
