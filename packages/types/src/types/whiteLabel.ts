import type { AgencyEmailSenderStatus, AgencyWhiteLabelFeature } from "./agency.js";

/**
 * The readiness of one white-label capability for one client business, computed on the server from
 * what is actually verified — never from the selection flag alone.
 *  - not_offered: the agency doesn't offer it (or white-label mode is off) and it isn't selected;
 *  - off: offered, not selected for this client;
 *  - pending_setup: selected, but a prerequisite isn't met yet (see `blockers`);
 *  - active: selected and every prerequisite is verified — the customer-facing behavior is on;
 *  - failed: selected, and a prerequisite that was met has since failed (e.g. a plan lapse);
 *  - suspended: selected, but the agency stopped offering it, turned white-label off, or is suspended.
 */
export const WHITE_LABEL_CAPABILITY_STATES = ["not_offered", "off", "pending_setup", "active", "failed", "suspended"] as const;
export type WhiteLabelCapabilityState = (typeof WHITE_LABEL_CAPABILITY_STATES)[number];

export interface WhiteLabelDomainCheck {
  hostname: string;
  locationId: string;
  /** DomainMapping status as stored. */
  mappingStatus: "pending_verification" | "verified" | "active";
  /** True when the platform would serve this hostname right now (same decision as the TLS edge). */
  live: boolean;
  /** Whether a CNAME to the platform edge was found; null when not checked (mapping not live). */
  dnsPointsToEdge: boolean | null;
}

export interface WhiteLabelCapabilityStatus {
  feature: AgencyWhiteLabelFeature;
  selected: boolean;
  state: WhiteLabelCapabilityState;
  /** One plain sentence describing the current state. */
  summary: string;
  /** What must happen before it can become active; empty when active or not selected. */
  blockers: string[];
  domains?: WhiteLabelDomainCheck[];
  /** email_branding only. */
  sender?: { address: string | null; status: AgencyEmailSenderStatus | "not_requested"; platformSender: boolean };
}

export interface BusinessWhiteLabelStatus {
  businessId: string;
  capabilities: WhiteLabelCapabilityStatus[];
}
