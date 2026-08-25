// Central place for the two "escape hatches" out of the marketing site into the real product —
// the live customer storefront (demo) and the restaurant-owner admin login. Both are separate
// Vite apps/ports in local dev, and separate deployed origins in production — env-driven with the
// local-dev ports as fallback, same pattern as VITE_RESTAURANT_SLUG in apps/web.
export const STOREFRONT_URL = import.meta.env.VITE_STOREFRONT_URL ?? "http://localhost:5173";
export const ADMIN_URL = import.meta.env.VITE_ADMIN_URL ?? "http://localhost:5174";
export const ADMIN_LOGIN_URL = `${ADMIN_URL}/login`;
// Phase 28 — the real plan-first agency signup wizard (AgencySignupWizardPage.tsx). Owners don't
// self-serve signup (they're always invited by an agency or platform admin — see RegisterPage.tsx's
// doc comment), so this is specifically "start an agency," not a generic "start a trial" link.
export const ADMIN_START_URL = `${ADMIN_URL}/start`;
