/**
 * Portal UX phase — owner-facing what/why copy for the readiness/setup-checklist data
 * restaurantReadiness.service.ts computes (GET .../readiness, GET .../setup-checklist). Shared by
 * DashboardPage.tsx's in-place "get ready" state and SetupPage.tsx's own checklist, keyed by the
 * same `key` the API returns, so the two pages can never drift into explaining the same step two
 * different ways. The API's own `label` field stays a plain technical description (e.g. "At least
 * one active category with an available menu item") — this is the presentation layer on top of it.
 */
export const READY_CHECK_COPY: Record<string, { title: string; why: string; to: string; linkLabel: string }> = {
  profile: {
    title: "Restaurant profile",
    why: "Tell customers about your restaurant. This is what they see before they order.",
    to: "/settings",
    linkLabel: "Set up profile",
  },
  menu: {
    title: "Menu",
    why: "Add the food customers can order. Nobody can check out until at least one item is available.",
    to: "/menu",
    linkLabel: "Add menu items",
  },
  orderType: {
    title: "Ordering",
    why: "Choose how customers receive their order — pickup, delivery, or dine-in.",
    to: "/delivery",
    linkLabel: "Choose ordering methods",
  },
  location: {
    title: "Restaurant location",
    why: "Delivery needs your restaurant's coordinates to know who's in range.",
    to: "/settings?tab=location",
    linkLabel: "Set location",
  },
};

export const EXTENDED_CHECK_COPY: Record<string, { title: string; why: string; to: string; linkLabel: string }> = {
  branding: {
    title: "Branding",
    why: "Add a logo, cover photo, or brand color so your storefront looks like your restaurant, not a template.",
    to: "/settings?tab=storefront",
    linkLabel: "Add branding",
  },
  hours: {
    title: "Business hours",
    why: "Let customers know when you're open, and stop new orders automatically outside those hours.",
    to: "/settings?tab=hours",
    linkLabel: "Set hours",
  },
  tables: {
    title: "Tables",
    why: "Generate a QR code for each table so dine-in customers can order from their phone.",
    to: "/tables",
    linkLabel: "Add tables",
  },
  kitchen: {
    title: "Kitchen",
    why: "A live prep-status board for the kitchen — new, preparing, ready.",
    to: "/kitchen",
    linkLabel: "Open kitchen",
  },
  staff: {
    title: "Staff",
    why: "Give your team their own logins instead of sharing one owner account.",
    to: "/staff",
    linkLabel: "Add staff",
  },
  loyalty: {
    title: "Loyalty",
    why: "Reward returning customers with points they can redeem for a discount.",
    to: "/loyalty",
    linkLabel: "Set up loyalty",
  },
  domain: {
    title: "Custom domain",
    why: "Use your own web address instead of the default one.",
    to: "/settings?tab=domain",
    linkLabel: "Connect a domain",
  },
  payment: {
    title: "Payment account",
    why: "Connect your own payment account to accept online payments. Cash-only works fine without it.",
    to: "/settings?tab=payment",
    linkLabel: "Connect payment account",
  },
  // Phase 54 — "seo" removed: the API no longer returns it (see restaurantReadiness.service.ts's
  // matching comment) — it was a permanently-"complete", non-actionable item pointing at a
  // Settings page with no corresponding fields.
};

/**
 * Phase 71 — a presentation-only classification on top of the same EXTENDED_CHECK_COPY keys above
 * (the API itself has no "tier" concept, only `status`), splitting SetupPage's previously-flat
 * "More setup" list into Required/Recommended/Optional per the brief's own hierarchy. "Recommended"
 * is operationally significant (money, hours, who's serving); "Optional" is closer to growth/vanity.
 * A key not listed here (there shouldn't be one) falls back to "optional" — see SetupPage.tsx.
 * Deliberately independent of the API's own `status: "optional"` (which means "not applicable to
 * THIS restaurant right now", e.g. Kitchen when kitchenEnabled is false) — SetupPage.tsx layers
 * that check on top of this one, so a Recommended item the restaurant has turned off still displays
 * under Optional, not Recommended.
 */
export const SETUP_ITEM_TIER: Record<string, "recommended" | "optional"> = {
  branding: "recommended",
  hours: "recommended",
  payment: "recommended",
  staff: "recommended",
  tables: "recommended",
  kitchen: "recommended",
  loyalty: "optional",
  domain: "optional",
};
