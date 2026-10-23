import type { AgencyEmailSenderStatus, AgencyWhiteLabelFeature, WhiteLabelCapabilityState } from "@restaurant/types";

/** What each white-label capability does once it is active — and what it needs first. Shared by
 *  Agency Settings (what the agency offers) and the client page (what each client gets). */
export const WHITE_LABEL_FEATURE_COPY: Record<AgencyWhiteLabelFeature, { label: string; description: string }> = {
  storefront_branding: {
    label: "Storefront branding",
    description: "Your brand name, logo and color on the client's ordering pages. Active as soon as it's on.",
  },
  custom_domain: {
    label: "Custom domain",
    description:
      "The client's storefront on its own domain (e.g. order.client.com). Active once a location's domain is verified, activated and its DNS points to the platform.",
  },
  hide_platform_branding: {
    label: "Hide platform branding",
    description: "Removes platform credits from the storefront, sign-in pages and branded emails. Legal, payment and security notices stay.",
  },
  support_branding: {
    label: "Branded support",
    description: "Customers see your support name, plus your support email or help URL if you add them below.",
  },
  email_branding: {
    label: "Branded emails",
    description:
      "Order and invitation emails carry your brand and name. They're sent from the platform's address unless your own sender address is verified below.",
  },
  branded_login: {
    label: "Branded sign-in",
    description: "Customer sign-in pages show your brand — only on the client's own verified custom domain, never on the shared platform site.",
  },
};

export const WHITE_LABEL_STATE_COPY: Record<WhiteLabelCapabilityState, { label: string; tone: "success" | "warning" | "danger" | "neutral" }> = {
  not_offered: { label: "Not offered", tone: "neutral" },
  off: { label: "Off", tone: "neutral" },
  pending_setup: { label: "Pending setup", tone: "warning" },
  active: { label: "Active", tone: "success" },
  failed: { label: "Failed", tone: "danger" },
  suspended: { label: "Suspended", tone: "danger" },
};

export const EMAIL_SENDER_STATUS_COPY: Record<AgencyEmailSenderStatus, { label: string; tone: "success" | "warning" | "danger" | "neutral"; help: string }> = {
  pending_domain: {
    label: "Waiting for domain verification",
    tone: "warning",
    help: "Verify your agency domain above. Until then, branded emails use the platform address.",
  },
  pending_authorization: {
    label: "Waiting for platform authorization",
    tone: "warning",
    help: "Your domain is verified. The platform team still has to authorize its email relay to send for it (SPF/DKIM records at the email provider). Until then, branded emails use the platform address.",
  },
  verified: { label: "Verified — in use", tone: "success", help: "Branded emails are sent from this address." },
  failed: { label: "Rejected", tone: "danger", help: "This address can't be used. Fix the reason given and request it again." },
};
