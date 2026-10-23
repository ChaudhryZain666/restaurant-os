import type { WhiteLabelBrand } from "../context/RestaurantContext";

/** A plain rounded square — used when platform branding is hidden and there's no logo to show. */
export const NEUTRAL_FAVICON =
  "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="#78716c"/></svg>');

function https(url: string | null | undefined): string | null {
  return url && url.startsWith("https://") ? url : null;
}

/**
 * Which favicon a storefront page should show. null = keep the platform default (index.html).
 *  - storefront_branding with an agency logo → the agency logo;
 *  - hide_platform_branding → the restaurant's own logo, else a neutral icon (never the platform's);
 *  - otherwise the platform default.
 */
export function faviconFor(brand: WhiteLabelBrand | null, restaurantLogo: string | null | undefined): string | null {
  if (!brand) return null;
  const agencyLogo = brand.storefrontBranding ? https(brand.logo) : null;
  if (agencyLogo) return agencyLogo;
  if (brand.hidePlatformBranding) return https(restaurantLogo) ?? NEUTRAL_FAVICON;
  return null;
}
