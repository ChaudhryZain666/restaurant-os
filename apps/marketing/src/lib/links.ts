// Central place for the two "escape hatches" out of the marketing site into the real product —
// the live customer storefront (demo) and the restaurant-owner admin login. Both are separate
// Vite apps/ports in local dev, and separate deployed origins in production — env-driven with the
// local-dev ports as fallback, same pattern as VITE_RESTAURANT_SLUG in apps/web.
export const STOREFRONT_URL = import.meta.env.VITE_STOREFRONT_URL ?? "http://localhost:5173";
export const ADMIN_URL = import.meta.env.VITE_ADMIN_URL ?? "http://localhost:5174";
export const ADMIN_LOGIN_URL = `${ADMIN_URL}/login`;
