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
  createdAt: string;
}
