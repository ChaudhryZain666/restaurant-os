// Central place for the two "escape hatches" out of the marketing site into the real product —
// the live customer storefront (demo) and the restaurant-owner admin login. Both are separate
// Vite apps/ports in local dev, and separate deployed origins in production — env-driven with the
// local-dev ports as fallback, same pattern as VITE_RESTAURANT_SLUG in apps/web.
export const STOREFRONT_URL = import.meta.env.VITE_STOREFRONT_URL ?? "http://localhost:5173";
/** The live demo restaurant's slug (provisioned by apps/api/src/scripts/provisionProductionDemo.ts). */
export const DEMO_RESTAURANT_SLUG = "demo-restaurant";
/** The demo restaurant by its own path. The storefront ROOT has no restaurant (it only resolves
 *  restaurant custom domains), so every "see the demo" link must use this, never STOREFRONT_URL.
 *  Also skips the root's custom-domain lookup, so the embedded demo never flashes a "can't find
 *  that restaurant" frame. */
export const DEMO_STOREFRONT_URL = `${STOREFRONT_URL}/r/${DEMO_RESTAURANT_SLUG}`;
/** The demo restaurant's guided "experience" page (demo-guest checkout). */
export const DEMO_EXPERIENCE_URL = `${DEMO_STOREFRONT_URL}/experience`;
export const ADMIN_URL = import.meta.env.VITE_ADMIN_URL ?? "http://localhost:5174";
export const ADMIN_LOGIN_URL = `${ADMIN_URL}/login`;
// Phase 28 — the real plan-first agency signup wizard (AgencySignupWizardPage.tsx). Specifically
// "start an agency," not a generic "start a trial" link.
export const ADMIN_START_URL = `${ADMIN_URL}/start`;
// Phase 44 — the owner counterpart (OwnerSignupWizardPage.tsx): an independent restaurant owner's
// real self-serve entry point, wired to StartTrialPage's "Running a single restaurant?" CTA.
export const ADMIN_SIGNUP_URL = `${ADMIN_URL}/signup`;
