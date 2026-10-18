import type { RestaurantDoc } from "../models/Restaurant.js";
import { Business } from "../models/Business.js";
import { Agency } from "../models/Agency.js";
import { getSupportIdentity } from "./supportIdentity.service.js";

export interface CustomerWhiteLabelBrand {
  name: string;
  logo?: string;
  primaryColor?: string;
  hidePlatformBranding: boolean;
  brandedLogin: boolean;
}

export interface CustomerWhiteLabelProjection {
  whiteLabelBrand: CustomerWhiteLabelBrand | null;
  supportIdentity: { name: string; isWhiteLabel: boolean };
}

/**
 * Only returns customer-facing agency identity when the agency has explicitly enabled
 * white-label mode AND this business has selected the corresponding feature. DNS ownership
 * verification alone is deliberately not treated as a live storefront/email capability.
 */
export async function getCustomerWhiteLabelProjection(
  restaurant: RestaurantDoc,
): Promise<CustomerWhiteLabelProjection> {
  const fallback = {
    whiteLabelBrand: null,
    supportIdentity: getSupportIdentity(restaurant),
  };
  if (!restaurant.businessId) return fallback;

  const business = await Business.findById(restaurant.businessId).select("agencyId whiteLabelFeatures");
  if (!business?.agencyId || !business.whiteLabelFeatures?.length) return fallback;

  const agency = await Agency.findOne({ _id: business.agencyId, status: "active" })
    .select("name brandName brandPrimaryColor logo whiteLabelEnabled whiteLabelOfferings");
  if (!agency?.whiteLabelEnabled) return fallback;

  const selected = new Set(business.whiteLabelFeatures);
  const offered = new Set(agency.whiteLabelOfferings ?? []);
  const enabled = (feature: string) => selected.has(feature) && offered.has(feature);
  const storefront = enabled("storefront_branding");
  const hidePlatformBranding = enabled("hide_platform_branding");
  const brandedLogin = enabled("branded_login");
  const supportBranding = enabled("support_branding");

  const hasCustomerBrand = storefront || hidePlatformBranding || brandedLogin || supportBranding;
  const whiteLabelBrand = hasCustomerBrand
    ? {
        name: agency.brandName?.trim() || agency.name,
        ...(agency.logo ? { logo: agency.logo } : {}),
        ...(agency.brandPrimaryColor ? { primaryColor: agency.brandPrimaryColor } : {}),
        hidePlatformBranding,
        brandedLogin,
      }
    : null;

  return {
    whiteLabelBrand,
    supportIdentity: supportBranding
      ? { name: agency.brandName?.trim() || agency.name, isWhiteLabel: true }
      : getSupportIdentity(restaurant),
  };
}
