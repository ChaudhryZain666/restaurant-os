import { useEffect, useMemo, useRef, useState } from "react";
import { useMatch } from "react-router-dom";
import type { Category, MenuItem, ModifierGroup, SelectedModifier } from "@restaurant/types";
import { Alert, Button, EmptyState, Skeleton } from "@restaurant/ui";
import { apiClient } from "../lib/api";
import { useCart } from "../context/CartContext";
import { useRestaurant } from "../context/RestaurantContext";
import { useActiveTheme } from "../theme/useActiveTheme";
import { PlateIcon } from "../theme/icons";

interface MenuResponse {
  items: MenuItem[];
  categories: Category[];
  modifierGroups: ModifierGroup[];
}

/**
 * Phase 31 — this component owns EVERY piece of business logic the storefront needs (menu fetch,
 * SEO/structured-data injection, modifier selection state, cart-conflict handling, scroll-spy) and
 * hands fully-computed data + plain callbacks down to the active theme's Hero/CategoryNav/
 * MenuSection/section components (see theme/types.ts). A theme component never calls the API,
 * never touches CartContext, and never makes an ordering decision — swapping themes can only ever
 * change what this page LOOKS like, never what it DOES. See docs/theme-architecture.md.
 */
export function MenuPage() {
  const {
    restaurant,
    availability,
    loading: restaurantLoading,
    error: restaurantError,
    isPreview,
    resolvedVia,
  } = useRestaurant();
  const { definition, sections } = useActiveTheme();
  const { Hero, CategoryNav, MenuSection, Featured, About, Gallery, Cta } = definition.components;
  const orderingOpen = availability?.status === "open";
  // Prefers coordinates when the owner has set them (Settings → Location); otherwise falls back
  // to the formatted street address. A plain Google Maps search URL needs no API key — this is
  // real and functional without pretending an embedded map/geocoding integration exists.
  const directionsQuery =
    restaurant?.latitude != null && restaurant?.longitude != null
      ? `${restaurant.latitude},${restaurant.longitude}`
      : [restaurant?.address, restaurant?.city, restaurant?.state, restaurant?.postalCode].filter(Boolean).join(", ");
  const [menu, setMenu] = useState<MenuResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedItemId, setExpandedItemId] = useState<string | null>(null);
  const [selections, setSelections] = useState<Record<string, string[]>>({}); // groupId -> optionIds
  const [instructionsDraft, setInstructionsDraft] = useState("");
  const [justAddedId, setJustAddedId] = useState<string | null>(null);
  const [activeCategoryId, setActiveCategoryId] = useState<string | null>(null);
  const { addItem, clear } = useCart();
  const sectionRefs = useRef(new Map<string, HTMLElement>());
  const [cartConflict, setCartConflict] = useState<(() => void) | null>(null);

  // /r/:slug/t/:tableToken URLs (and, on an active custom domain, the equivalent bare
  // /t/:tableToken — Phase 22) are QR-only entry points — they shouldn't accumulate in search
  // results (robots.txt disallows crawling them entirely; this noindex tag additionally covers
  // the case where a URL got linked/indexed from somewhere outside our own crawl surface).
  const isTableRoute = Boolean(useMatch("/r/:restaurantSlug/t/:tableToken")) || Boolean(useMatch("/t/:tableToken"));
  useEffect(() => {
    if (!isTableRoute) return;
    const meta = document.createElement("meta");
    meta.name = "robots";
    meta.content = "noindex, nofollow";
    document.head.appendChild(meta);
    return () => {
      document.head.removeChild(meta);
    };
  }, [isTableRoute]);

  // SEO foundation (Part 20, extended Phase 12): every restaurant-scoped menu page gets its own
  // title, description, canonical URL, Twitter Card, and Restaurant+Menu JSON-LD structured data
  // — the indexable surface this platform actually wants crawled/rich-result-eligible. No head
  // library exists in this app (see the noindex tag above for the same pattern); a handful of
  // tags/one script element is simplest done directly rather than pulling in a dependency for it.
  // Entirely independent of which theme is active — presentation never affects SEO output.
  useEffect(() => {
    if (!restaurant || isTableRoute) return;
    const prevTitle = document.title;
    document.title = `${restaurant.name} — Order Online`;

    const created: HTMLElement[] = [];
    function setMeta(attr: "name" | "property", key: string, content: string) {
      const meta = document.createElement("meta");
      meta.setAttribute(attr, key);
      meta.content = content;
      document.head.appendChild(meta);
      created.push(meta);
    }
    const description = restaurant.description || `Order online from ${restaurant.name}.`;
    setMeta("name", "description", description);
    setMeta("property", "og:title", restaurant.name);
    setMeta("property", "og:description", description);
    setMeta("property", "og:type", "website");
    if (restaurant.logo) setMeta("property", "og:image", restaurant.logo);

    // Twitter falls back to Open Graph tags for most fields, but "summary_large_image" only
    // applies when explicitly declared, and title/description are worth setting directly rather
    // than trusting every crawler's OG fallback.
    setMeta("name", "twitter:card", restaurant.logo ? "summary_large_image" : "summary");
    setMeta("name", "twitter:title", restaurant.name);
    setMeta("name", "twitter:description", description);
    if (restaurant.logo) setMeta("name", "twitter:image", restaurant.logo);

    // Phase 22 — when resolved via an active custom domain, that domain IS the canonical identity
    // (the whole point of white-labeling); the platform's /r/:slug URL stays functional but is
    // deliberately not forced into a redirect (an owner may still want existing links/QR codes to
    // keep working), so it's simply not the canonical one anymore while a custom domain is active.
    const canonicalUrl =
      resolvedVia === "domain" ? window.location.origin : `${window.location.origin}/r/${restaurant.slug}`;
    const canonical = document.createElement("link");
    canonical.rel = "canonical";
    canonical.href = canonicalUrl;
    document.head.appendChild(canonical);
    created.push(canonical);

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
    const script = document.createElement("script");
    script.type = "application/ld+json";
    script.textContent = JSON.stringify(structuredData);
    document.head.appendChild(script);
    created.push(script);

    return () => {
      document.title = prevTitle;
      for (const el of created) document.head.removeChild(el);
    };
  }, [restaurant, menu, isTableRoute, resolvedVia]);

  useEffect(() => {
    if (!restaurant) return;
    apiClient
      .request<MenuResponse>(`/restaurants/${restaurant.id}/menu`, { skipRefresh: true })
      .then(setMenu)
      .catch((err) => setError((err as Error).message))
      .finally(() => setLoading(false));
  }, [restaurant]);

  const categoriesById = useMemo(() => new Map((menu?.categories ?? []).map((c) => [c.id, c])), [menu]);
  const groupsByItem = useMemo(() => {
    const map = new Map<string, ModifierGroup[]>();
    for (const group of menu?.modifierGroups ?? []) {
      const list = map.get(group.menuItemId) ?? [];
      list.push(group);
      map.set(group.menuItemId, list);
    }
    return map;
  }, [menu]);

  const byCategory = useMemo(() => {
    return (menu?.items ?? []).reduce<Record<string, MenuItem[]>>((acc, item) => {
      (acc[item.categoryId] ??= []).push(item);
      return acc;
    }, {});
  }, [menu]);

  // Render in the categories' own configured sortOrder, not insertion order — those can differ
  // since `menu.items` isn't guaranteed to encounter categories in that order.
  const orderedCategoryIds = useMemo(() => {
    const menuCategories = menu?.categories ?? [];
    return [
      ...menuCategories.map((c) => c.id),
      ...Object.keys(byCategory).filter((id) => !menuCategories.some((c) => c.id === id)),
    ].filter((id) => byCategory[id]?.length);
  }, [menu, byCategory]);

  const featuredItems = useMemo(() => (menu?.items ?? []).slice(0, 4), [menu]);

  // Scroll-spy: highlight whichever category section is currently nearest the top, so the sticky
  // nav stays honest without the user needing to scroll-hunt for where they are.
  useEffect(() => {
    if (orderedCategoryIds.length === 0) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActiveCategoryId(visible[0].target.id.replace("category-", ""));
      },
      { rootMargin: "-120px 0px -70% 0px", threshold: 0 }
    );
    for (const id of orderedCategoryIds) {
      const el = sectionRefs.current.get(id);
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, [orderedCategoryIds]);

  function scrollToCategory(id: string) {
    sectionRefs.current.get(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function registerSectionRef(id: string, el: HTMLElement | null) {
    if (el) sectionRefs.current.set(id, el);
  }

  function toggleOption(group: ModifierGroup, optionId: string) {
    setSelections((prev) => {
      const current = prev[group.id] ?? [];
      if (group.maxSelect === 1) {
        return { ...prev, [group.id]: [optionId] };
      }
      const next = current.includes(optionId)
        ? current.filter((id) => id !== optionId)
        : current.length < group.maxSelect
          ? [...current, optionId]
          : current;
      return { ...prev, [group.id]: next };
    });
  }

  function startAdding(item: MenuItem) {
    const groups = groupsByItem.get(item.id) ?? [];
    if (groups.length === 0) {
      if (addItem(item) === "conflict") {
        setCartConflict(() => () => {
          addItem(item, [], undefined, true);
          setJustAddedId(item.id);
          setTimeout(() => setJustAddedId((cur) => (cur === item.id ? null : cur)), 900);
        });
        return;
      }
      setJustAddedId(item.id);
      setTimeout(() => setJustAddedId((cur) => (cur === item.id ? null : cur)), 900);
      return;
    }
    setExpandedItemId(item.id);
    setSelections({});
    setInstructionsDraft("");
  }

  function confirmAdd(item: MenuItem) {
    const groups = groupsByItem.get(item.id) ?? [];
    for (const group of groups) {
      const chosen = selections[group.id] ?? [];
      if (chosen.length < group.minSelect) {
        setError(`"${group.name}" requires at least ${group.minSelect} selection(s)`);
        return;
      }
    }
    setError(null);

    const selectedModifiers: SelectedModifier[] = groups.flatMap((group) =>
      (selections[group.id] ?? []).map((optionId) => {
        const option = group.options.find((o) => o.id === optionId)!;
        return {
          groupId: group.id,
          groupName: group.name,
          optionId: option.id,
          optionName: option.name,
          priceAdjustment: option.priceAdjustment,
        };
      })
    );

    const specialInstructions = instructionsDraft.trim() || undefined;
    if (addItem(item, selectedModifiers, specialInstructions) === "conflict") {
      setCartConflict(() => () => addItem(item, selectedModifiers, specialInstructions, true));
      return;
    }
    setExpandedItemId(null);
    setInstructionsDraft("");
    setJustAddedId(item.id);
    setTimeout(() => setJustAddedId((cur) => (cur === item.id ? null : cur)), 900);
  }

  function resolveCartConflict() {
    if (!cartConflict) return;
    clear();
    cartConflict();
    setCartConflict(null);
    setExpandedItemId(null);
    setInstructionsDraft("");
  }

  if (restaurantLoading || loading) {
    return (
      <div className="mx-auto flex max-w-5xl flex-col gap-6">
        <Skeleton className="h-40 w-full rounded-2xl sm:h-56" />
        <div className="flex gap-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-9 w-24 rounded-pill" />
          ))}
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-64 w-full rounded-xl" />
          ))}
        </div>
      </div>
    );
  }
  if (restaurantError) return <Alert tone="danger" role="alert">Failed to load restaurant: {restaurantError}</Alert>;
  if (error && !menu) return <Alert tone="danger" role="alert">Failed to load menu: {error}</Alert>;
  if (!menu) return null;

  const currency = restaurant?.settings.currency ?? "USD";

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-10">
      {isPreview && (
        <Alert tone="warning">
          Preview mode — you're viewing this exactly as a customer eventually will, but this restaurant isn't
          published yet and no customer can see this page.
        </Alert>
      )}

      <Hero
        restaurant={restaurant}
        availability={availability}
        orderingOpen={orderingOpen}
        directionsQuery={directionsQuery}
        hasCategories={orderedCategoryIds.length > 0}
        onStartOrder={() => orderedCategoryIds[0] && scrollToCategory(orderedCategoryIds[0])}
      />

      {error && (
        <Alert tone="danger" role="alert">
          {error}
        </Alert>
      )}

      {cartConflict && (
        <Alert tone="warning" role="alert" className="flex flex-wrap items-center justify-between gap-3">
          <span>Your cart has items from a different restaurant. Starting an order here will clear it.</span>
          <span className="flex shrink-0 gap-2">
            <Button size="sm" variant="destructive" onClick={resolveCartConflict}>
              Clear cart &amp; continue
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setCartConflict(null)}>
              Cancel
            </Button>
          </span>
        </Alert>
      )}

      {/* Every optional section defaults to HIDDEN (opt-in, not opt-out): these are all new
          additions the pre-Phase-31 storefront never had, and a restaurant that's never touched
          Theme Studio (defaultRestaurantThemeConfig()'s `sections: {}`) must keep rendering
          byte-for-byte what it always has — no new section can silently appear on an
          already-live storefront the owner never asked to change. "hero" is deliberately not one
          of these switches even though the backend schema reserves the key for
          forward-compatibility (@restaurant/types' THEME_SECTION_KEYS): it carries the open/closed
          status a customer needs to see, so v1 never lets it be hidden either way. */}
      {sections.featured === true && <Featured restaurant={restaurant} items={featuredItems} currency={currency} />}
      {sections.about === true && <About restaurant={restaurant} />}
      {sections.gallery === true && <Gallery restaurant={restaurant} />}

      <CategoryNav categories={orderedCategoryIds.map((id) => ({ id, name: categoriesById.get(id)?.name ?? "Other" }))} activeCategoryId={activeCategoryId} onSelect={scrollToCategory} />

      {orderedCategoryIds.length === 0 && (
        <EmptyState
          icon={<PlateIcon className="h-6 w-6" />}
          title="Menu coming soon"
          description={`${restaurant?.name ?? "This restaurant"} hasn't published a menu yet — check back soon.`}
        />
      )}

      {orderedCategoryIds.map((categoryId) => (
        <MenuSection
          key={categoryId}
          category={{ id: categoryId, name: categoriesById.get(categoryId)?.name ?? "Other" }}
          items={byCategory[categoryId]}
          currency={currency}
          orderingOpen={orderingOpen}
          expandedItemId={expandedItemId}
          justAddedId={justAddedId}
          groupsByItem={groupsByItem}
          selections={selections}
          instructionsDraft={instructionsDraft}
          onStartAdding={startAdding}
          onToggleOption={toggleOption}
          onInstructionsChange={setInstructionsDraft}
          onConfirmAdd={confirmAdd}
          onCancelAdd={() => setExpandedItemId(null)}
          registerSectionRef={registerSectionRef}
        />
      ))}

      {sections.cta === true && (
        <Cta
          restaurant={restaurant}
          orderingOpen={orderingOpen}
          hasCategories={orderedCategoryIds.length > 0}
          onStartOrder={() => orderedCategoryIds[0] && scrollToCategory(orderedCategoryIds[0])}
        />
      )}
    </div>
  );
}
