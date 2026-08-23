export interface AnalyticsTopItem {
  menuItemId: string;
  name: string;
  quantitySold: number;
}

export interface RestaurantAnalytics {
  ordersToday: number;
  ordersThisWeek: number;
  /** Sum of `total` for paid, non-cancelled orders — this platform has no real payment
   *  processor yet, only staff-toggled paymentStatus, so unpaid totals are excluded. */
  revenueToday: number;
  revenueThisWeek: number;
  averageOrderValue: number;
  completedOrdersThisWeek: number;
  cancelledOrdersThisWeek: number;
  topSellingItems: AnalyticsTopItem[];
}

export interface DailyAnalyticsPoint {
  /** "YYYY-MM-DD", calendar day in the restaurant's OWN configured timezone (not UTC) — see
   *  getDailyTimeSeries in analytics.service.ts. */
  date: string;
  orders: number;
  revenue: number;
}

/**
 * Phase 23 — business-wide analytics. Monetary values are deliberately grouped by currency, never
 * summed across currencies (no FX-conversion infrastructure exists in this platform, and inventing
 * exchange rates would produce a misleading number) — see
 * docs/multi-tenant-storefront-architecture.md's Phase 23 section for the full reasoning. A
 * single-currency business simply gets one entry in each of these arrays.
 */
export interface CurrencyAmount {
  currency: string;
  amount: number;
}

export interface BusinessLocationBreakdown {
  locationId: string;
  name: string;
  currency: string;
  orders: number;
  revenue: number;
  averageOrderValue: number;
}

export interface BusinessAnalyticsOverview {
  /** ISO date (YYYY-MM-DD), inclusive range boundaries as requested by the caller — business-level
   *  analytics use an explicit date range rather than "today"/"this week", since those have no
   *  single well-defined meaning across locations in different timezones. */
  from: string;
  to: string;
  totalOrders: number;
  revenueByCurrency: CurrencyAmount[];
  averageOrderValueByCurrency: CurrencyAmount[];
  byLocation: BusinessLocationBreakdown[];
}

export interface BusinessDailyPoint {
  date: string;
  orders: number;
  revenueByCurrency: CurrencyAmount[];
}

export interface BusinessAnalyticsTrends {
  from: string;
  to: string;
  points: BusinessDailyPoint[];
}

export interface BusinessAnalyticsProducts {
  from: string;
  to: string;
  /** Grouped by menuItemId — accurate for canonical (Phase 21-migrated) shared-menu businesses,
   *  where the same item genuinely shares one id across locations. A business with a location
   *  still on the legacy per-location menu path won't have that location's items merged into a
   *  same-named canonical item elsewhere — a documented, minor limitation, not a bug. */
  items: AnalyticsTopItem[];
}
