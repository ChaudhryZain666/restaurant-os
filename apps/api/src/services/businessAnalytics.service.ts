import type {
  AnalyticsTopItem,
  BusinessAnalyticsOverview,
  BusinessAnalyticsProducts,
  BusinessAnalyticsTrends,
  BusinessDailyPoint,
  CurrencyAmount,
} from "@restaurant/types";
import { Restaurant } from "../models/Restaurant.js";
import { getDailyTimeSeries, getRestaurantAnalyticsForRange, getTopSellingItemsForRange } from "./analytics.service.js";

/**
 * Phase 23 — business-wide analytics. Fans out to the existing per-location aggregation once per
 * location (a bounded, small fan-out matching a business's actual location count, not an N+1
 * antipattern — Order has no businessId field to aggregate against directly, and no location's
 * day/date-range boundary can be computed correctly without that location's own timezone, so a
 * single cross-restaurant mega-aggregation couldn't be both correct and simple; see
 * docs/multi-tenant-storefront-architecture.md's Phase 23 section for the full reasoning).
 *
 * Monetary values are grouped by currency, never summed across currencies — this platform has no
 * FX-conversion infrastructure, and inventing exchange rates would produce a misleading number.
 */

interface BusinessLocation {
  id: string;
  name: string;
  currency: string;
  timezone: string;
}

/**
 * Every location under the business by default — including a since-suspended one, whose PAST
 * orders are still real business history — narrowed to `locationIdsFilter` when provided. A
 * requested id that doesn't actually belong to this business is silently dropped, never trusted to
 * expand scope: this is the one place a client-supplied filter could otherwise leak cross-business
 * data, and it's closed here rather than relying on the caller to have validated it.
 */
async function resolveBusinessLocations(businessId: string, locationIdsFilter?: string[]): Promise<BusinessLocation[]> {
  const restaurants = await Restaurant.find({ businessId }).select("_id name settings.currency settings.timezone");
  const all = restaurants.map((r) => ({
    id: r.id as string,
    name: r.name,
    currency: r.settings.currency || "USD",
    timezone: r.settings.timezone || "UTC",
  }));
  if (!locationIdsFilter || locationIdsFilter.length === 0) return all;
  const allowedIds = new Set(all.map((l) => l.id));
  const requestedIds = new Set(locationIdsFilter.filter((id) => allowedIds.has(id)));
  return all.filter((l) => requestedIds.has(l.id));
}

function sumAmountsByCurrency(entries: Array<{ currency: string; amount: number }>): CurrencyAmount[] {
  const totals = new Map<string, number>();
  for (const e of entries) totals.set(e.currency, (totals.get(e.currency) ?? 0) + e.amount);
  return Array.from(totals.entries()).map(([currency, amount]) => ({ currency, amount: Math.round(amount * 100) / 100 }));
}

const toIsoDate = (d: Date) => d.toISOString().slice(0, 10);

export async function getBusinessAnalyticsOverview(
  businessId: string,
  from: Date,
  to: Date,
  locationIdsFilter?: string[]
): Promise<BusinessAnalyticsOverview> {
  const locations = await resolveBusinessLocations(businessId, locationIdsFilter);

  const perLocation = await Promise.all(
    locations.map(async (loc) => ({ loc, range: await getRestaurantAnalyticsForRange(loc.id, from, to, loc.timezone) }))
  );

  const byLocation = perLocation.map(({ loc, range }) => ({
    locationId: loc.id,
    name: loc.name,
    currency: loc.currency,
    orders: range.orders,
    revenue: range.revenue,
    averageOrderValue: range.averageOrderValue,
  }));

  const totalOrders = perLocation.reduce((sum, { range }) => sum + range.orders, 0);
  const revenueByCurrency = sumAmountsByCurrency(perLocation.map(({ loc, range }) => ({ currency: loc.currency, amount: range.revenue })));

  // AOV per currency is recomputed from the currency-grouped revenue and paid-order-count totals
  // — never an average of already-averaged per-location AOVs, which would silently misweight a
  // small location the same as a large one.
  const paidOrderCountByCurrency = new Map<string, number>();
  for (const { loc, range } of perLocation) {
    paidOrderCountByCurrency.set(loc.currency, (paidOrderCountByCurrency.get(loc.currency) ?? 0) + range.paidOrderCount);
  }
  const averageOrderValueByCurrency: CurrencyAmount[] = revenueByCurrency.map(({ currency, amount }) => {
    const paidOrders = paidOrderCountByCurrency.get(currency) ?? 0;
    return { currency, amount: paidOrders > 0 ? Math.round((amount / paidOrders) * 100) / 100 : 0 };
  });

  return {
    from: toIsoDate(from),
    to: toIsoDate(to),
    totalOrders,
    revenueByCurrency,
    averageOrderValueByCurrency,
    byLocation,
  };
}

export async function getBusinessAnalyticsTrends(
  businessId: string,
  from: Date,
  to: Date,
  locationIdsFilter?: string[]
): Promise<BusinessAnalyticsTrends> {
  const locations = await resolveBusinessLocations(businessId, locationIdsFilter);

  const perLocation = await Promise.all(
    locations.map(async (loc) => ({ loc, series: await getDailyTimeSeries(loc.id, from, to) }))
  );

  // Each location's series is already zero-filled/date-keyed in ITS OWN timezone (getDailyTimeSeries).
  // Combining by date-string key is safe here specifically because every point being merged for a
  // given key already represents "that calendar date, in that location's own timezone" — the same
  // deliberate choice documented on BusinessAnalyticsOverview: this is a per-location-correct
  // calendar-date range, not a single shared UTC instant pretending to be simultaneous everywhere.
  const byDate = new Map<string, Array<{ currency: string; orders: number; revenue: number }>>();
  for (const { loc, series } of perLocation) {
    for (const point of series) {
      const existing = byDate.get(point.date) ?? [];
      existing.push({ currency: loc.currency, orders: point.orders, revenue: point.revenue });
      byDate.set(point.date, existing);
    }
  }

  const points: BusinessDailyPoint[] = Array.from(byDate.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, entries]) => ({
      date,
      orders: entries.reduce((sum, e) => sum + e.orders, 0),
      revenueByCurrency: sumAmountsByCurrency(entries.map((e) => ({ currency: e.currency, amount: e.revenue }))),
    }));

  return { from: toIsoDate(from), to: toIsoDate(to), points };
}

const PER_LOCATION_PRODUCT_LIMIT = 20;
const BUSINESS_PRODUCT_LIMIT = 5;

export async function getBusinessAnalyticsProducts(
  businessId: string,
  from: Date,
  to: Date,
  locationIdsFilter?: string[]
): Promise<BusinessAnalyticsProducts> {
  const locations = await resolveBusinessLocations(businessId, locationIdsFilter);

  const perLocationItems = await Promise.all(
    locations.map((loc) => getTopSellingItemsForRange(loc.id, from, to, loc.timezone, PER_LOCATION_PRODUCT_LIMIT))
  );

  // Re-ranked across locations by menuItemId — accurate for a canonical (Phase 21-migrated)
  // shared-menu business, where the same item genuinely shares one id everywhere; see
  // BusinessAnalyticsProducts's own doc comment for the documented legacy-menu limitation.
  const totals = new Map<string, AnalyticsTopItem>();
  for (const items of perLocationItems) {
    for (const item of items) {
      const existing = totals.get(item.menuItemId);
      if (existing) existing.quantitySold += item.quantitySold;
      else totals.set(item.menuItemId, { ...item });
    }
  }

  const merged = Array.from(totals.values())
    .sort((a, b) => b.quantitySold - a.quantitySold)
    .slice(0, BUSINESS_PRODUCT_LIMIT);

  return { from: toIsoDate(from), to: toIsoDate(to), items: merged };
}
