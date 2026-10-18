import { Restaurant } from "../models/Restaurant.js";
import { DomainMapping } from "../models/DomainMapping.js";
import type { EmailSenderOverride } from "../email/EmailService.js";
import { safeHttpsUrl } from "./customerWhiteLabel.service.js";
import { resolveCustomDomain } from "./customDomain.service.js";
import { isFeatureInForce, loadClientWhiteLabelContext, senderIsUsable } from "./whiteLabelStatus.service.js";

/**
 * White-label `email_branding` — the brand applied to an agency-managed client's transactional
 * email. Resolved fresh at send time from the business the email is about (never from request
 * input), so one tenant's brand or sender can never be applied to another tenant's email.
 *
 * What changes when it's in force:
 *  - the template header/footer carry the agency brand (name, https logo, color);
 *  - the sender display name is the agency brand, on the platform's own EMAIL_FROM address;
 *  - the agency's custom sender address is used instead ONLY when senderIsUsable() — verified by a
 *    platform admin, on the agency's DNS-verified domain, not claimed by another agency;
 *  - Reply-To is the agency's support email only when it is on that same verified domain.
 * Security email (password reset, verification, email change) and platform billing email are never
 * routed through this — they stay platform-branded, with links on the platform's own origin.
 */
export interface EmailBrand {
  name: string;
  logo?: string;
  color?: string;
  hidePlatformBranding: boolean;
  from: EmailSenderOverride;
  replyTo?: string;
}

async function brandForContext(ctx: NonNullable<Awaited<ReturnType<typeof loadClientWhiteLabelContext>>>): Promise<EmailBrand | null> {
  if (!isFeatureInForce(ctx, "email_branding")) return null;
  const { agency } = ctx;
  const name = agency.brandName?.trim() || agency.name;
  const usable = await senderIsUsable(agency);
  const logo = safeHttpsUrl(agency.logo);
  const replyTo =
    usable && agency.supportEmail && agency.supportEmail.split("@")[1] === agency.domain ? agency.supportEmail : undefined;
  return {
    name,
    ...(logo ? { logo } : {}),
    ...(agency.brandPrimaryColor ? { color: agency.brandPrimaryColor } : {}),
    hidePlatformBranding: isFeatureInForce(ctx, "hide_platform_branding"),
    from: usable ? { name, address: agency.emailSender!.address } : { name },
    ...(replyTo ? { replyTo } : {}),
  };
}

export async function resolveEmailBrandForBusiness(businessId: unknown): Promise<EmailBrand | null> {
  const ctx = await loadClientWhiteLabelContext(businessId);
  return ctx ? brandForContext(ctx) : null;
}

export async function resolveEmailBrandForRestaurant(restaurantId: unknown): Promise<EmailBrand | null> {
  const restaurant = await Restaurant.findById(restaurantId).select("businessId");
  return restaurant ? resolveEmailBrandForBusiness(restaurant.businessId) : null;
}

/**
 * The storefront origin for links in a customer email about this restaurant: its own custom domain
 * when white-label `custom_domain` is in force for its client AND the platform serves that hostname
 * right now (resolveCustomDomain — the TLS edge's decision); otherwise the platform storefront.
 * Only used for links that carry no secret (order tracking) — never for reset/verification tokens.
 */
export async function storefrontOriginForRestaurant(restaurantId: unknown, platformOrigin: string): Promise<string> {
  const restaurant = await Restaurant.findById(restaurantId).select("businessId");
  if (!restaurant) return platformOrigin;
  const ctx = await loadClientWhiteLabelContext(restaurant.businessId);
  if (!ctx || !isFeatureInForce(ctx, "custom_domain")) return platformOrigin;
  const mapping = await DomainMapping.findOne({ locationId: restaurant._id, status: "active" }).select("hostname");
  if (!mapping) return platformOrigin;
  const decision = await resolveCustomDomain(mapping.hostname);
  return decision.live && decision.restaurantId === restaurant.id ? `https://${decision.hostname}` : platformOrigin;
}
