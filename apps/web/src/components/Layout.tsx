import { Outlet, useMatch } from "react-router-dom";
import { Alert, EmptyState } from "@restaurant/ui";
import { useAuth } from "../context/AuthContext";
import { useCart } from "../context/CartContext";
import { useRestaurant } from "../context/RestaurantContext";
import { useActiveTheme } from "../theme/useActiveTheme";
import { useCartPop } from "../theme/useCartPop";
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

/**
 * Phase 31 — the page chrome (header/footer) is now theme-swappable via `useActiveTheme()`, but
 * everything ELSE here is unchanged and shared across every theme: which nav links exist, the cart
 * badge count, auth state, the restaurant-not-found empty state, and the availability/table
 * banners. A theme's Header/Footer never sees CartContext, AuthContext, or the API directly — only
 * the plain data/callbacks this component computes and hands down (see theme/types.ts).
 */
export function Layout() {
  const { user, logout } = useAuth();
  const { lines } = useCart();
  const { restaurant, loading: restaurantLoading, error: restaurantError, resolvedVia } = useRestaurant();
  const { definition } = useActiveTheme();
  const { Header, Footer } = definition.components;
  const itemCount = lines.reduce((sum, l) => sum + l.quantity, 0);

  // Every restaurant-facing link (brand, Menu, Cart, Loyalty) is slug-aware so navigation never
  // drops the customer out of the restaurant they're browsing — see RestaurantContext's Phase 8
  // doc-comment. Falls back to the legacy bare routes (which redirect to the default restaurant)
  // before a restaurant has resolved at all, e.g. on /login or /orders.
  const menuHref = restaurant ? `/r/${restaurant.slug}` : "/";
  const cartHref = restaurant ? `/r/${restaurant.slug}/cart` : "/cart";
  const loyaltyHref = restaurant ? `/r/${restaurant.slug}/loyalty` : "/loyalty";

  const cartPopping = useCartPop(itemCount);

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

      <Header
        restaurant={restaurant}
        restaurantLoading={restaurantLoading}
        menuHref={menuHref}
        cartHref={cartHref}
        links={links}
        itemCount={itemCount}
        cartPopping={cartPopping}
        userName={user?.name ?? null}
        onLogout={() => logout()}
      />

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

      <Footer restaurant={restaurant} hideBranding={resolvedVia === "domain"} />

      <HelpWidget />
    </div>
  );
}
