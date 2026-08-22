import { useEffect, useRef, useState } from "react";
import { Link, NavLink, Outlet, useMatch } from "react-router-dom";
import { Alert, Button, EmptyState, Skeleton } from "@restaurant/ui";
import { useAuth } from "../context/AuthContext";
import { useCart } from "../context/CartContext";
import { useRestaurant } from "../context/RestaurantContext";
import { AvailabilityBanner } from "./AvailabilityBanner";
import { TableBanner } from "./TableBanner";
import { HelpWidget } from "./HelpWidget";

function StoreOffIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className={className} aria-hidden>
      <path d="M3 9.5 4.5 3.5h15L21 9.5" />
      <path d="M5 10.5V21h14V10.5" />
      <path d="M3 3l18 18" strokeLinecap="round" />
    </svg>
  );
}

function CartIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={className} aria-hidden>
      <circle cx="9" cy="21" r="1" />
      <circle cx="19" cy="21" r="1" />
      <path d="M2.5 3h2l2.4 12.2a2 2 0 0 0 2 1.6h8.2a2 2 0 0 0 2-1.6L21 8H6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function navLinkClass({ isActive }: { isActive: boolean }) {
  return [
    "rounded-pill px-3.5 py-2 text-sm font-medium transition-colors duration-fast",
    isActive ? "bg-primary/10 text-primary" : "text-foreground/80 hover:bg-black/[0.04] hover:text-foreground",
  ].join(" ");
}

export function Layout() {
  const { user, logout } = useAuth();
  const { lines } = useCart();
  const { restaurant, loading: restaurantLoading, error: restaurantError } = useRestaurant();
  const itemCount = lines.reduce((sum, l) => sum + l.quantity, 0);

  // Every restaurant-facing link (brand, Menu, Cart, Loyalty) is slug-aware so navigation never
  // drops the customer out of the restaurant they're browsing — see RestaurantContext's Phase 8
  // doc-comment. Falls back to the legacy bare routes (which redirect to the default restaurant)
  // before a restaurant has resolved at all, e.g. on /login or /orders.
  const menuHref = restaurant ? `/r/${restaurant.slug}` : "/";
  const cartHref = restaurant ? `/r/${restaurant.slug}/cart` : "/cart";
  const loyaltyHref = restaurant ? `/r/${restaurant.slug}/loyalty` : "/loyalty";

  const [mobileOpen, setMobileOpen] = useState(false);
  const [popping, setPopping] = useState(false);
  const prevCount = useRef(itemCount);

  useEffect(() => {
    if (itemCount > prevCount.current) {
      setPopping(true);
      const t = setTimeout(() => setPopping(false), 320);
      prevCount.current = itemCount;
      return () => clearTimeout(t);
    }
    prevCount.current = itemCount;
  }, [itemCount]);

  const links = [
    { to: menuHref, label: "Menu", always: true },
    { to: "/orders", label: "Orders", always: false },
    { to: loyaltyHref, label: "Loyalty", always: false },
    { to: "/account", label: "Account", always: false },
    { to: "/support", label: "Support", always: true },
  ].filter((l) => l.always || user);

  // A restaurant-scoped URL that failed to resolve (bad slug, suspended restaurant) — replaces
  // the whole page body rather than letting each page under /r/:slug/* handle it separately.
  const onRestaurantRoute = Boolean(useMatch("/r/:restaurantSlug/*"));
  const restaurantNotFound = onRestaurantRoute && !restaurantLoading && !restaurant && Boolean(restaurantError);

  return (
    <div className="flex min-h-svh flex-col bg-background">
      <a href="#main-content" className="skip-link">
        Skip to content
      </a>

      <header className="sticky top-0 z-40 border-b border-border bg-surface/90 backdrop-blur supports-[backdrop-filter]:bg-surface/70">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <Link to={menuHref} className="flex min-w-0 items-center gap-2.5">
            {restaurant?.logo ? (
              <img src={restaurant.logo} alt="" className="h-9 w-9 shrink-0 rounded-full object-cover" loading="lazy" />
            ) : (
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary font-heading text-sm font-bold text-primary-foreground">
                {restaurant?.name?.[0]?.toUpperCase() ?? "R"}
              </span>
            )}
            {restaurantLoading ? (
              <Skeleton className="h-5 w-28" />
            ) : (
              <span className="truncate font-heading text-lg font-semibold text-foreground">
                {restaurant?.name ?? "Restaurant"}
              </span>
            )}
          </Link>

          <nav className="hidden items-center gap-1 md:flex" aria-label="Primary">
            {links.map((l) => (
              <NavLink key={l.to} to={l.to} end={l.to === menuHref} className={navLinkClass}>
                {l.label}
              </NavLink>
            ))}
          </nav>

          <div className="flex items-center gap-2">
            <Link
              to={cartHref}
              className="relative flex h-10 items-center gap-2 rounded-pill border border-border px-3.5 text-sm font-medium text-foreground transition-colors duration-fast hover:bg-black/[0.03]"
              aria-label={`Cart, ${itemCount} item${itemCount === 1 ? "" : "s"}`}
            >
              <CartIcon className="h-[18px] w-[18px]" />
              <span className="hidden sm:inline">Cart</span>
              <span
                className={`flex h-5 min-w-5 items-center justify-center rounded-pill bg-primary px-1 text-xs font-semibold text-primary-foreground ${
                  popping ? "animate-pop" : ""
                }`}
              >
                {itemCount}
              </span>
            </Link>

            {user ? (
              <div className="hidden items-center gap-2 sm:flex">
                <span className="max-w-[10ch] truncate text-sm text-muted">{user.name}</span>
                <Button variant="ghost" size="sm" onClick={() => logout()}>
                  Log out
                </Button>
              </div>
            ) : (
              <div className="hidden items-center gap-2 sm:flex">
                <Link to="/login" className="rounded-pill px-3 py-2 text-sm font-medium text-foreground/80 hover:text-foreground">
                  Log in
                </Link>
                <Link to="/register">
                  <Button size="sm">Sign up</Button>
                </Link>
              </div>
            )}

            <button
              onClick={() => setMobileOpen((v) => !v)}
              aria-expanded={mobileOpen}
              aria-controls="mobile-nav"
              aria-label={mobileOpen ? "Close menu" : "Open menu"}
              className="flex h-10 w-10 items-center justify-center rounded-pill border border-border text-foreground md:hidden"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-5 w-5" aria-hidden>
                {mobileOpen ? (
                  <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
                ) : (
                  <path d="M4 7h16M4 12h16M4 17h16" strokeLinecap="round" />
                )}
              </svg>
            </button>
          </div>
        </div>

        {mobileOpen && (
          <nav
            id="mobile-nav"
            aria-label="Primary mobile"
            className="animate-slide-up flex flex-col gap-1 border-t border-border px-4 py-3 md:hidden"
          >
            {links.map((l) => (
              <NavLink key={l.to} to={l.to} end={l.to === menuHref} className={navLinkClass} onClick={() => setMobileOpen(false)}>
                {l.label}
              </NavLink>
            ))}
            <div className="mt-2 flex items-center justify-between border-t border-border pt-3">
              {user ? (
                <>
                  <span className="text-sm text-muted">{user.name}</span>
                  <Button variant="ghost" size="sm" onClick={() => logout()}>
                    Log out
                  </Button>
                </>
              ) : (
                <>
                  <Link to="/login" className="text-sm font-medium text-foreground/80" onClick={() => setMobileOpen(false)}>
                    Log in
                  </Link>
                  <Link to="/register" onClick={() => setMobileOpen(false)}>
                    <Button size="sm">Sign up</Button>
                  </Link>
                </>
              )}
            </div>
          </nav>
        )}
      </header>

      {!restaurantNotFound && <AvailabilityBanner />}
      {!restaurantNotFound && <TableBanner />}

      <main id="main-content" className="flex-1 px-4 py-6 sm:px-6 sm:py-8">
        {restaurantNotFound ? (
          <div className="mx-auto max-w-xl">
            <EmptyState
              icon={<StoreOffIcon className="h-6 w-6" />}
              title="We can't find that restaurant"
              description="This link doesn't match a restaurant we know about — it may have been mistyped, or the restaurant is no longer active. Double-check the link, or ask the restaurant for a fresh one."
              action={
                <Alert tone="danger" role="alert" className="text-left">
                  {restaurantError}
                </Alert>
              }
            />
          </div>
        ) : (
          <Outlet />
        )}
      </main>

      <footer className="border-t border-border px-4 py-6 text-center text-sm text-muted sm:px-6">
        <p>
          {restaurant?.name ?? "Restaurant"} · Powered by a platform built for real restaurants, not a website
          builder.
        </p>
      </footer>

      <HelpWidget />
    </div>
  );
}
