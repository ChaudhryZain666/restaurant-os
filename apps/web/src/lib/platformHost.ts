/**
 * Phase 88 — the storefront's own platform hostname (from VITE_SITE_URL, e.g. order.garnishtable.com)
 * can never be a restaurant's custom domain: the API refuses to map platform hostnames
 * (isSelfClaim). So on that host a bare storefront path has nothing to look up, and asking
 * `GET /restaurants/by-domain/<platform host>` only produced a guaranteed 404 (console noise in
 * production QA). Custom domains — any other hostname — still resolve exactly as before.
 */
export function isPlatformStorefrontHost(hostname: string, siteUrl: string | undefined): boolean {
  if (!siteUrl) return false;
  try {
    return new URL(siteUrl).hostname.toLowerCase() === hostname.toLowerCase();
  } catch {
    return false;
  }
}
