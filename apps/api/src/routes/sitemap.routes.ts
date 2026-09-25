import { Router } from "express";
import { Restaurant } from "../models/Restaurant.js";
import { MenuItem } from "../models/MenuItem.js";
import { DomainMapping } from "../models/DomainMapping.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { env } from "../config/env.js";

export const sitemapRouter = Router();

/**
 * Public, real-data-only sitemap: one <url> per active, ordering-enabled restaurant's canonical
 * storefront URL. Deliberately excludes everything else — table QR URLs, cart/checkout, order
 * pages, and admin/platform routes are never indexable surfaces (see
 * docs/multi-tenant-storefront-architecture.md's SEO section).
 *
 * Two further exclusions, added during the pre-launch SEO audit:
 *  - `slug: "demo-restaurant"` — the seeded sales-demo storefront (seed-demo-data.ts) is fictional
 *    content, not a real business; it was previously fully indexed alongside genuine restaurants
 *    (see apps/web's MenuPage.tsx for the matching noindex meta tag on that same slug — belt and
 *    suspenders, matching this file's own precedent of excluding everything non-indexable here
 *    rather than relying on a single mechanism).
 *  - Thin/empty restaurants (status:"active" but zero menu items) — a newly-activated restaurant
 *    with no menu yet has nothing for a crawler to index; sitemapping it would only ever produce a
 *    thin/low-value page. Checked via two batched MenuItem.distinct() calls (covers both the legacy
 *    restaurantId-scoped and canonical businessId-scoped menu shapes MenuItem.ts supports) rather
 *    than one query per restaurant, so this stays two queries total regardless of restaurant count.
 *
 * Phase 79 SEO audit fix — a restaurant with an active custom domain (DomainMapping.status ===
 * "active") now gets that domain's URL here instead of its platform `/r/:slug` URL, matching
 * MenuPage.tsx's own canonical preference (see useStorefrontSeo.ts). Before this fix, the sitemap
 * always emitted the platform URL even when the domain was active, submitting a non-canonical URL
 * to search engines for every custom-domain restaurant. One more batched query against just the
 * already-filtered `indexable` set — three queries total, still independent of restaurant count.
 */
sitemapRouter.get(
  "/",
  asyncHandler(async (_req, res) => {
    const restaurants = await Restaurant.find({ status: "active", "settings.orderingEnabled": true, slug: { $ne: "demo-restaurant" } })
      .select("slug updatedAt businessId")
      .sort({ slug: 1 });

    const [restaurantIdsWithMenu, businessIdsWithMenu] = await Promise.all([
      MenuItem.distinct("restaurantId", { restaurantId: { $in: restaurants.map((r) => r._id) }, isAvailable: true }),
      MenuItem.distinct("businessId", { businessId: { $in: restaurants.map((r) => r.businessId).filter(Boolean) }, isAvailable: true }),
    ]);
    const restaurantIdSet = new Set(restaurantIdsWithMenu.map((id) => id.toString()));
    const businessIdSet = new Set(businessIdsWithMenu.map((id) => id.toString()));
    const indexable = restaurants.filter(
      (r) => restaurantIdSet.has(r.id as string) || (r.businessId && businessIdSet.has(r.businessId.toString()))
    );

    const activeDomains = await DomainMapping.find({
      locationId: { $in: indexable.map((r) => r._id) },
      status: "active",
    }).select("locationId hostname");
    const hostnameByLocationId = new Map(activeDomains.map((d) => [d.locationId.toString(), d.hostname]));

    const urls = indexable
      .map((r) => {
        const hostname = hostnameByLocationId.get(r.id as string);
        const loc = hostname ? `https://${hostname}` : `${env.CLIENT_ORIGIN}/r/${r.slug}`;
        return `  <url><loc>${loc}</loc><lastmod>${(r.updatedAt as Date).toISOString()}</lastmod></url>`;
      })
      .join("\n");

    const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
    res.type("application/xml").send(xml);
  })
);
