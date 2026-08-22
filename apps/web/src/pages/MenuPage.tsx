import { useEffect, useMemo, useRef, useState } from "react";
import { useMatch } from "react-router-dom";
import type { Category, MenuItem, ModifierGroup, SelectedModifier } from "@restaurant/types";
import { Alert, Button, EmptyState, Reveal, Skeleton } from "@restaurant/ui";
import { formatCurrency } from "@restaurant/utils";
import { apiClient } from "../lib/api";
import { useCart } from "../context/CartContext";
import { useRestaurant } from "../context/RestaurantContext";

interface MenuResponse {
  items: MenuItem[];
  categories: Category[];
  modifierGroups: ModifierGroup[];
}

function PlateIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className={className} aria-hidden>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="4.5" />
    </svg>
  );
}

function ItemThumb({ item }: { item: MenuItem }) {
  if (item.imageUrl) {
    return (
      <div className="aspect-[4/3] w-full overflow-hidden rounded-lg bg-border">
        <img
          src={item.imageUrl}
          alt=""
          loading="lazy"
          decoding="async"
          className="h-full w-full object-cover transition-transform duration-slow ease-premium group-hover:scale-105"
        />
      </div>
    );
  }
  return (
    <div className="flex aspect-[4/3] w-full items-center justify-center rounded-lg bg-gradient-to-br from-primary/10 to-accent/10 text-primary/40">
      <PlateIcon className="h-10 w-10" />
    </div>
  );
}

export function MenuPage() {
  const { restaurant, availability, loading: restaurantLoading, error: restaurantError, isPreview } = useRestaurant();
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

  // /r/:slug/t/:tableToken URLs are QR-only entry points — they shouldn't accumulate in search
  // results (robots.txt disallows crawling them entirely; this noindex tag additionally covers
  // the case where a URL got linked/indexed from somewhere outside our own crawl surface).
  const isTableRoute = Boolean(useMatch("/r/:restaurantSlug/t/:tableToken"));
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

    const canonicalUrl = `${window.location.origin}/r/${restaurant.slug}`;
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
  }, [restaurant, menu, isTableRoute]);

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

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      {isPreview && (
        <Alert tone="warning">
          Preview mode — you're viewing this exactly as a customer eventually will, but this restaurant isn't
          published yet and no customer can see this page.
        </Alert>
      )}
      {/* Hero — short and functional: identity + availability, then straight to the menu. */}
      <section
        className="relative overflow-hidden rounded-2xl border border-border shadow-md"
        style={
          restaurant?.coverImage
            ? { backgroundImage: `linear-gradient(0deg, rgba(28,25,23,0.72), rgba(28,25,23,0.35)), url(${restaurant.coverImage})`, backgroundSize: "cover", backgroundPosition: "center" }
            : undefined
        }
      >
        <div className={restaurant?.coverImage ? "px-6 py-10 sm:px-10 sm:py-14" : "bg-gradient-to-br from-secondary to-secondary/80 px-6 py-10 sm:px-10 sm:py-14"}>
          <div className="flex items-center gap-3">
            {restaurant?.logo && (
              <img
                src={restaurant.logo}
                alt=""
                className={`h-12 w-12 shrink-0 rounded-full object-cover ring-2 ${restaurant?.coverImage ? "ring-white/70" : "ring-secondary-foreground/20"}`}
              />
            )}
            <h1 className={`animate-fade-up font-heading text-3xl font-semibold sm:text-4xl ${restaurant?.coverImage ? "text-white" : "text-secondary-foreground"}`}>
              {restaurant?.name}
            </h1>
          </div>
          {restaurant?.description && (
            <p className={`mt-2 max-w-xl animate-fade-up text-sm sm:text-base ${restaurant?.coverImage ? "text-white/85" : "text-secondary-foreground/80"}`} style={{ animationDelay: "60ms" }}>
              {restaurant.description}
            </p>
          )}
          <div className="mt-4 flex flex-wrap items-center gap-2 animate-fade-up" style={{ animationDelay: "120ms" }}>
            <span
              className={`inline-flex items-center gap-1.5 rounded-pill px-3 py-1 text-xs font-semibold ${
                orderingOpen ? "bg-success/15 text-success" : "bg-warning/15 text-warning"
              } ${restaurant?.coverImage ? "backdrop-blur" : ""}`}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${orderingOpen ? "bg-success" : "bg-warning"}`} aria-hidden />
              {orderingOpen
                ? "Open for orders"
                : availability?.status === "paused"
                  ? availability.reason || "Temporarily paused"
                  : "Closed right now"}
            </span>
            {restaurant?.settings.pickupEnabled && (
              <span className={`rounded-pill px-3 py-1 text-xs font-medium ${restaurant?.coverImage ? "bg-white/15 text-white backdrop-blur" : "bg-black/[0.06] text-foreground"}`}>
                Pickup available
              </span>
            )}
            {restaurant?.settings.deliveryEnabled && (
              <span className={`rounded-pill px-3 py-1 text-xs font-medium ${restaurant?.coverImage ? "bg-white/15 text-white backdrop-blur" : "bg-black/[0.06] text-foreground"}`}>
                Delivery available
              </span>
            )}
            {!!restaurant?.settings.minOrderAmount && (
              <span className={`rounded-pill px-3 py-1 text-xs font-medium ${restaurant?.coverImage ? "bg-white/15 text-white backdrop-blur" : "bg-black/[0.06] text-foreground"}`}>
                {formatCurrency(restaurant.settings.minOrderAmount, restaurant.settings.currency)} minimum order
              </span>
            )}
            {directionsQuery && (
              <a
                href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(directionsQuery)}`}
                target="_blank"
                rel="noreferrer"
                className={`rounded-pill px-3 py-1 text-xs font-medium underline-offset-2 hover:underline ${restaurant?.coverImage ? "bg-white/15 text-white backdrop-blur" : "bg-black/[0.06] text-foreground"}`}
              >
                Get directions ↗
              </a>
            )}
          </div>
          {orderingOpen && orderedCategoryIds.length > 0 && (
            <Button
              size="sm"
              className="mt-5 animate-fade-up"
              style={{ animationDelay: "160ms" }}
              onClick={() => scrollToCategory(orderedCategoryIds[0])}
            >
              Start your order
            </Button>
          )}
        </div>
      </section>

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

      {/* Category navigation — sticky, scroll-spy highlighted. */}
      {orderedCategoryIds.length > 1 && (
        <nav
          aria-label="Menu categories"
          className="sticky top-[65px] z-30 -mx-4 flex gap-2 overflow-x-auto border-b border-border bg-background/95 px-4 py-2.5 backdrop-blur sm:-mx-6 sm:px-6"
        >
          {orderedCategoryIds.map((categoryId) => (
            <button
              key={categoryId}
              onClick={() => scrollToCategory(categoryId)}
              className={`shrink-0 rounded-pill px-3.5 py-1.5 text-sm font-medium transition-colors duration-fast ${
                activeCategoryId === categoryId ? "bg-primary text-primary-foreground" : "bg-black/[0.04] text-foreground hover:bg-black/[0.08]"
              }`}
            >
              {categoriesById.get(categoryId)?.name ?? "Other"}
            </button>
          ))}
        </nav>
      )}

      {orderedCategoryIds.length === 0 && (
        <EmptyState
          icon={<PlateIcon className="h-6 w-6" />}
          title="Menu coming soon"
          description={`${restaurant?.name ?? "This restaurant"} hasn't published a menu yet — check back soon.`}
        />
      )}

      {orderedCategoryIds.map((categoryId) => (
        <section
          key={categoryId}
          id={`category-${categoryId}`}
          ref={(el) => {
            if (el) sectionRefs.current.set(categoryId, el);
          }}
          className="scroll-mt-32"
        >
          <h2 className="mb-3 text-xl font-semibold text-foreground">{categoriesById.get(categoryId)?.name ?? "Other"}</h2>
          <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {byCategory[categoryId].map((item, i) => {
              const groups = groupsByItem.get(item.id) ?? [];
              const expanded = expandedItemId === item.id;
              return (
                <Reveal
                  as="li"
                  index={i % 3}
                  key={item.id}
                  className="group flex h-full flex-col gap-2 rounded-xl border border-border bg-surface p-3 shadow-sm transition-shadow duration-normal hover:shadow-md"
                >
                  <ItemThumb item={item} />
                    <div className="flex flex-1 flex-col gap-1">
                      <div className="flex items-start justify-between gap-2">
                        <strong className="font-heading text-base font-semibold leading-tight text-foreground">{item.name}</strong>
                        <span className="shrink-0 whitespace-nowrap font-semibold text-primary">
                          {formatCurrency(item.price, restaurant?.settings.currency)}
                        </span>
                      </div>
                      {item.description && <p className="line-clamp-2 text-sm text-muted">{item.description}</p>}
                    </div>

                    {expanded ? (
                      <div className="mt-1 flex flex-col gap-3 border-t border-border pt-3">
                        {groups.map((group) => (
                          <fieldset key={group.id} className="flex flex-col gap-1.5">
                            <legend className="mb-0.5 text-sm font-medium text-foreground">
                              {group.name}{" "}
                              <span className="font-normal text-muted">
                                ({group.minSelect === group.maxSelect ? `choose ${group.minSelect}` : `choose ${group.minSelect}-${group.maxSelect}`})
                              </span>
                            </legend>
                            {group.options.map((option) => {
                              const checked = (selections[group.id] ?? []).includes(option.id);
                              return (
                                <label
                                  key={option.id}
                                  className={`flex cursor-pointer items-center justify-between gap-2 rounded-lg border px-2.5 py-1.5 text-sm transition-colors duration-fast ${
                                    checked ? "border-primary bg-primary/5" : "border-border hover:bg-black/[0.02]"
                                  }`}
                                >
                                  <span className="flex items-center gap-2">
                                    <input
                                      type={group.maxSelect === 1 ? "radio" : "checkbox"}
                                      name={group.id}
                                      checked={checked}
                                      onChange={() => toggleOption(group, option.id)}
                                      className="h-4 w-4 accent-[var(--color-primary)]"
                                    />
                                    {option.name}
                                  </span>
                                  {option.priceAdjustment > 0 && (
                                    <span className="text-muted">+{formatCurrency(option.priceAdjustment, restaurant?.settings.currency)}</span>
                                  )}
                                </label>
                              );
                            })}
                          </fieldset>
                        ))}
                        <label className="flex flex-col gap-1 text-sm">
                          <span className="text-foreground">Special instructions (optional)</span>
                          <input
                            value={instructionsDraft}
                            onChange={(e) => setInstructionsDraft(e.target.value)}
                            placeholder="e.g. no onions"
                            maxLength={300}
                            className="rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm"
                          />
                        </label>
                        <div className="flex gap-2">
                          <Button size="sm" className="flex-1" onClick={() => confirmAdd(item)} disabled={!orderingOpen}>
                            Confirm add to cart
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => setExpandedItemId(null)}>
                            Cancel
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <Button
                        onClick={() => startAdding(item)}
                        disabled={!orderingOpen}
                        size="sm"
                        variant={justAddedId === item.id ? "secondary" : "primary"}
                        className="mt-1"
                      >
                        {justAddedId === item.id ? "Added ✓" : "Add to cart"}
                      </Button>
                    )}
                </Reveal>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
