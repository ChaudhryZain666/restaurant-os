import type { SupportIdentity } from "@restaurant/types";
import type { RestaurantDoc } from "../models/Restaurant.js";
import { getSupportIdentity } from "./supportIdentity.service.js";
import { isFeatureInForce, loadClientWhiteLabelContext } from "./whiteLabelStatus.service.js";

export interface CustomerWhiteLabelBrand {
  name: string;
  logo?: string;
  primaryColor?: string;
  hidePlatformBranding: boolean;
  brandedLogin: boolean;
  storefrontBranding: boolean;
}

export interface CustomerWhiteLabelProjection {
  whiteLabelBrand: CustomerWhiteLabelBrand | null;
  supportIdentity: SupportIdentity;
}

/** Only https URLs are ever rendered on a public page (the schema already refuses anything else;
 *  this also covers values stored before that validation existed). */
export function safeHttpsUrl(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  try {
    return new URL(value).protocol === "https:" ? value : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The public, customer-facing white-label projection for a restaurant's storefront response. Each
 * part appears only while its capability is in force (agency active + white-label on + offered +
 * selected — whiteLabelStatus.service.ts isFeatureInForce). Never includes the agency's contact
 * email, domain, verification tokens, sender settings, membership or any internal field.
 *
 * `resolvedVia` is how the storefront found this restaurant. Branded sign-in is only granted for
 * "domain" — the restaurant's own verified, active custom domain (resolveCustomDomain) — so the
 * shared platform host and any /r/:slug URL never show another brand's sign-in screen.
 */
export async function getCustomerWhiteLabelProjection(
  restaurant: Pick<RestaurantDoc, "businessId">,
  resolvedVia: "slug" | "domain" = "slug"
): Promise<CustomerWhiteLabelProjection> {
  const fallback = { whiteLabelBrand: null, supportIdentity: getSupportIdentity() };
  const ctx = await loadClientWhiteLabelContext(restaurant.businessId);
  if (!ctx) return fallback;

  const { agency } = ctx;
  const storefront = isFeatureInForce(ctx, "storefront_branding");
  const hidePlatformBranding = isFeatureInForce(ctx, "hide_platform_branding");
  const brandedLogin = resolvedVia === "domain" && isFeatureInForce(ctx, "branded_login");
  const supportBranding = isFeatureInForce(ctx, "support_branding");
  const brandName = agency.brandName?.trim() || agency.name;
  const logo = safeHttpsUrl(agency.logo);

  const whiteLabelBrand =
    storefront || hidePlatformBranding || brandedLogin
      ? {
          name: brandName,
          ...(logo && (storefront || brandedLogin) ? { logo } : {}),
          ...((storefront || brandedLogin) && agency.brandPrimaryColor ? { primaryColor: agency.brandPrimaryColor } : {}),
          hidePlatformBranding,
          brandedLogin,
          storefrontBranding: storefront,
        }
      : null;

  const supportUrl = safeHttpsUrl(agency.supportUrl);
  const supportIdentity: SupportIdentity = supportBranding
    ? {
        name: brandName,
        isWhiteLabel: true,
        ...(agency.supportEmail ? { email: agency.supportEmail } : {}),
        ...(supportUrl ? { url: supportUrl } : {}),
      }
    : getSupportIdentity();

  return { whiteLabelBrand, supportIdentity };
}
