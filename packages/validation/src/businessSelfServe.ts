import { z } from "zod";

const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

// Phase 37 — the self-serve owner-signup counterpart to restaurant.ts's createRestaurantSchema
// (platform_admin, invite-based) and business.controller.ts's createLocationSchema (owner adding a
// SECOND location to an already-existing business). This is specifically "an already-authenticated,
// already-email-verified caller creates their own first business + first location, becoming its
// owner directly" — no owner sub-object (the caller IS the owner), no businessId branch (there is
// no existing business yet by definition).
export const createBusinessSelfServeSchema = z.object({
  name: z.string().min(2).max(120),
  slug: z.string().min(2).max(60).regex(slugPattern, "Use lowercase letters, numbers, and hyphens only"),
  timezone: z.string().min(1).optional(),
  currency: z.string().length(3).optional(),
});
export type CreateBusinessSelfServeInput = z.infer<typeof createBusinessSelfServeSchema>;
