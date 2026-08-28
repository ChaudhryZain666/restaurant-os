import { useState } from "react";
import { Link, NavLink } from "react-router-dom";
import { Skeleton } from "@restaurant/ui";
import type { HeaderProps } from "../types";
import { CartIcon, CloseGlyphIcon, MenuGlyphIcon } from "../icons";
import { useScrolled } from "../useScrolled";

/** Cinematic — no border, no card: a slim, transparent nav that solidifies into a dark blurred bar
 *  once the visitor scrolls, sitting immediately above a full-bleed hero (Hero.tsx pulls itself up
 *  to cancel Layout's own <main> padding, so nothing but this slim transparent strip separates the
 *  viewport edge from the photograph). Wordmark left, a handful of uppercase tracked links right,
 *  cart reduced to a bare icon+count (no pill/border). Stays `sticky` (in-flow), not `fixed` — a
 *  fixed/overlaid header would need Layout.tsx (shared across every theme) to reserve clearance for
 *  it on every non-hero page (Cart/Orders/Account/...), which a single theme must never require. */
export function CinematicHeader({ restaurant, restaurantLoading, menuHref, cartHref, links, itemCount, cartPopping, userName, onLogout }: HeaderProps) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const scrolled = useScrolled(60);
  const solid = scrolled || mobileOpen;

  return (
    <header
      className={`sticky top-0 z-40 transition-colors duration-slow ease-premium ${
        solid ? "bg-black/85 backdrop-blur-md" : "bg-transparent"
      }`}
    >
      <div className="mx-auto flex max-w-[1600px] items-center justify-between gap-4 px-5 py-5 sm:px-10">
        <Link to={menuHref} className="flex min-w-0 items-center gap-3">
          {restaurant?.logo && <img src={restaurant.logo} alt="" className="h-8 w-8 shrink-0 rounded-full object-cover" />}
          {restaurantLoading ? (
            <Skeleton className="h-4 w-24 bg-white/20" />
          ) : (
            <span className="truncate font-heading text-sm font-semibold uppercase tracking-[0.22em] text-white">{restaurant?.name}</span>
          )}
        </Link>

        <nav className="hidden items-center gap-8 md:flex" aria-label="Primary">
          {links.map((l) => (
            <NavLink
              key={l.to}
              to={l.to}
              end={l.end ?? l.to === menuHref}
              className={({ isActive }) =>
                `text-xs font-medium uppercase tracking-[0.18em] transition-colors duration-fast ${
                  isActive ? "text-white" : "text-white/60 hover:text-white"
                }`
              }
            >
              {l.label}
            </NavLink>
          ))}
        </nav>

        <div className="flex items-center gap-5">
          <Link to={cartHref} aria-label={`Cart, ${itemCount} item${itemCount === 1 ? "" : "s"}`} className="flex items-center gap-2 text-white">
            <CartIcon className="h-[18px] w-[18px]" />
            <span className={`text-xs font-semibold ${cartPopping ? "animate-pop" : ""}`}>{itemCount}</span>
          </Link>
          {userName ? (
            <button onClick={onLogout} className="hidden text-xs font-medium uppercase tracking-[0.14em] text-white/70 hover:text-white sm:block">
              Log out
            </button>
          ) : (
            <Link to="/login" className="hidden text-xs font-medium uppercase tracking-[0.14em] text-white/70 hover:text-white sm:block">
              Log in
            </Link>
          )}
          <button
            onClick={() => setMobileOpen((v) => !v)}
            aria-expanded={mobileOpen}
            aria-controls="mobile-nav"
            aria-label={mobileOpen ? "Close menu" : "Open menu"}
            className="flex h-9 w-9 items-center justify-center text-white md:hidden"
          >
            {mobileOpen ? <CloseGlyphIcon className="h-5 w-5" /> : <MenuGlyphIcon className="h-5 w-5" />}
          </button>
        </div>
      </div>

      {mobileOpen && (
        <nav
          id="mobile-nav"
          aria-label="Primary mobile"
          className="flex flex-col gap-1 border-t border-white/10 bg-black/95 px-5 py-6 md:hidden"
        >
          {links.map((l) => (
            <NavLink
              key={l.to}
              to={l.to}
              end={l.end ?? l.to === menuHref}
              onClick={() => setMobileOpen(false)}
              className="py-2.5 text-sm font-medium uppercase tracking-[0.16em] text-white/85"
            >
              {l.label}
            </NavLink>
          ))}
          <div className="mt-2 flex items-center justify-between border-t border-white/10 pt-4">
            {userName ? (
              <>
                <span className="text-xs text-white/60">{userName}</span>
                <button onClick={onLogout} className="text-xs font-medium uppercase tracking-[0.14em] text-white">
                  Log out
                </button>
              </>
            ) : (
              <>
                <Link to="/login" onClick={() => setMobileOpen(false)} className="text-xs font-medium uppercase tracking-[0.14em] text-white/85">
                  Log in
                </Link>
                <Link to="/register" onClick={() => setMobileOpen(false)} className="text-xs font-medium uppercase tracking-[0.14em] text-white">
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
