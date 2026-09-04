import type { RestaurantThemeConfig } from "./theme.js";

export type RestaurantStatus = "pending" | "active" | "suspended";

export const WEEKDAYS = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
] as const;
export type Weekday = (typeof WEEKDAYS)[number];

export interface BusinessHoursDay {
  day: Weekday;
  isClosed: boolean;
  /** "HH:mm", 24h. Absent when isClosed. */
  open?: string;
  close?: string;
}

export interface RestaurantSettings {
  currency: string;
  timezone: string;
  orderingEnabled: boolean;
  pickupEnabled: boolean;
  deliveryEnabled: boolean;
  dineInEnabled: boolean;
  /** Payment methods offered to customers. There is no per-restaurant provider-credential field —
   *  this platform uses one platform-owned payment-provider account (see
   *  docs/payment-provider-decision.md); this is purely a per-restaurant opt-in/opt-out toggle. */
  cashEnabled: boolean;
  onlinePaymentEnabled: boolean;
  minOrderAmount: number;
  /** Fractional tax rate, e.g. 0.0825 for 8.25%. */
  taxRate: number;
  deliveryFee: number;
  /** Straight-line (Haversine) radius from the restaurant's own latitude/longitude, in
   *  kilometers — the delivery-eligibility boundary (see docs/delivery-architecture.md). Only
   *  meaningful once the restaurant has coordinates set; undefined/restaurant-without-coordinates
   *  means delivery eligibility can't be computed at all, not "unlimited range." */
  deliveryRadiusKm?: number;
  businessHours: BusinessHoursDay[];
  /** Short-term "86'd" toggle — distinct from orderingEnabled, which is the indefinite kill switch. */
  temporarilyPaused: boolean;
  pausedReason?: string;
  /**
   * Optional 6-digit hex color (e.g. "#C2410C") overriding the storefront's default primary
   * brand color. Purely presentational — see apps/web's ThemeProvider. Never affects pricing,
   * permissions, availability, or any other business logic; validated server-side as a strict
   * hex pattern, so it can never carry CSS/JS injection.
   */
  brandColor?: string;
  /** Phase 28 — restaurant-level feature toggles. Hide the corresponding nav/route and disable the
   *  corresponding functionality; never delete any underlying data — re-enabling restores it. */
  kitchenEnabled?: boolean;
  staffEnabled?: boolean;
  /** POS phase — same opt-in-off-by-default pattern as dineInEnabled. Hides the POS nav item and
   *  is independently re-checked server-side (POST .../pos/orders), same as every other settings
   *  gate here. */
  posEnabled?: boolean;
  /**
   * Phase 28 — optional distance-tiered delivery fee. The tier with the smallest maxDistanceKm
   * that still covers the order's actual distance applies (entry order doesn't matter); if none
   * match, or this array is unset/empty, `deliveryFee` above is used as a flat fallback — fully
   * backward compatible with every restaurant that never configures tiers.
   */
  deliveryFeeTiers?: Array<{ maxDistanceKm: number; fee: number }>;
  /** Phase 31 — the PUBLISHED theme configuration, always present (defaults to the "classic" theme
   *  with no overrides), returned on every restaurant response including the public/anonymous
   *  storefront one. See docs/theme-architecture.md's "Draft vs published" section. */
  theme: RestaurantThemeConfig;
}

export type RestaurantAvailabilityStatus = "open" | "closed" | "paused";

export interface RestaurantAvailability {
  status: RestaurantAvailabilityStatus;
  reason?: string;
}

export interface RestaurantReadinessCheck {
  key: string;
  label: string;
  complete: boolean;
}

export interface RestaurantReadiness {
  ready: boolean;
  checks: RestaurantReadinessCheck[];
}

/**
 * Phase 28 — the broader "get fully set up" checklist SetupPage.tsx shows alongside (never instead
 * of) the required readiness checks above. Never gates publish — only the 4 checks in
 * RestaurantReadiness do that. "optional" means the section is genuinely optional for this
 * restaurant (e.g. Kitchen when kitchenEnabled is false) — distinct from "not_started", which means
 * the owner could set it up but hasn't yet.
 */
export type SetupItemStatus = "not_started" | "in_progress" | "complete" | "optional";

export interface SetupChecklistItem {
  key: string;
  label: string;
  status: SetupItemStatus;
}

export interface Restaurant {
  id: string;
  name: string;
  slug: string;
  description?: string;
  logo?: string;
  coverImage?: string;
  phone?: string;
  email?: string;
  address?: string;
  city?: string;
  state?: string;
  country?: string;
  postalCode?: string;
  latitude?: number;
  longitude?: number;
  /** Absent on the public storefront resolution response (GET /restaurants/by-slug/:slug) —
   *  present only on authenticated staff-facing responses (GET /restaurants/me). */
  ownerId?: string;
  /** Phase 18/19 — the Business (brand) this location belongs to. Absent on a not-yet-migrated
   *  restaurant or the public storefront response. */
  businessId?: string;
  status: RestaurantStatus;
  settings: RestaurantSettings;
  /** Phase 31 — unpublished theme edits, staff-only (owner/manager/platform_admin), never present
   *  on the public storefront response — see restaurant.controller.ts's toPublicRestaurant. The
   *  authenticated preview response (GET .../by-slug/:slug/preview) substitutes this IN PLACE of
   *  `theme` for rendering, so "Preview" always shows the draft, never leaking it publicly. */
  themeDraft?: RestaurantThemeConfig;
  createdAt: string;
}
