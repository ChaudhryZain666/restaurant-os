import { useState } from "react";
import { Link, NavLink } from "react-router-dom";
import { Button, Skeleton } from "@restaurant/ui";
import type { HeaderProps } from "../types";
import { CartIcon, CloseGlyphIcon, MenuGlyphIcon } from "../icons";

/** Editorial — a quiet, centered masthead: serif italic wordmark, a thin hairline rule, nav links
 *  separated by dots rather than pills or underlines. Reads like a magazine front page, not a
 *  storefront toolbar. */
function navLinkClass({ isActive }: { isActive: boolean }) {
  return ["text-xs uppercase tracking-[0.18em] transition-colors duration-fast", isActive ? "text-foreground" : "text-muted hover:text-foreground"].join(" ");
}

export function EditorialHeader({ restaurant, restaurantLoading, menuHref, cartHref, links, itemCount, cartPopping, userName, onLogout }: HeaderProps) {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <header className="sticky top-0 z-40 bg-background">
      <div className="mx-auto flex max-w-5xl flex-col items-center gap-2.5 px-4 pb-3 pt-4 sm:px-6">
        <div className="flex w-full items-center justify-between">
          <button
            onClick={() => setMobileOpen((v) => !v)}
            aria-expanded={mobileOpen}
            aria-controls="mobile-nav"
            aria-label={mobileOpen ? "Close menu" : "Open menu"}
            className="flex h-9 w-9 items-center justify-center text-foreground md:hidden"
          >
            {mobileOpen ? <CloseGlyphIcon className="h-5 w-5" /> : <MenuGlyphIcon className="h-5 w-5" />}
          </button>

          {restaurantLoading ? (
            <Skeleton className="mx-auto h-7 w-40" />
          ) : (
            <Link to={menuHref} className="mx-auto font-heading text-2xl italic text-foreground">
              {restaurant?.name ?? "Restaurant"}
            </Link>
          )}

          <Link to={cartHref} className="relative flex h-9 w-9 items-center justify-center text-foreground" aria-label={`Cart, ${itemCount} item${itemCount === 1 ? "" : "s"}`}>
            <CartIcon className="h-[18px] w-[18px]" />
            {itemCount > 0 && (
              <span className={`absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold text-primary-foreground ${cartPopping ? "animate-pop" : ""}`}>
                {itemCount}
              </span>
            )}
          </Link>
        </div>

        <nav className="hidden items-center gap-4 md:flex" aria-label="Primary">
          {links.map((l, i) => (
            <span key={l.to} className="flex items-center gap-4">
              {i > 0 && <span className="text-muted">·</span>}
              <NavLink to={l.to} end={l.end ?? l.to === menuHref} className={navLinkClass}>
                {l.label}
              </NavLink>
            </span>
          ))}
          <span className="text-muted">·</span>
          {userName ? (
            <button onClick={onLogout} className="text-xs uppercase tracking-[0.18em] text-muted hover:text-foreground">
              Log out
            </button>
          ) : (
            <Link to="/login" className="text-xs uppercase tracking-[0.18em] text-muted hover:text-foreground">
              Log in
            </Link>
          )}
        </nav>
      </div>
      <div className="border-t border-border" />

      {mobileOpen && (
        <nav id="mobile-nav" aria-label="Primary mobile" className="flex flex-col items-center gap-3 border-b border-border py-4 md:hidden">
          {links.map((l) => (
            <NavLink key={l.to} to={l.to} end={l.end ?? l.to === menuHref} className="text-sm uppercase tracking-[0.14em] text-foreground" onClick={() => setMobileOpen(false)}>
              {l.label}
            </NavLink>
          ))}
          {userName ? (
            <Button variant="ghost" size="sm" onClick={onLogout}>
              Log out
            </Button>
          ) : (
            <div className="flex items-center gap-3">
              <Link to="/login" className="text-sm text-foreground/80" onClick={() => setMobileOpen(false)}>
                Log in
              </Link>
              <Link to="/register" onClick={() => setMobileOpen(false)}>
                <Button size="sm">Sign up</Button>
              </Link>
            </div>
          )}
        </nav>
      )}
    </header>
  );
}
