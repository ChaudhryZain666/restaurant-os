import { z } from "zod";

// Phase 56 — the marketing site's Contact page and "Request a guided demo" lead form (LeadForm.tsx)
// were both genuinely non-functional (a client-side-only setSubmitted(true), no network call at
// all) — honestly disclosed to the visitor as a preview, but still a real gap for a site meant to
// convert a prospect. This is the shared shape both forms submit to POST /public/contact. Only
// name/email are required — LeadForm's own fields (role, restaurant count, interests) and
// ContactPage's (reason, restaurant type, location count) are a superset of optional context, since
// one endpoint serves both forms rather than inventing two.
export const contactFormSchema = z.object({
  name: z.string().min(1).max(200),
  email: z.string().email(),
  message: z.string().max(4000).optional(),
  reason: z.string().max(100).optional(),
  businessName: z.string().max(200).optional(),
  phone: z.string().max(30).optional(),
  restaurantType: z.string().max(100).optional(),
  locationCount: z.number().int().positive().max(10_000).optional(),
  role: z.string().max(100).optional(),
  interests: z.array(z.string().max(100)).max(20).optional(),
});
export type ContactFormInput = z.infer<typeof contactFormSchema>;
