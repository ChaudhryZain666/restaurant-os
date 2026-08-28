import mongoose, { Types } from "mongoose";
import type { AnalyticsTopItem, DailyAnalyticsPoint, RestaurantAnalytics } from "@restaurant/types";
import { Order } from "../models/Order.js";
import { Restaurant } from "../models/Restaurant.js";
import { ApiError } from "../utils/ApiError.js";

async function getTimezone(restaurantId: string): Promise<string> {
  const restaurant = await Restaurant.findById(restaurantId).select("settings.timezone");
  return restaurant?.settings.timezone || "UTC";
}

/**
 * "Start of calendar day, in a given IANA timezone, as a UTC instant" — computed by MongoDB's
 * own $dateTrunc rather than hand-rolled in JS: correctly handling an arbitrary timezone's UTC
 * offset (and DST transitions) requires the IANA tz database, which Mongo already has bundled and
 * gets right, rather than this codebase reimplementing it.
 *
 * Run as a database-level aggregation (`db.aggregate`, via the native driver on
 * `mongoose.connection.db`) rather than `Order.aggregate` — MongoDB requires `$documents` as a
 * first stage to run at the database/cluster level ({aggregate: 1}), not against a specific
 * collection; `Order.aggregate` always issues a collection-scoped command and MongoDB rejects
 * `$documents` there with "can only be run with database or cluster-level aggregation". The
 * `$documents` stage itself just produces one throwaway input row so this works even against an
 * otherwise-empty database.
 */
export async function timezoneAwareDayStart(date: Date, timezone: string): Promise<Date> {
  const db = mongoose.connection.db;
  if (!db) throw new Error("No active MongoDB connection");
  const [row] = await db
    .aggregate<{ start: Date }>([
      { $documents: [{}] },
      { $project: { start: { $dateTrunc: { date, unit: "day", timezone } } } },
    ])
    .toArray();
  return row.start;
}

/** Bounds every time-series query to a fixed-size aggregation regardless of how far back a
 *  restaurant's order history goes — the $match below is always on an indexed, capped range
 *  ({restaurantId,createdAt} — see Order.ts), so this stays a cheap query at any data volume. A
 *  pre-aggregated daily rollup collection would only be justified past a scale (many years of
 *  daily-granularity queries across many restaurants) this platform is nowhere near yet; adding
 *  one now would be speculative complexity with no current need to justify it. */
export const MAX_RANGE_DAYS = 92;

interface FacetResult {
  ordersToday: Array<{ count: number }>;
  ordersThisWeek: Array<{ count: number }>;
  revenueToday: Array<{ total: number }>;
  revenueThisWeek: Array<{ total: number; count: number }>;
  completedOrdersThisWeek: Array<{ count: number }>;
  cancelledOrdersThisWeek: Array<{ count: number }>;
  topSellingItems: Array<{ _id: Types.ObjectId; name: string; quantitySold: number }>;
}

/**
 * All-in-one analytics for the restaurant admin dashboard, computed with a single aggregation.
 *
 * "Revenue" here means the sum of `total` for orders that are both non-cancelled AND marked
 * paid — this platform has no real payment processor yet, only staff-toggled paymentStatus (see
 * updateOrderPaymentStatus), so an unpaid order's total is not counted as revenue.
 *
 * "Today" is a calendar-day window in the restaurant's OWN configured timezone
 * (Restaurant.settings.timezone) — Phase 16. "This week" stays a rolling 7-day window (not a
 * calendar week), which has no timezone dependency to begin with.
 */
export async function getRestaurantAnalytics(restaurantId: string): Promise<RestaurantAnalytics> {
  const now = new Date();
  const timezone = await getTimezone(restaurantId);
  const todayStart = await timezoneAwareDayStart(now, timezone);
  const weekStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const restaurantObjectId = new Types.ObjectId(restaurantId);

  const [result] = await Order.aggregate<FacetResult>([
    { $match: { restaurantId: restaurantObjectId, createdAt: { $gte: weekStart }, isDemo: { $ne: true } } },
    {
      $facet: {
        ordersToday: [{ $match: { createdAt: { $gte: todayStart } } }, { $count: "count" }],
        ordersThisWeek: [{ $count: "count" }],
        revenueToday: [
          { $match: { createdAt: { $gte: todayStart }, paymentStatus: "paid", status: { $ne: "cancelled" } } },
          { $group: { _id: null, total: { $sum: "$total" } } },
        ],
        revenueThisWeek: [
          { $match: { paymentStatus: "paid", status: { $ne: "cancelled" } } },
          { $group: { _id: null, total: { $sum: "$total" }, count: { $sum: 1 } } },
        ],
        completedOrdersThisWeek: [{ $match: { status: "completed" } }, { $count: "count" }],
        cancelledOrdersThisWeek: [{ $match: { status: "cancelled" } }, { $count: "count" }],
        topSellingItems: [
          { $match: { status: { $ne: "cancelled" } } },
          { $unwind: "$items" },
          {
            $group: {
              _id: "$items.menuItemId",
              name: { $first: "$items.name" },
              quantitySold: { $sum: "$items.quantity" },
            },
          },
          { $sort: { quantitySold: -1 } },
          { $limit: 5 },
        ],
      },
    },
  ]);

  const revenueWeek = result.revenueThisWeek[0];
  const revenueThisWeek = revenueWeek?.total ?? 0;
  const paidOrderCountThisWeek = revenueWeek?.count ?? 0;

  return {
    ordersToday: result.ordersToday[0]?.count ?? 0,
    ordersThisWeek: result.ordersThisWeek[0]?.count ?? 0,
    revenueToday: Math.round((result.revenueToday[0]?.total ?? 0) * 100) / 100,
    revenueThisWeek: Math.round(revenueThisWeek * 100) / 100,
    averageOrderValue:
      paidOrderCountThisWeek > 0 ? Math.round((revenueThisWeek / paidOrderCountThisWeek) * 100) / 100 : 0,
    completedOrdersThisWeek: result.completedOrdersThisWeek[0]?.count ?? 0,
    cancelledOrdersThisWeek: result.cancelledOrdersThisWeek[0]?.count ?? 0,
    topSellingItems: result.topSellingItems.map((i) => ({
      menuItemId: i._id.toString(),
      name: i.name,
      quantitySold: i.quantitySold,
    })),
  };
}

/**
 * Daily orders/revenue for a bounded date range — the reusable foundation future dashboards (and
 * eventually platform-wide analytics) build on, rather than a one-off endpoint. Same revenue
 * definition as getRestaurantAnalytics: only non-cancelled, staff-marked-paid orders count.
 * Returns one point per calendar day in range, zero-filled — never a sparse series the frontend
 * has to reconstruct gaps in itself.
 */
export async function getDailyTimeSeries(restaurantId: string, from: Date, to: Date): Promise<DailyAnalyticsPoint[]> {
  if (to < from) throw ApiError.badRequest("`to` must not be before `from`");
  const rangeDays = Math.ceil((to.getTime() - from.getTime()) / (24 * 60 * 60 * 1000)) + 1;
  if (rangeDays > MAX_RANGE_DAYS) {
    throw ApiError.badRequest(`Date range cannot exceed ${MAX_RANGE_DAYS} days`);
  }

  const restaurantObjectId = new Types.ObjectId(restaurantId);
  const timezone = await getTimezone(restaurantId);
  const rangeStart = await timezoneAwareDayStart(from, timezone);

  const rows = await Order.aggregate<{ _id: string; orders: number; revenue: number }>([
    {
      $match: {
        restaurantId: restaurantObjectId,
        createdAt: { $gte: rangeStart, $lte: to },
        status: { $ne: "cancelled" },
        isDemo: { $ne: true },
      },
    },
    {
      $group: {
        _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt", timezone } },
        orders: { $sum: 1 },
        revenue: { $sum: { $cond: [{ $eq: ["$paymentStatus", "paid"] }, "$total", 0] } },
      },
    },
  ]);
  const byDate = new Map(rows.map((r) => [r._id, r]));

  // Date keys are formatted in the SAME restaurant timezone $dateToString above grouped by, via
  // the same en-CA-locale-produces-ISO-order trick this codebase doesn't have anywhere else yet —
  // Intl.DateTimeFormat, not manual offset math, so it inherits the ICU timezone database's DST
  // handling instead of this code needing to reimplement it.
  const dayFormatter = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" });
  const points: DailyAnalyticsPoint[] = [];
  for (let d = new Date(rangeStart); d <= to; d.setUTCDate(d.getUTCDate() + 1)) {
    const key = dayFormatter.format(d);
    const row = byDate.get(key);
    points.push({ date: key, orders: row?.orders ?? 0, revenue: Math.round((row?.revenue ?? 0) * 100) / 100 });
  }
  return points;
}

export interface RangeAnalytics {
  orders: number;
  revenue: number;
  /** Count of paid, non-cancelled orders — the denominator behind `averageOrderValue`. Exposed
   *  separately (not just the ratio) so callers combining several locations' revenue into one
   *  currency-grouped total can recompute a correct weighted average instead of averaging
   *  already-averaged per-location numbers (which would silently misweight small vs large
   *  locations). */
  paidOrderCount: number;
  averageOrderValue: number;
  completedOrders: number;
  cancelledOrders: number;
  topSellingItems: AnalyticsTopItem[];
}

interface RangeFacetResult {
  orders: Array<{ count: number }>;
  revenue: Array<{ total: number; count: number }>;
  completedOrders: Array<{ count: number }>;
  cancelledOrders: Array<{ count: number }>;
  topSellingItems: Array<{ _id: Types.ObjectId; name: string; quantitySold: number }>;
}

/**
 * Phase 23 — business-wide analytics fans out to this per-location function once per location
 * under a business (see businessAnalytics.service.ts), never a single mega-aggregation across
 * restaurantIds: each location's OWN timezone determines its own day boundaries for the SAME
 * requested calendar-date range, so a shared UTC boundary would be wrong for at least one location
 * whenever timezones differ. Deliberately a new function rather than a generalization of
 * getRestaurantAnalytics above — that function's today/this-week semantics stay byte-for-byte
 * unchanged for the existing single-location dashboard; this one only serves the new, separate
 * range-based need. `from`/`to` are both calendar-date instants, inclusive on both ends.
 */
export async function getRestaurantAnalyticsForRange(
  restaurantId: string,
  from: Date,
  to: Date,
  timezone: string
): Promise<RangeAnalytics> {
  const restaurantObjectId = new Types.ObjectId(restaurantId);
  const rangeStart = await timezoneAwareDayStart(from, timezone);
  const dayAfterTo = new Date(to.getTime() + 24 * 60 * 60 * 1000);
  const rangeEndExclusive = await timezoneAwareDayStart(dayAfterTo, timezone);

  const [result] = await Order.aggregate<RangeFacetResult>([
    { $match: { restaurantId: restaurantObjectId, createdAt: { $gte: rangeStart, $lt: rangeEndExclusive }, isDemo: { $ne: true } } },
    {
      $facet: {
        orders: [{ $count: "count" }],
        revenue: [
          { $match: { paymentStatus: "paid", status: { $ne: "cancelled" } } },
          { $group: { _id: null, total: { $sum: "$total" }, count: { $sum: 1 } } },
        ],
        completedOrders: [{ $match: { status: "completed" } }, { $count: "count" }],
        cancelledOrders: [{ $match: { status: "cancelled" } }, { $count: "count" }],
        topSellingItems: [
          { $match: { status: { $ne: "cancelled" } } },
          { $unwind: "$items" },
          {
            $group: {
              _id: "$items.menuItemId",
              name: { $first: "$items.name" },
              quantitySold: { $sum: "$items.quantity" },
            },
          },
          { $sort: { quantitySold: -1 } },
          { $limit: 5 },
        ],
      },
    },
  ]);

  const revenue = result.revenue[0];
  const revenueTotal = revenue?.total ?? 0;
  const paidOrderCount = revenue?.count ?? 0;

  return {
    orders: result.orders[0]?.count ?? 0,
    revenue: Math.round(revenueTotal * 100) / 100,
    paidOrderCount,
    averageOrderValue: paidOrderCount > 0 ? Math.round((revenueTotal / paidOrderCount) * 100) / 100 : 0,
    completedOrders: result.completedOrders[0]?.count ?? 0,
    cancelledOrders: result.cancelledOrders[0]?.count ?? 0,
    topSellingItems: result.topSellingItems.map((i) => ({
      menuItemId: i._id.toString(),
      name: i.name,
      quantitySold: i.quantitySold,
    })),
  };
}

/**
 * Dedicated top-items query for the business-wide products endpoint — a higher per-location
 * `limit` than getRestaurantAnalyticsForRange's fixed top-5 (business analytics re-ranks across
 * every location's own top items afterward; asking each location for only its own top 5 risks
 * undercounting an item that's, say, consistently 6th-8th everywhere but genuinely more popular
 * business-wide than a true top-5 item at one single location).
 */
export async function getTopSellingItemsForRange(
  restaurantId: string,
  from: Date,
  to: Date,
  timezone: string,
  limit: number
): Promise<AnalyticsTopItem[]> {
  const restaurantObjectId = new Types.ObjectId(restaurantId);
  const rangeStart = await timezoneAwareDayStart(from, timezone);
  const dayAfterTo = new Date(to.getTime() + 24 * 60 * 60 * 1000);
  const rangeEndExclusive = await timezoneAwareDayStart(dayAfterTo, timezone);

  const rows = await Order.aggregate<{ _id: Types.ObjectId; name: string; quantitySold: number }>([
    {
      $match: {
        restaurantId: restaurantObjectId,
        createdAt: { $gte: rangeStart, $lt: rangeEndExclusive },
        status: { $ne: "cancelled" },
        isDemo: { $ne: true },
      },
    },
    { $unwind: "$items" },
    { $group: { _id: "$items.menuItemId", name: { $first: "$items.name" }, quantitySold: { $sum: "$items.quantity" } } },
    { $sort: { quantitySold: -1 } },
    { $limit: limit },
  ]);
  return rows.map((r) => ({ menuItemId: r._id.toString(), name: r.name, quantitySold: r.quantitySold }));
}
