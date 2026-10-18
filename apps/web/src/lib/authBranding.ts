import type { WhiteLabelBrand } from "../context/RestaurantContext";

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

export interface AuthBranding {
  name: string;
  logo?: string;
  primaryColor?: string;
}

/**
 * White-label `branded_login` — the brand for a customer sign-in page, or null for the platform's
 * own. Only when the storefront resolved the restaurant through its verified custom domain
 * ("domain") AND the API said branded sign-in is in force there. Anything else — a /r/:slug URL,
 * the shared platform host, an unknown or inactive domain (which never resolves), or a brand that
 * doesn't carry the flag — gets the platform screen. Never reads the URL, query or storage.
 */
export function authBrandingFor(brand: WhiteLabelBrand | null, resolvedVia: "slug" | "domain" | "none"): AuthBranding | null {
  if (resolvedVia !== "domain" || !brand?.brandedLogin) return null;
  return {
    name: brand.name,
    ...(brand.logo?.startsWith("https://") ? { logo: brand.logo } : {}),
    ...(brand.primaryColor && HEX_COLOR.test(brand.primaryColor) ? { primaryColor: brand.primaryColor } : {}),
  };
}
