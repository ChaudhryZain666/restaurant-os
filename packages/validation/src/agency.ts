import { z } from "zod";
import { paginationQueryShape, sortableQueryShape } from "./pagination.js";

const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const createAgencySchema = z.object({
  name: z.string().min(2).max(120),
  slug: z.string().min(2).max(60).regex(slugPattern, "Use lowercase letters, numbers, and hyphens only"),
  contactEmail: z.string().email(),
  description: z.string().max(500).optional(),
});
export type CreateAgencyInput = z.infer<typeof createAgencySchema>;

export const AGENCY_MEMBER_ROLES = ["agency_owner", "agency_admin", "agency_staff"] as const;

export const inviteAgencyMemberSchema = z.object({
  name: z.string().min(2).max(80),
  email: z.string().email(),
  role: z.enum(AGENCY_MEMBER_ROLES),
});
export type InviteAgencyMemberInput = z.infer<typeof inviteAgencyMemberSchema>;

export const acceptAgencyInviteSchema = z.object({
  token: z.string().min(1),
  // Optional: only required when the invited person has no existing account yet — the controller
  // rejects a missing password for a brand-new account and ignores it for an existing one (see
  // agencyMembership.controller.ts's acceptInvite doc comment).
  password: z.string().min(8).max(128).optional(),
});
export type AcceptAgencyInviteInput = z.infer<typeof acceptAgencyInviteSchema>;

export const updateAgencyMembershipSchema = z
  .object({
    role: z.enum(AGENCY_MEMBER_ROLES).optional(),
    status: z.enum(["active", "revoked", "deactivated"]).optional(),
    // Only meaningful for agency_staff — see AgencyMembership.ts's doc comment. Ignored (implicit
    // full access) for agency_owner/agency_admin.
    businessIds: z.array(z.string().min(1)).optional(),
  })
  .refine((v) => v.role !== undefined || v.status !== undefined || v.businessIds !== undefined, {
    message: "Provide at least one of role, status, or businessIds",
  });
export type UpdateAgencyMembershipInput = z.infer<typeof updateAgencyMembershipSchema>;

// Mirrors createRestaurantSchema's "new business" branch (platform_admin's restaurant creation) —
// same field shapes, since this creates a Business + first Restaurant + invited owner in one
// transactional call, just agency-attributed instead of platform-admin-attributed. See
// agency.controller.ts's createAgencyBusiness.
export const createAgencyBusinessSchema = z.object({
  businessName: z.string().min(2).max(120),
  businessSlug: z.string().min(2).max(60).regex(slugPattern, "Use lowercase letters, numbers, and hyphens only"),
  ownerName: z.string().min(2).max(80),
  ownerEmail: z.string().email(),
  locationName: z.string().min(2).max(120),
  locationSlug: z.string().min(2).max(60).regex(slugPattern, "Use lowercase letters, numbers, and hyphens only"),
  timezone: z.string().min(1).optional(),
  currency: z.string().length(3).optional(),
  // Phase 28 — "invite" (default, unchanged Phase 25 behavior): owner gets an unusable random
  // password + an email invite token. "direct": agency gets a real, system-generated one-time
  // password to relay to the owner out of band, no email token — see agency.controller.ts's
  // createAgencyBusiness doc comment for why this is a deliberate, audited exception.
  provisioningMode: z.enum(["invite", "direct"]).default("invite"),
});
export type CreateAgencyBusinessInput = z.infer<typeof createAgencyBusinessSchema>;

/**
 * Phase 58 — Clients list search/filter/sort. `status` filter values are deliberately NOT the raw
 * Business.status enum: they mirror apps/admin/src/lib/agencyJourney.ts's businessJourneyStage
 * derivation (status + whether the owner's invite is still pending), the same real, already-
 * established lifecycle model the dashboard/list already display — no new status invented here.
 * "multi_location" filters on locationCount > 1, computed server-side from a live Restaurant count
 * (see agency.controller.ts), never the denormalized counter directly (see Business.ts's own doc
 * comment on why that counter under-counts by exactly one).
 */
export const AGENCY_BUSINESS_STATUS_FILTERS = ["all", "live", "onboarding", "owner_pending", "inactive", "multi_location"] as const;
export type AgencyBusinessStatusFilter = (typeof AGENCY_BUSINESS_STATUS_FILTERS)[number];

export const listAgencyBusinessesQuerySchema = z.object({
  ...paginationQueryShape,
  ...sortableQueryShape(["createdAt", "name", "locationCount"], "createdAt"),
  search: z.string().trim().max(100).optional(),
  status: z.enum(AGENCY_BUSINESS_STATUS_FILTERS).optional(),
});
export type ListAgencyBusinessesQueryInput = z.infer<typeof listAgencyBusinessesQuerySchema>;

/**
 * PATCH /agencies/:agencyId — name/description/logo/contactEmail only. Slug is deliberately
 * immutable here (unchanged from every other slug in this codebase — Business/Restaurant slugs
 * are likewise never editable post-creation, since they're baked into public URLs elsewhere).
 */
export const updateAgencySchema = z
  .object({
    name: z.string().min(2).max(120).optional(),
    description: z.string().max(500).optional(),
    logo: z.string().max(500).optional(),
    contactEmail: z.string().email().optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), { message: "Provide at least one field to update" });
export type UpdateAgencyInput = z.infer<typeof updateAgencySchema>;

/**
 * Phase 58, Section 12A — sets the CANDIDATE white-label domain an agency wants to eventually
 * operate under. Setting this only records intent and starts ownership verification (reusing the
 * exact DNS-TXT mechanism domainVerification.service.ts already established for location custom
 * domains) — it does NOT enable sending email from this domain or branding invitation emails; see
 * agency.controller.ts's setAgencyDomain/verifyAgencyDomain doc comments for exactly what is and
 * isn't real once verified.
 */
export const setAgencyDomainSchema = z.object({
  domain: z
    .string()
    .min(3)
    .max(253)
    .regex(/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i, "Enter a real domain, e.g. garnishtable.com"),
});
export type SetAgencyDomainInput = z.infer<typeof setAgencyDomainSchema>;

/**
 * Phase 59 — what THIS agency charges its OWN client. Every field is optional at the schema level
 * (the `.refine` below only requires at least one to be present) because this is a best-effort,
 * agency-maintained commercial-agreement record, never a payment-collection system — see
 * apps/api/src/models/ClientCommercialTerms.ts's doc comment for the full boundary. `planLabel` is
 * free text, not an enum against the Plan catalog: an agency may legitimately describe its own
 * service tiers differently from the platform's own OWNER plan codes.
 */
export const CLIENT_COMMERCIAL_STATUSES = ["trial", "active", "cancelled"] as const;
export type ClientCommercialStatus = (typeof CLIENT_COMMERCIAL_STATUSES)[number];

export const setClientCommercialTermsSchema = z
  .object({
    planLabel: z.string().trim().max(80).optional(),
    priceAmountCents: z.number().int().min(0).max(100_000_00).optional(),
    currency: z.string().length(3).optional(),
    billingCycle: z.enum(["monthly", "yearly"]).optional(),
    status: z.enum(CLIENT_COMMERCIAL_STATUSES).optional(),
    trialEndsAt: z.string().datetime().optional(),
    startedAt: z.string().datetime().optional(),
    notes: z.string().trim().max(500).optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), { message: "Provide at least one field" });
export type SetClientCommercialTermsInput = z.infer<typeof setClientCommercialTermsSchema>;
