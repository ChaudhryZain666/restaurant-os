import { useState } from "react";
import { Link, NavLink } from "react-router-dom";
import { Button, Skeleton } from "@restaurant/ui";
import type { HeaderProps } from "../types";
import { CartIcon, CloseGlyphIcon, MenuGlyphIcon } from "../icons";

/** Modern — a slim, high-contrast bar: an uppercase letter-spaced wordmark (no round logo badge),
 *  plain-text nav with an underline-on-active treatment, and an icon-only cart button with the
 *  count badge overlapping its corner. A hairline bottom border instead of a blurred/floating bar. */
function navLinkClass({ isActive }: { isActive: boolean }) {
  return [
    "border-b-2 px-1 py-1 text-xs font-semibold uppercase tracking-[0.14em] transition-colors duration-fast",
    isActive ? "border-primary text-foreground" : "border-transparent text-foreground/55 hover:text-foreground",
  ].join(" ");
}

export function ModernHeader({ restaurant, restaurantLoading, menuHref, cartHref, links, itemCount, cartPopping, userName, onLogout }: HeaderProps) {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <header className="sticky top-0 z-40 border-b-2 border-foreground bg-background">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3.5 sm:px-6">
        <Link to={menuHref} className="flex min-w-0 items-center gap-2">
          {restaurant?.logo && <img src={restaurant.logo} alt="" className="h-8 w-8 shrink-0 rounded-sm object-cover" loading="lazy" />}
          {restaurantLoading ? (
            <Skeleton className="h-5 w-32" />
          ) : (
            <span className="truncate text-lg font-black uppercase tracking-[0.06em] text-foreground">{restaurant?.name ?? "Restaurant"}</span>
          )}
        </Link>

        <nav className="hidden items-center gap-6 md:flex" aria-label="Primary">
          {links.map((l) => (
            <NavLink key={l.to} to={l.to} end={l.end ?? l.to === menuHref} className={navLinkClass}>
              {l.label}
            </NavLink>
          ))}
        </nav>

        <div className="flex items-center gap-3">
          <Link to={cartHref} className="relative flex h-10 w-10 items-center justify-center border-2 border-foreground text-foreground" aria-label={`Cart, ${itemCount} item${itemCount === 1 ? "" : "s"}`}>
            <CartIcon className="h-[18px] w-[18px]" />
            <span
              className={`absolute -right-2 -top-2 flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1 text-[11px] font-bold text-primary-foreground ${
                cartPopping ? "animate-pop" : ""
              }`}
            >
              {itemCount}
            </span>
          </Link>

          {userName ? (
            <div className="hidden items-center gap-3 sm:flex">
              <span className="max-w-[10ch] truncate text-xs font-semibold uppercase tracking-wide text-foreground/60">{userName}</span>
              <Button variant="ghost" size="sm" onClick={onLogout}>
                Log out
              </Button>
            </div>
          ) : (
            <div className="hidden items-center gap-3 sm:flex">
              <Link to="/login" className="text-xs font-semibold uppercase tracking-wide text-foreground/70 hover:text-foreground">
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
            className="flex h-10 w-10 items-center justify-center border-2 border-foreground text-foreground md:hidden"
          >
            {mobileOpen ? <CloseGlyphIcon className="h-5 w-5" /> : <MenuGlyphIcon className="h-5 w-5" />}
          </button>
        </div>
      </div>

      {mobileOpen && (
        <nav id="mobile-nav" aria-label="Primary mobile" className="flex flex-col gap-3 border-t-2 border-foreground px-4 py-4 md:hidden">
          {links.map((l) => (
            <NavLink
              key={l.to}
              to={l.to}
              end={l.end ?? l.to === menuHref}
              className="text-sm font-bold uppercase tracking-wide text-foreground"
              onClick={() => setMobileOpen(false)}
            >
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
