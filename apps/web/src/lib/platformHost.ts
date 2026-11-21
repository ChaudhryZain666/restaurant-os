/**
 * Phase 88 — the storefront's own platform hostname (from VITE_SITE_URL, e.g. order.garnishtable.com)
 * can never be a restaurant's custom domain: the API refuses to map platform hostnames
 * (isSelfClaim). So on that host a bare storefront path has nothing to look up, and asking
 * `GET /restaurants/by-domain/<platform host>` only produced a guaranteed 404 (console noise in
 * production QA). Custom domains — any other hostname — still resolve exactly as before.
 */
/** QA-009 — the platform's own name, shown in place of the generic "Restaurant" placeholder on a
 *  page with no restaurant (the bare root, an unknown slug, sign-in) — but only on the platform's
 *  own storefront host. Any other host may be a restaurant's or agency's white-labeled domain,
 *  which must never show platform branding, so it keeps the neutral placeholder. */
export const PLATFORM_BRAND_NAME = "GarnishTable";

export function platformBrandName(opts: {
  hasRestaurant: boolean;
  hostname: string;
  siteUrl: string | undefined;
}): string | undefined {
  if (opts.hasRestaurant) return undefined;
  return isPlatformStorefrontHost(opts.hostname, opts.siteUrl) ? PLATFORM_BRAND_NAME : undefined;
}

export function isPlatformStorefrontHost(hostname: string, siteUrl: string | undefined): boolean {
  if (!siteUrl) return false;
  try {
    return new URL(siteUrl).hostname.toLowerCase() === hostname.toLowerCase();
  } catch {
    return false;
  }
}
