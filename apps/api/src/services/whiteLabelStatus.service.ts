import type { HydratedDocument } from "mongoose";
import type {
  AgencyWhiteLabelFeature,
  BusinessWhiteLabelStatus,
  WhiteLabelCapabilityStatus,
  WhiteLabelDomainCheck,
} from "@restaurant/types";
import { AGENCY_WHITE_LABEL_FEATURES } from "@restaurant/types";
import { env } from "../config/env.js";
import { Agency, type AgencyDoc } from "../models/Agency.js";
import { Business, type BusinessDoc } from "../models/Business.js";
import { DomainMapping } from "../models/DomainMapping.js";
import { getDnsVerifier } from "../dns/index.js";
import { resolveCustomDomain } from "./customDomain.service.js";
import { verificationRecordHost } from "./domainVerification.service.js";

/**
 * White-label runtime — the single server-side answer to "which white-label capabilities are in
 * force for this client, and how ready is each one?". Every customer-facing surface (storefront
 * projection, emails, sign-in) gates on `isFeatureInForce`; the agency's management UI reads
 * `getBusinessWhiteLabelStatus`. A selection flag alone never makes anything active.
 */

export interface ClientWhiteLabelContext {
  agency: HydratedDocument<AgencyDoc>;
  business: HydratedDocument<BusinessDoc>;
}

/** A capability is in force only when the agency is active, has white-label mode on, offers the
 *  capability, AND the business has it selected. */
export function isFeatureInForce(ctx: ClientWhiteLabelContext, feature: AgencyWhiteLabelFeature): boolean {
  const { agency, business } = ctx;
  return (
    agency.status === "active" &&
    agency.whiteLabelEnabled === true &&
    (agency.whiteLabelOfferings ?? []).includes(feature) &&
    (business.whiteLabelFeatures ?? []).includes(feature)
  );
}

/** The managing agency and business for a business id, or null for an individually-owned
 *  business (no agency) or one with no white-label selections at all. */
export async function loadClientWhiteLabelContext(businessId: unknown): Promise<ClientWhiteLabelContext | null> {
  if (!businessId) return null;
  const business = await Business.findById(businessId);
  if (!business?.agencyId || !(business.whiteLabelFeatures ?? []).length) return null;
  const agency = await Agency.findById(business.agencyId);
  if (!agency) return null;
  return { agency, business };
}

/** True when the agency's emailSender may be used as "From" right now — re-checked at every use,
 *  so a later domain change or a second agency claiming the domain can't leave a stale "verified". */
export async function senderIsUsable(agency: HydratedDocument<AgencyDoc>): Promise<boolean> {
  const sender = agency.emailSender;
  if (!sender || sender.status !== "verified") return false;
  if (agency.domainStatus !== "verified" || !agency.domain) return false;
  if (sender.address.split("@")[1] !== agency.domain) return false;
  const rival = await Agency.exists({ _id: { $ne: agency._id }, domain: agency.domain, domainStatus: "verified" });
  return !rival;
}

/** Live custom-domain readiness for every location of a business. A hostname counts only when the
 *  platform would serve it (resolveCustomDomain — the same decision the TLS edge uses) AND, when
 *  `checkDns`, its CNAME points at CUSTOM_DOMAIN_CNAME_TARGET. */
export async function checkBusinessDomains(businessId: unknown, checkDns: boolean): Promise<WhiteLabelDomainCheck[]> {
  const mappings = await DomainMapping.find({ businessId }).select("hostname status locationId").sort({ createdAt: 1 });
  const target = env.CUSTOM_DOMAIN_CNAME_TARGET?.toLowerCase().replace(/\.$/, "");
  return Promise.all(
    mappings.map(async (m) => {
      const live = m.status === "active" && (await resolveCustomDomain(m.hostname)).live;
      let dnsPointsToEdge: boolean | null = null;
      if (live && checkDns && target) {
        dnsPointsToEdge = (await getDnsVerifier().resolveCname(m.hostname)).includes(target);
      }
      return {
        hostname: m.hostname,
        locationId: m.locationId.toString(),
        mappingStatus: m.status as WhiteLabelDomainCheck["mappingStatus"],
        live,
        dnsPointsToEdge,
      };
    })
  );
}

function domainReadiness(domains: WhiteLabelDomainCheck[]): { ready: boolean; blockers: string[]; failed: boolean } {
  if (!env.CUSTOM_DOMAIN_CNAME_TARGET) {
    return {
      ready: false,
      failed: false,
      blockers: ["The platform isn't set up to serve custom domains in this environment (CUSTOM_DOMAIN_CNAME_TARGET is not configured)."],
    };
  }
  if (domains.some((d) => d.live && d.dnsPointsToEdge !== false)) return { ready: true, blockers: [], failed: false };
  if (domains.length === 0) {
    return { ready: false, failed: false, blockers: ["Add a domain to one of this client's locations (location Settings → Custom domain)."] };
  }
  const blockers: string[] = [];
  let failed = false;
  for (const d of domains) {
    if (d.mappingStatus === "pending_verification") {
      blockers.push(`${d.hostname}: publish the TXT record at ${verificationRecordHost(d.hostname)}, then check verification.`);
    } else if (d.mappingStatus === "verified") {
      blockers.push(`${d.hostname}: ownership is verified — activate it for its location.`);
    } else if (!d.live) {
      failed = true;
      blockers.push(`${d.hostname}: activated, but not being served — the location isn't published or the plan no longer includes custom domains.`);
    } else if (d.dnsPointsToEdge === false) {
      blockers.push(`${d.hostname}: point a CNAME record at ${env.CUSTOM_DOMAIN_CNAME_TARGET} (no CNAME to it was found).`);
    }
  }
  return { ready: false, blockers, failed: failed && blockers.length === domains.length };
}

const FEATURE_LABEL: Record<AgencyWhiteLabelFeature, string> = {
  storefront_branding: "Storefront branding",
  custom_domain: "Custom domain",
  hide_platform_branding: "Hide platform branding",
  support_branding: "Branded support",
  email_branding: "Branded emails",
  branded_login: "Branded sign-in",
};

/**
 * Readiness of all six capabilities for one business. `checkDns` performs a live CNAME lookup per
 * active domain (bounded by the resolver's own timeout); callers pass true for an explicit check.
 */
export async function getBusinessWhiteLabelStatus(
  agency: HydratedDocument<AgencyDoc>,
  business: HydratedDocument<BusinessDoc>,
  { checkDns = true }: { checkDns?: boolean } = {}
): Promise<BusinessWhiteLabelStatus> {
  const selected = new Set<string>(business.whiteLabelFeatures ?? []);
  const offered = new Set<string>(agency.whiteLabelOfferings ?? []);
  const needsDomains = selected.has("custom_domain") || selected.has("branded_login");
  const domains = needsDomains ? await checkBusinessDomains(business._id, checkDns) : [];
  const domain = domainReadiness(domains);
  const usableSender = selected.has("email_branding") ? await senderIsUsable(agency) : false;

  const capabilities: WhiteLabelCapabilityStatus[] = AGENCY_WHITE_LABEL_FEATURES.map((feature) => {
    const isSelected = selected.has(feature);
    const base = { feature, selected: isSelected, blockers: [] as string[] };
    const label = FEATURE_LABEL[feature];

    if (!isSelected) {
      const available = agency.status === "active" && agency.whiteLabelEnabled && offered.has(feature);
      return available
        ? { ...base, state: "off" as const, summary: `${label} is available but not turned on for this client.` }
        : { ...base, state: "not_offered" as const, summary: `${label} isn't offered by your agency.` };
    }
    if (agency.status !== "active") {
      return { ...base, state: "suspended" as const, summary: `${label} is paused because the agency account isn't active.` };
    }
    if (!agency.whiteLabelEnabled) {
      return { ...base, state: "suspended" as const, summary: `${label} is paused because white-label mode is off for the agency.` };
    }
    if (!offered.has(feature)) {
      return { ...base, state: "suspended" as const, summary: `${label} is paused because the agency no longer offers it.` };
    }
    // From here on the capability is in force (isFeatureInForce(ctx, feature) holds) — readiness
    // depends only on its own prerequisites.
    switch (feature) {
      case "storefront_branding":
        return { ...base, state: "active" as const, summary: "The storefront shows the agency brand name, logo and color." };
      case "hide_platform_branding":
        return {
          ...base,
          state: "active" as const,
          summary: "Platform credits are hidden on the storefront, sign-in pages and branded emails. Legal, payment and security notices stay.",
        };
      case "support_branding": {
        const contact = agency.supportEmail || agency.supportUrl;
        return {
          ...base,
          state: "active" as const,
          summary: contact
            ? "Customers see the agency's support name and contact on help surfaces."
            : "Customers see the agency's support name. Add a support email or URL in Agency settings to show a contact.",
        };
      }
      case "custom_domain":
        if (domain.ready) {
          return { ...base, state: "active" as const, summary: "A verified custom domain is serving this client's storefront.", domains };
        }
        return {
          ...base,
          state: domain.failed ? ("failed" as const) : ("pending_setup" as const),
          summary: domain.failed ? "The client's custom domain stopped being served." : "Selected — the custom domain isn't serving customers yet.",
          blockers: domain.blockers,
          domains,
        };
      case "branded_login":
        // The sign-in page can only be branded on a hostname the platform trusts for this client:
        // its own verified custom domain. On the shared platform host it is never branded.
        if (domain.ready) {
          return { ...base, state: "active" as const, summary: "The customer sign-in pages on the client's custom domain are branded.", domains };
        }
        return {
          ...base,
          state: "pending_setup" as const,
          summary: "Selected — branded sign-in appears only on the client's verified custom domain, which isn't live yet.",
          blockers: domain.blockers,
          domains,
        };
      case "email_branding": {
        const sender = agency.emailSender;
        const senderInfo = {
          address: sender?.address ?? null,
          status: (sender?.status ?? "not_requested") as NonNullable<WhiteLabelCapabilityStatus["sender"]>["status"],
          platformSender: !usableSender,
        };
        const senderNote = usableSender
          ? `Sent from ${sender!.address}.`
          : "Sent from the platform's own address with the agency's name; a custom sender address isn't in use.";
        const blockers: string[] = [];
        if (sender && !usableSender) {
          if (sender.status === "pending_domain") blockers.push(`Custom sender ${sender.address}: verify the agency domain that address belongs to.`);
          if (sender.status === "pending_authorization") blockers.push(`Custom sender ${sender.address}: waiting for the platform team to confirm the email relay is authorized for it.`);
          if (sender.status === "failed") blockers.push(`Custom sender ${sender.address} was rejected${sender.failureReason ? `: ${sender.failureReason}` : ""}.`);
          if (sender.status === "verified") blockers.push(`Custom sender ${sender.address} is no longer valid for the agency's verified domain — set it again.`);
        }
        return {
          ...base,
          state: "active" as const,
          summary: `Order and invitation emails carry the agency brand. ${senderNote}`,
          blockers,
          sender: senderInfo,
        };
      }
    }
  });

  return { businessId: business.id as string, capabilities };
}
