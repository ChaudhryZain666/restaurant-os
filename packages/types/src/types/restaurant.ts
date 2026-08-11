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
  minOrderAmount: number;
  /** Fractional tax rate, e.g. 0.0825 for 8.25%. */
  taxRate: number;
  deliveryFee: number;
  businessHours: BusinessHoursDay[];
  /** Short-term "86'd" toggle — distinct from orderingEnabled, which is the indefinite kill switch. */
  temporarilyPaused: boolean;
  pausedReason?: string;
}

export type RestaurantAvailabilityStatus = "open" | "closed" | "paused";

export interface RestaurantAvailability {
  status: RestaurantAvailabilityStatus;
  reason?: string;
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
  ownerId: string;
  status: RestaurantStatus;
  settings: RestaurantSettings;
  createdAt: string;
}
