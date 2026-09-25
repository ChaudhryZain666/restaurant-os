import { useEffect, useMemo, useRef, useState } from "react";
import { useMatch } from "react-router-dom";
import type { MenuItem, ModifierGroup, SelectedModifier } from "@restaurant/types";
import { Alert, Button, EmptyState, Skeleton } from "@restaurant/ui";
import { apiClient } from "../lib/api";
import { useCart } from "../context/CartContext";
import { useRestaurant } from "../context/RestaurantContext";
import { useActiveTheme } from "../theme/useActiveTheme";
import { PlateIcon } from "../theme/icons";
import { useNoIndex } from "../hooks/useNoIndex";
import { useStorefrontSeo, type MenuResponse } from "../hooks/useStorefrontSeo";

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
    activeCustomDomain,
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
  // Two separate useMatch calls, each unconditionally invoked (never combined into one
  // short-circuited `||` expression) — a hook call must never be conditionally skipped, and
  // `Boolean(useMatch(a)) || Boolean(useMatch(b))` did exactly that: whenever the first match
  // succeeded, `||`'s short-circuit meant the second useMatch call never ran on that render,
  // violating React's rules of hooks (caught by this workspace's own eslint, apparently never run
  // to completion against apps/web before now — the two calls change places across renders as the
  // route changes, which is exactly the "hooks called in a different order" failure mode the rule
  // exists to catch).
  const nestedTableRouteMatch = useMatch("/r/:restaurantSlug/t/:tableToken");
  const bareTableRouteMatch = useMatch("/t/:tableToken");
  const isTableRoute = Boolean(nestedTableRouteMatch) || Boolean(bareTableRouteMatch);
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

  // SEO audit fix — the seeded sales-demo storefront (seed-demo-data.ts's "demo-restaurant") is
  // fictional content, not a real business; it's excluded from the dynamic sitemap
  // (apps/api/src/routes/sitemap.routes.ts) but was otherwise fully indexable/crawlable like any
  // real restaurant. Belt-and-suspenders with that sitemap exclusion, same as this file's own
  // isTableRoute noindex above is belt-and-suspenders with robots.txt's Disallow list.
  useNoIndex(restaurant?.slug === "demo-restaurant");
  // Phase 79 — preview mode (isPreview, an authenticated owner/platform_admin-only view — see
  // RestaurantContext.tsx) can render a restaurant that isn't published yet, or restaurant data
  // that changes before it goes live; it must never be indexable. Independent, composable call to
  // the same shared hook, exactly mirroring the demo-restaurant call above.
  useNoIndex(isPreview);

  // SEO foundation (Part 20, extended Phase 12, extracted to a shared hook in Phase 79): every
  // restaurant-scoped menu page gets its own title, description, canonical URL, Twitter Card, and
  // Restaurant+Menu JSON-LD structured data — the indexable surface this platform actually wants
  // crawled/rich-result-eligible. Entirely independent of which theme is active — presentation
  // never affects SEO output. See useStorefrontSeo.ts for the tag mechanics (shared with
  // apps/marketing via @restaurant/utils/seoMeta) and the schema construction itself.
  useStorefrontSeo({ restaurant, menu, isTableRoute, isPreview, resolvedVia, activeCustomDomain });

  useEffect(() => {
    if (!restaurant) return;
    // Phase 79 tenant-isolation fix — a fast tenant switch (route change before this fetch
    // resolves) could previously let restaurant A's menu response land in state AFTER the page had
    // already moved on to restaurant B, painting A's menu (and, via useStorefrontSeo above, A's
    // JSON-LD) under B's page. Mirrors RestaurantContext.tsx's own `cancelled` flag pattern.
    let cancelled = false;
    apiClient
      .request<MenuResponse>(`/restaurants/${restaurant.id}/menu`, { skipRefresh: true })
      .then((data) => {
        if (!cancelled) setMenu(data);
      })
      .catch((err) => {
        if (!cancelled) setError((err as Error).message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
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
