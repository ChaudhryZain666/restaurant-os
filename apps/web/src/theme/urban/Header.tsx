import { useState } from "react";
import { Link, NavLink, useLocation } from "react-router-dom";
import { Skeleton } from "@restaurant/ui";
import type { HeaderProps } from "../types";
import { CartIcon, CloseGlyphIcon, MenuGlyphIcon, ArrowRightIcon } from "../icons";

function navLinkClass({ isActive }: { isActive: boolean }) {
  return [
    "block px-3 py-1.5 text-sm font-black uppercase tracking-tight transition-colors duration-fast",
    isActive ? "bg-primary text-primary-foreground" : "text-secondary-foreground/70 hover:bg-secondary-foreground/10 hover:text-secondary-foreground",
  ].join(" ");
}

/** Urban — a solid dark block bar (never transparent, never blurred), closed off by a thick
 *  primary-color rule instead of a hairline. The wordmark is a colored square "mark" (the
 *  restaurant's own initial/logo, never invented) beside bold condensed type; nav links are solid
 *  blocks on hover/active, not underlines. Doubles as the mount point for Urban's headline mobile
 *  feature: a fixed bottom order bar (mobile only) that reads cart state off the same
 *  cartHref/itemCount props Layout already hands every theme's Header — no CartContext access, no
 *  change to Layout.tsx. A scoped <style> media query (same DOM-injection pattern MenuPage already
 *  uses for its SEO tags) reserves body clearance under 768px so page content never sits behind it,
 *  without touching the shared Layout main padding. */
export function UrbanHeader({ restaurant, restaurantLoading, menuHref, cartHref, links, itemCount, cartPopping, userName, onLogout }: HeaderProps) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();
  const onCartPage = location.pathname === cartHref;
  const initial = restaurant?.name?.[0]?.toUpperCase() ?? "R";

  return (
    <>
      <header className="sticky top-0 z-40 border-b-4 border-primary bg-secondary text-secondary-foreground">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3.5 sm:px-6">
          <Link to={menuHref} className="flex min-w-0 items-center gap-3">
            {restaurant?.logo ? (
              <img src={restaurant.logo} alt="" className="h-9 w-9 shrink-0 object-cover" loading="lazy" />
            ) : (
              <span className="flex h-9 w-9 shrink-0 items-center justify-center bg-primary font-heading text-base font-black text-primary-foreground">
                {initial}
              </span>
            )}
            {restaurantLoading ? (
              <Skeleton className="h-5 w-32 bg-secondary-foreground/15" />
            ) : (
              <span className="truncate font-heading text-lg font-black uppercase tracking-tight text-secondary-foreground">{restaurant?.name}</span>
            )}
          </Link>

          <nav className="hidden items-center gap-1 md:flex" aria-label="Primary">
            {links.map((l) => (
              <NavLink key={l.to} to={l.to} end={l.end ?? l.to === menuHref} className={navLinkClass}>
                {l.label}
              </NavLink>
            ))}
          </nav>

          <div className="flex items-center gap-2.5">
            <Link
              to={cartHref}
              aria-label={`Cart, ${itemCount} item${itemCount === 1 ? "" : "s"}`}
              className="flex items-center gap-2 bg-primary px-3 py-2 font-black text-primary-foreground transition-transform duration-fast hover:-translate-y-0.5"
            >
              <CartIcon className="h-[17px] w-[17px]" />
              <span className={`text-sm ${cartPopping ? "animate-pop" : ""}`}>{itemCount}</span>
            </Link>

            {userName ? (
              <button
                onClick={onLogout}
                className="hidden text-xs font-black uppercase tracking-wide text-secondary-foreground/70 underline-offset-4 hover:text-secondary-foreground hover:underline sm:block"
              >
                Log out
              </button>
            ) : (
              <Link
                to="/login"
                className="hidden text-xs font-black uppercase tracking-wide text-secondary-foreground/70 underline-offset-4 hover:text-secondary-foreground hover:underline sm:block"
              >
                Log in
              </Link>
            )}

            <button
              onClick={() => setMobileOpen((v) => !v)}
              aria-expanded={mobileOpen}
              aria-controls="mobile-nav"
              aria-label={mobileOpen ? "Close menu" : "Open menu"}
              className="flex h-9 w-9 items-center justify-center border-2 border-secondary-foreground/40 text-secondary-foreground md:hidden"
            >
              {mobileOpen ? <CloseGlyphIcon className="h-4 w-4" /> : <MenuGlyphIcon className="h-4 w-4" />}
            </button>
          </div>
        </div>

        {mobileOpen && (
          <nav id="mobile-nav" aria-label="Primary mobile" className="flex flex-col border-t-4 border-primary md:hidden">
            {links.map((l) => (
              <NavLink
                key={l.to}
                to={l.to}
                end={l.end ?? l.to === menuHref}
                onClick={() => setMobileOpen(false)}
                className={({ isActive }) =>
                  `border-b border-secondary-foreground/10 px-5 py-3.5 text-sm font-black uppercase tracking-wide ${
                    isActive ? "bg-primary text-primary-foreground" : "text-secondary-foreground/85"
                  }`
                }
              >
                {l.label}
              </NavLink>
            ))}
            <div className="flex items-center justify-between px-5 py-3.5">
              {userName ? (
                <>
                  <span className="text-xs text-secondary-foreground/60">{userName}</span>
                  <button onClick={onLogout} className="text-xs font-black uppercase tracking-wide text-secondary-foreground">
                    Log out
                  </button>
                </>
              ) : (
                <>
                  <Link to="/login" onClick={() => setMobileOpen(false)} className="text-xs font-black uppercase tracking-wide text-secondary-foreground/85">
                    Log in
                  </Link>
                  <Link to="/register" onClick={() => setMobileOpen(false)} className="text-xs font-black uppercase tracking-wide text-secondary-foreground">
                    Sign up
                  </Link>
                </>
              )}
            </div>
          </nav>
        )}
      </header>

      {/* Reserves clearance under the fixed bar below for every screen under Tailwind's `md`
          breakpoint (768px) — injected here (not in Layout.tsx) since Header is this theme's only
          mount point, the same "inject a scoped tag from a component" pattern MenuPage already uses
          for its SEO <meta>/<script> tags. */}
      <style>{"@media (max-width: 767.98px) { body { padding-bottom: 4.75rem; } }"}</style>

      {!mobileOpen && !onCartPage && (
        <div className="fixed inset-x-0 bottom-0 z-40 flex items-center justify-between gap-3 border-t-4 border-secondary bg-primary px-4 py-3 text-primary-foreground md:hidden">
          <span className="flex min-w-0 items-center gap-2 font-black uppercase tracking-tight">
            <CartIcon className={`h-5 w-5 shrink-0 ${cartPopping ? "animate-pop" : ""}`} />
            <span className="truncate text-sm">
              {itemCount > 0 ? `${itemCount} item${itemCount === 1 ? "" : "s"} in cart` : "Ready to order?"}
            </span>
          </span>
          <Link
            to={itemCount > 0 ? cartHref : menuHref}
            className="flex shrink-0 items-center gap-1.5 bg-secondary px-4 py-2.5 text-xs font-black uppercase tracking-wide text-secondary-foreground"
          >
            {itemCount > 0 ? "View cart" : "Order now"}
            <ArrowRightIcon className="h-3.5 w-3.5" />
          </Link>
        </div>
      )}
    </>
  );
}
