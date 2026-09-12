const STOREFRONT_ORIGIN = import.meta.env.VITE_STOREFRONT_URL ?? "http://localhost:5173";
// Phase 64 — the marketing site's own real, backend-wired contact form (apps/marketing's
// ContactPage.tsx) is the one place this platform already collects "talk to a human" requests. No
// second contact/CRM mechanism is built for the Agency Portal's "custom package" CTA — it just
// routes there, same env-var-with-dev-fallback pattern as STOREFRONT_ORIGIN above.
const MARKETING_ORIGIN = import.meta.env.VITE_MARKETING_URL ?? "http://localhost:5175";

/** The public marketing site's contact form — used by the Agency Portal's "contact us about a
 *  custom package" CTA (larger-than-public-plan agencies). Opens in a new tab; no auth carried
 *  over, since the marketing contact form is itself unauthenticated. */
export const MARKETING_CONTACT_URL = `${MARKETING_ORIGIN}/contact`;

/** The customer storefront's real, public URL for this restaurant — only valid once published. */
export function storefrontUrl(slug: string): string {
  return `${STOREFRONT_ORIGIN}/r/${slug}`;
}

/** An authenticated, read-only preview of the storefront — works even while the restaurant is
 *  still pending (see restaurant.controller.ts's previewRestaurantBySlug). Opened in a new tab;
 *  the owner must already be logged into apps/web with the SAME account for it to resolve, since
 *  the preview endpoint is tenant-scoped to the caller's own restaurant. */
export function previewUrl(slug: string): string {
  return `${STOREFRONT_ORIGIN}/r/${slug}/preview`;
}
