import { isValidHostname, normalizeHostname } from "@restaurant/validation";
import { env } from "../config/env.js";
import { platformHostnames } from "../config/origins.js";
import { DomainMapping } from "../models/DomainMapping.js";
import { Restaurant } from "../models/Restaurant.js";
import { isSelfClaim } from "./domainVerification.service.js";
import { hasFeatureEntitlement } from "./entitlementLimit.service.js";

/**
 * Phase 86 — the single answer to "is this hostname a live custom storefront domain right now?",
 * shared by the storefront's `GET /restaurants/by-domain/:hostname` lookup and the TLS edge's
 * certificate-issuance check (edge/tlsAskServer.ts). Keeping both on one function means the edge
 * can never issue a certificate for a hostname the storefront would refuse to serve, or the reverse.
 *
 * A hostname is live only when ALL of these hold:
 *  - it is a syntactically valid public hostname (the same @restaurant/validation rules the
 *    dashboard applies when the domain is added),
 *  - it is not a GarnishTable platform hostname,
 *  - its DomainMapping is `active` (activation is only possible from `verified`, i.e. after the
 *    DNS TXT ownership check passed — domain.controller.ts activateDomain),
 *  - the restaurant it maps to is `active`,
 *  - that restaurant's business still holds the `custom_domains` entitlement.
 */
export type CustomDomainDecision =
  | { live: true; hostname: string; restaurantId: string }
  | { live: false; hostname: string | null; reason: CustomDomainDenyReason };

export type CustomDomainDenyReason =
  | "malformed_hostname"
  | "platform_hostname"
  | "not_mapped"
  | "not_active"
  | "restaurant_inactive"
  | "not_entitled";

/** Canonical form, or null when the input can never be a custom domain. */
export function canonicalCustomDomain(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > 300) return null;
  const hostname = normalizeHostname(raw);
  return isValidHostname(hostname) ? hostname : null;
}

export async function resolveCustomDomain(raw: unknown): Promise<CustomDomainDecision> {
  const hostname = canonicalCustomDomain(raw);
  if (!hostname) return { live: false, hostname: null, reason: "malformed_hostname" };
  if (isSelfClaim(hostname, platformHostnames(env))) return { live: false, hostname, reason: "platform_hostname" };

  // One indexed lookup (unique `hostname`) — everything else only runs for a mapped hostname.
  const mapping = await DomainMapping.findOne({ hostname }).select("status locationId").lean();
  if (!mapping) return { live: false, hostname, reason: "not_mapped" };
  if (mapping.status !== "active") return { live: false, hostname, reason: "not_active" };

  const restaurant = await Restaurant.findOne({ _id: mapping.locationId, status: "active" }).select("businessId").lean();
  if (!restaurant) return { live: false, hostname, reason: "restaurant_inactive" };
  if (restaurant.businessId && !(await hasFeatureEntitlement("business", restaurant.businessId.toString(), "custom_domains"))) {
    return { live: false, hostname, reason: "not_entitled" };
  }
  return { live: true, hostname, restaurantId: restaurant._id.toString() };
}
