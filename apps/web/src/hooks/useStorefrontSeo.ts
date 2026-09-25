import { useEffect } from "react";
import type { Category, MenuItem, ModifierGroup, Restaurant } from "@restaurant/types";
import { applyJsonLd, applySeoMeta } from "@restaurant/utils/seoMeta";

export interface MenuResponse {
  items: MenuItem[];
  categories: Category[];
  modifierGroups: ModifierGroup[];
}

interface UseStorefrontSeoInput {
  restaurant: Restaurant | null;
  menu: MenuResponse | null;
  isTableRoute: boolean;
  isPreview: boolean;
  resolvedVia: "slug" | "domain" | "none";
  activeCustomDomain: string | null;
}

/**
 * Phase 79 — extracted from MenuPage.tsx's single inline effect: every restaurant-scoped
 * storefront page's title/description/canonical/OG/Twitter/JSON-LD, in one place instead of
 * duplicated per theme. Split into two effects instead of the original one: tag/meta output only
 * depends on restaurant identity + domain resolution, while JSON-LD's `hasMenu` block additionally
 * depends on `menu` — previously the whole block (including title/canonical, which never change on
 * a menu refetch) was torn down and recreated every time `menu` changed.
 *
 * Skips entirely for QR table routes (isTableRoute, pre-existing) and preview mode (isPreview,
 * Phase 79 fix — a preview render can show restaurant data that isn't published yet and should
 * never be indexable; see MenuPage.tsx's own `useNoIndex(isPreview)` call for the matching noindex
 * tag).
 */
export function useStorefrontSeo({ restaurant, menu, isTableRoute, isPreview, resolvedVia, activeCustomDomain }: UseStorefrontSeoInput): void {
  const skip = !restaurant || isTableRoute || isPreview;

  useEffect(() => {
    if (skip || !restaurant) return;

    // Phase 22 — when an active custom domain exists, that domain IS the canonical identity (the
    // whole point of white-labeling); the platform's /r/:slug URL stays functional but is
    // deliberately not forced into a redirect, so it's simply not the canonical one anymore while a
    // custom domain is active. activeCustomDomain (only ever set on the by-slug resolution path —
    // see RestaurantContext.tsx) is preferred regardless of which URL the visitor is currently on,
    // closing a duplicate-content gap where a /r/:slug visitor kept getting a self-referencing
    // canonical even though this restaurant's domain was active.
    const canonicalUrl =
      resolvedVia === "domain"
        ? window.location.origin
        : activeCustomDomain
          ? `https://${activeCustomDomain}`
          : `${window.location.origin}/r/${restaurant.slug}`;
    const description = restaurant.description || `Order online from ${restaurant.name}.`;

    return applySeoMeta({
      title: `${restaurant.name} — Order Online`,
      description,
      canonicalUrl,
      og: {
        title: restaurant.name,
        description,
        type: "website",
        url: canonicalUrl,
        siteName: "GarnishTable",
        image: restaurant.logo,
      },
      twitter: {
        card: restaurant.logo ? "summary_large_image" : "summary",
        title: restaurant.name,
        description,
        image: restaurant.logo,
      },
    });
  }, [skip, restaurant, resolvedVia, activeCustomDomain]);

  useEffect(() => {
    if (skip || !restaurant) return;

    const canonicalUrl =
      resolvedVia === "domain"
        ? window.location.origin
        : activeCustomDomain
          ? `https://${activeCustomDomain}`
          : `${window.location.origin}/r/${restaurant.slug}`;
    const description = restaurant.description || `Order online from ${restaurant.name}.`;

    // schema.org/Restaurant, extended with a real hasMenu once the menu itself has loaded — never
    // emitted with placeholder/fake data; a menu that hasn't loaded yet just means no `hasMenu`
    // property this render, not an empty or invented one.
    const address =
      restaurant.address || restaurant.city
        ? {
            "@type": "PostalAddress",
            streetAddress: restaurant.address,
            addressLocality: restaurant.city,
            addressRegion: restaurant.state,
            postalCode: restaurant.postalCode,
            addressCountry: restaurant.country,
          }
        : undefined;
    const structuredData: Record<string, unknown> = {
      "@context": "https://schema.org",
      "@type": "Restaurant",
      name: restaurant.name,
      description,
      url: canonicalUrl,
      ...(restaurant.logo ? { image: restaurant.logo } : {}),
      ...(restaurant.phone ? { telephone: restaurant.phone } : {}),
      ...(address ? { address } : {}),
      ...(restaurant.latitude != null && restaurant.longitude != null
        ? { geo: { "@type": "GeoCoordinates", latitude: restaurant.latitude, longitude: restaurant.longitude } }
        : {}),
      // schema.org expects the plain capitalized weekday name for dayOfWeek — WEEKDAYS is stored
      // lowercase (see packages/types/src/types/restaurant.ts), so just the first letter needs
      // capitalizing. Closed days are omitted entirely rather than emitted with an empty range.
      ...(restaurant.settings.businessHours.some((d) => !d.isClosed)
        ? {
            openingHoursSpecification: restaurant.settings.businessHours
              .filter((d) => !d.isClosed && d.open && d.close)
              .map((d) => ({
                "@type": "OpeningHoursSpecification",
                dayOfWeek: `https://schema.org/${d.day[0].toUpperCase()}${d.day.slice(1)}`,
                opens: d.open,
                closes: d.close,
              })),
          }
        : {}),
      ...(menu && menu.items.length > 0
        ? {
            hasMenu: {
              "@type": "Menu",
              name: `${restaurant.name} menu`,
              hasMenuSection: menu.categories
                .map((c) => ({
                  category: c,
                  items: menu.items.filter((item) => item.categoryId === c.id),
                }))
                .filter((section) => section.items.length > 0)
                .map(({ category, items }) => ({
                  "@type": "MenuSection",
                  name: category.name,
                  hasMenuItem: items.map((item) => ({
                    "@type": "MenuItem",
                    name: item.name,
                    ...(item.description ? { description: item.description } : {}),
                    offers: { "@type": "Offer", price: item.price, priceCurrency: restaurant.settings.currency },
                  })),
                })),
            },
          }
        : {}),
    };

    return applyJsonLd(structuredData);
  }, [skip, restaurant, menu, resolvedVia, activeCustomDomain]);
}
