import { useState } from "react";
import { Link, NavLink } from "react-router-dom";
import { Button, Skeleton } from "@restaurant/ui";
import type { HeaderProps } from "../types";
import { CartIcon, CloseGlyphIcon, MenuGlyphIcon } from "../icons";

/** Classic — the original storefront chrome: a soft sticky bar, pill-shaped nav links, a circular
 *  logo badge. Warm, familiar, "neighborhood restaurant website" register. */
function navLinkClass({ isActive }: { isActive: boolean }) {
  return [
    "rounded-pill px-3.5 py-2 text-sm font-medium transition-colors duration-fast",
    isActive ? "bg-primary/10 text-primary" : "text-foreground/80 hover:bg-black/[0.04] hover:text-foreground",
  ].join(" ");
}

export function ClassicHeader({ restaurant, restaurantLoading, menuHref, cartHref, links, itemCount, cartPopping, userName, onLogout }: HeaderProps) {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
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
            <span className="truncate font-heading text-lg font-semibold text-foreground">{restaurant?.name ?? "Restaurant"}</span>
          )}
        </Link>

        <nav className="hidden items-center gap-1 md:flex" aria-label="Primary">
          {links.map((l) => (
            <NavLink key={l.to} to={l.to} end={l.end ?? l.to === menuHref} className={navLinkClass}>
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
              className={`flex h-5 min-w-5 items-center justify-center rounded-pill bg-primary px-1 text-xs font-semibold text-primary-foreground ${cartPopping ? "animate-pop" : ""}`}
            >
              {itemCount}
            </span>
          </Link>

          {userName ? (
            <div className="hidden items-center gap-2 sm:flex">
              <span className="max-w-[10ch] truncate text-sm text-muted">{userName}</span>
              <Button variant="ghost" size="sm" onClick={onLogout}>
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
            {mobileOpen ? <CloseGlyphIcon className="h-5 w-5" /> : <MenuGlyphIcon className="h-5 w-5" />}
          </button>
        </div>
      </div>

      {mobileOpen && (
        <nav id="mobile-nav" aria-label="Primary mobile" className="animate-slide-up flex flex-col gap-1 border-t border-border px-4 py-3 md:hidden">
          {links.map((l) => (
            <NavLink key={l.to} to={l.to} end={l.end ?? l.to === menuHref} className={navLinkClass} onClick={() => setMobileOpen(false)}>
              {l.label}
            </NavLink>
          ))}
          <div className="mt-2 flex items-center justify-between border-t border-border pt-3">
            {userName ? (
              <>
                <span className="text-sm text-muted">{userName}</span>
                <Button variant="ghost" size="sm" onClick={onLogout}>
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
  );
}
