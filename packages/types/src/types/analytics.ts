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
  /** "YYYY-MM-DD", UTC calendar day. */
  date: string;
  orders: number;
  revenue: number;
}
