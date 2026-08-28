import { useState } from "react";
import { Link, NavLink } from "react-router-dom";
import { Skeleton } from "@restaurant/ui";
import type { HeaderProps } from "../types";
import { CartIcon, CloseGlyphIcon, MenuGlyphIcon } from "../icons";

/** Contemporary — a two-tier geometric band, not a centered logo+links bar: a thin inverted utility
 *  strip (contact line + account) sits above a heavier main row where the wordmark is set beside an
 *  oversized square index mark, and navigation is separated from the cart by hard vertical rules
 *  rather than soft spacing. Solid, never transparent-over-hero (the split hero doesn't need it — see
 *  Hero.tsx's doc comment), and `sticky` so it behaves like every other theme's header on every
 *  non-hero page (Cart/Orders/Account/...). */
export function ContemporaryHeader({ restaurant, restaurantLoading, menuHref, cartHref, links, itemCount, cartPopping, userName, onLogout }: HeaderProps) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const locationLine = restaurant?.phone ?? (restaurant?.city ? `${restaurant.city}${restaurant.state ? `, ${restaurant.state}` : ""}` : "");

  return (
    <header className="sticky top-0 z-40 border-b-2 border-foreground bg-background">
      <div className="hidden items-center justify-between bg-foreground px-6 py-1.5 text-background sm:flex sm:px-10">
        <span className="text-[10px] font-semibold uppercase tracking-[0.24em]">{locationLine || " "}</span>
        {userName ? (
          <button onClick={onLogout} className="text-[10px] font-semibold uppercase tracking-[0.24em] hover:opacity-70">
            Log out — {userName}
          </button>
        ) : (
          <Link to="/login" className="text-[10px] font-semibold uppercase tracking-[0.24em] hover:opacity-70">
            Log in
          </Link>
        )}
      </div>

      <div className="mx-auto flex max-w-[1600px] items-center justify-between gap-4 px-5 py-4 sm:px-10 sm:py-5">
        <Link to={menuHref} className="flex min-w-0 items-center gap-3">
          {restaurant?.logo ? (
            <img src={restaurant.logo} alt="" className="h-10 w-10 shrink-0 object-cover" />
          ) : (
            <span className="flex h-10 w-10 shrink-0 items-center justify-center bg-primary font-heading text-lg font-black text-primary-foreground">
              {restaurant?.name?.[0]?.toUpperCase() ?? "R"}
            </span>
          )}
          {restaurantLoading ? (
            <Skeleton className="h-4 w-28" />
          ) : (
            <span className="truncate font-heading text-base font-black uppercase leading-none tracking-tight text-foreground">{restaurant?.name}</span>
          )}
        </Link>

        <nav className="hidden items-stretch divide-x-2 divide-border md:flex" aria-label="Primary">
          {links.map((l) => (
            <NavLink
              key={l.to}
              to={l.to}
              end={l.end ?? l.to === menuHref}
              className={({ isActive }) =>
                `flex items-center px-5 text-xs font-bold uppercase tracking-[0.16em] transition-colors duration-fast ${
                  isActive ? "text-primary" : "text-foreground/60 hover:text-foreground"
                }`
              }
            >
              {l.label}
            </NavLink>
          ))}
        </nav>

        <div className="flex items-center gap-4">
          <Link
            to={cartHref}
            aria-label={`Cart, ${itemCount} item${itemCount === 1 ? "" : "s"}`}
            className="flex h-10 items-center gap-2 border-2 border-foreground px-3 text-foreground"
          >
            <CartIcon className="h-4 w-4" />
            <span className={`text-xs font-black ${cartPopping ? "animate-pop" : ""}`}>{itemCount}</span>
          </Link>
          <button
            onClick={() => setMobileOpen((v) => !v)}
            aria-expanded={mobileOpen}
            aria-controls="mobile-nav"
            aria-label={mobileOpen ? "Close menu" : "Open menu"}
            className="flex h-10 w-10 items-center justify-center border-2 border-foreground text-foreground md:hidden"
          >
            {mobileOpen ? <CloseGlyphIcon className="h-4 w-4" /> : <MenuGlyphIcon className="h-4 w-4" />}
          </button>
        </div>
      </div>

      {mobileOpen && (
        <nav id="mobile-nav" aria-label="Primary mobile" className="flex flex-col border-t-2 border-foreground bg-background md:hidden">
          {links.map((l) => (
            <NavLink
              key={l.to}
              to={l.to}
              end={l.end ?? l.to === menuHref}
              onClick={() => setMobileOpen(false)}
              className="border-b border-border px-6 py-3.5 text-sm font-bold uppercase tracking-[0.14em] text-foreground"
            >
              {l.label}
            </NavLink>
          ))}
          <div className="flex items-center justify-between px-6 py-4">
            {userName ? (
              <>
                <span className="text-xs text-muted">{userName}</span>
                <button onClick={onLogout} className="text-xs font-bold uppercase tracking-[0.14em] text-foreground">
                  Log out
                </button>
              </>
            ) : (
              <>
                <Link to="/login" onClick={() => setMobileOpen(false)} className="text-xs font-bold uppercase tracking-[0.14em] text-foreground">
                  Log in
                </Link>
                <Link to="/register" onClick={() => setMobileOpen(false)} className="text-xs font-bold uppercase tracking-[0.14em] text-primary">
                  Sign up
                </Link>
              </>
            )}
          </div>
        </nav>
      )}
    </header>
  );
}
