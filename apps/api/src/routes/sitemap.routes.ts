import { Router } from "express";
import { Restaurant } from "../models/Restaurant.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { env } from "../config/env.js";

export const sitemapRouter = Router();

/**
 * Public, real-data-only sitemap: one <url> per active, ordering-enabled restaurant's canonical
 * storefront URL. Deliberately excludes everything else — table QR URLs, cart/checkout, order
 * pages, and admin/platform routes are never indexable surfaces (see
 * docs/multi-tenant-storefront-architecture.md's SEO section).
 */
sitemapRouter.get(
  "/",
  asyncHandler(async (_req, res) => {
    const restaurants = await Restaurant.find({ status: "active", "settings.orderingEnabled": true })
      .select("slug updatedAt")
      .sort({ slug: 1 });

    const urls = restaurants
      .map(
        (r) =>
          `  <url><loc>${env.CLIENT_ORIGIN}/r/${r.slug}</loc><lastmod>${(r.updatedAt as Date).toISOString()}</lastmod></url>`
      )
      .join("\n");

    const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
    res.type("application/xml").send(xml);
  })
);
