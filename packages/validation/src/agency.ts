import { z } from "zod";

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
