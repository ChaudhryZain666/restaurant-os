import { useState } from "react";
import { Link, NavLink } from "react-router-dom";
import { Skeleton } from "@restaurant/ui";
import type { HeaderProps } from "../types";
import { CartIcon, CloseGlyphIcon, MenuGlyphIcon } from "../icons";

/** Luxury — understated boutique chrome: a small serif wordmark, a handful of plain text links
 *  (no pills, no background fills), a single hairline border beneath the whole bar. Solid and
 *  sticky from the first pixel — never floating/transparent-over-hero, which would read as
 *  dramatic rather than restrained (that register belongs to Cinematic). */
export function LuxuryHeader({ restaurant, restaurantLoading, menuHref, cartHref, links, itemCount, cartPopping, userName, onLogout }: HeaderProps) {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-4 sm:px-8 sm:py-5">
        <Link to={menuHref} className="flex min-w-0 items-center gap-2.5">
          {restaurant?.logo && <img src={restaurant.logo} alt="" className="h-7 w-7 shrink-0 object-cover" loading="lazy" />}
          {restaurantLoading ? (
            <Skeleton className="h-4 w-28" />
          ) : (
            <span className="truncate font-heading text-base font-medium tracking-[0.04em] text-foreground">{restaurant?.name}</span>
          )}
        </Link>

        <nav className="hidden items-center gap-9 md:flex" aria-label="Primary">
          {links.map((l) => (
            <NavLink
              key={l.to}
              to={l.to}
              end={l.end ?? l.to === menuHref}
              className={({ isActive }) =>
                `border-b pb-0.5 text-[13px] font-medium tracking-[0.02em] transition-colors duration-fast ${
                  isActive ? "border-foreground text-foreground" : "border-transparent text-muted hover:text-foreground"
                }`
              }
            >
              {l.label}
            </NavLink>
          ))}
        </nav>

        <div className="flex items-center gap-5">
          <Link
            to={cartHref}
            aria-label={`Cart, ${itemCount} item${itemCount === 1 ? "" : "s"}`}
            className="hidden items-center gap-2 text-[13px] font-medium tracking-[0.02em] text-foreground sm:flex"
          >
            <CartIcon className="h-[17px] w-[17px]" />
            <span className={cartPopping ? "animate-pop" : ""}>Cart ({itemCount})</span>
          </Link>
          <Link
            to={cartHref}
            aria-label={`Cart, ${itemCount} item${itemCount === 1 ? "" : "s"}`}
            className="flex items-center gap-1.5 text-foreground sm:hidden"
          >
            <CartIcon className="h-[18px] w-[18px]" />
            <span className={`text-xs font-medium ${cartPopping ? "animate-pop" : ""}`}>{itemCount}</span>
          </Link>

          {userName ? (
            <button onClick={onLogout} className="hidden text-[13px] font-medium text-muted hover:text-foreground sm:block">
              Log out
            </button>
          ) : (
            <Link to="/login" className="hidden text-[13px] font-medium text-muted hover:text-foreground sm:block">
              Log in
            </Link>
          )}

          <button
            onClick={() => setMobileOpen((v) => !v)}
            aria-expanded={mobileOpen}
            aria-controls="mobile-nav"
            aria-label={mobileOpen ? "Close menu" : "Open menu"}
            className="flex h-9 w-9 items-center justify-center text-foreground md:hidden"
          >
            {mobileOpen ? <CloseGlyphIcon className="h-5 w-5" /> : <MenuGlyphIcon className="h-5 w-5" />}
          </button>
        </div>
      </div>

      {mobileOpen && (
        <nav id="mobile-nav" aria-label="Primary mobile" className="flex flex-col gap-1 border-t border-border px-5 py-5 md:hidden">
          {links.map((l) => (
            <NavLink
              key={l.to}
              to={l.to}
              end={l.end ?? l.to === menuHref}
              onClick={() => setMobileOpen(false)}
              className="py-2.5 text-sm font-medium text-foreground"
            >
              {l.label}
            </NavLink>
          ))}
          <div className="mt-2 flex items-center justify-between border-t border-border pt-4">
            {userName ? (
              <>
                <span className="text-xs text-muted">{userName}</span>
                <button onClick={onLogout} className="text-[13px] font-medium text-foreground">
                  Log out
                </button>
              </>
            ) : (
              <>
                <Link to="/login" onClick={() => setMobileOpen(false)} className="text-[13px] font-medium text-muted">
                  Log in
                </Link>
                <Link to="/register" onClick={() => setMobileOpen(false)} className="text-[13px] font-medium text-foreground">
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
