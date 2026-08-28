import { useState } from "react";
import { Link, NavLink } from "react-router-dom";
import { Skeleton } from "@restaurant/ui";
import type { HeaderProps } from "../types";
import { CartIcon, CloseGlyphIcon, MenuGlyphIcon } from "../icons";

/** Minimal — the quietest possible chrome: a small text wordmark (no logo image — one fewer visual
 *  element than every other theme's header), a handful of plain-text links separated by whitespace
 *  alone (no dots, no pills, no underline-on-hover flourish beyond a thin border), one hairline rule
 *  beneath, always the same flat `bg-background` (no solidify-on-scroll treatment — this header
 *  never has a hero image to sit transparently over, so there's nothing to solidify against). The
 *  inner row shares the exact `max-w-5xl` / `px-4 sm:px-6` measure MenuPage uses for its own content
 *  column (see Layout.tsx's `<main>`), so the wordmark's left edge and the Hero's left edge land on
 *  the same vertical line — the one alignment "trick" this theme allows itself; precision instead of
 *  decoration. Stays `sticky` (in-flow), matching every other theme's header. */
function navLinkClass({ isActive }: { isActive: boolean }) {
  return [
    "border-b pb-0.5 text-[13px] tracking-[0.02em] transition-colors duration-fast",
    isActive ? "border-foreground text-foreground" : "border-transparent text-muted hover:text-foreground",
  ].join(" ");
}

export function MinimalHeader({ restaurant, restaurantLoading, menuHref, cartHref, links, itemCount, cartPopping, userName, onLogout }: HeaderProps) {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background">
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-6 px-4 py-6 sm:px-6 sm:py-7">
        <Link to={menuHref} className="min-w-0">
          {restaurantLoading ? (
            <Skeleton className="h-4 w-28" />
          ) : (
            <span className="truncate text-[13px] font-medium tracking-[0.06em] text-foreground">{restaurant?.name ?? "Restaurant"}</span>
          )}
        </Link>

        <nav className="hidden items-center gap-9 md:flex" aria-label="Primary">
          {links.map((l) => (
            <NavLink key={l.to} to={l.to} end={l.end ?? l.to === menuHref} className={navLinkClass}>
              {l.label}
            </NavLink>
          ))}
        </nav>

        <div className="flex items-center gap-6">
          <Link
            to={cartHref}
            aria-label={`Cart, ${itemCount} item${itemCount === 1 ? "" : "s"}`}
            className="hidden items-center gap-2 text-foreground sm:flex"
          >
            <CartIcon className="h-[16px] w-[16px]" />
            <span className={`text-[13px] tabular-nums ${cartPopping ? "font-semibold" : "font-normal"}`}>{itemCount}</span>
          </Link>
          {userName ? (
            <button onClick={onLogout} className="hidden text-[13px] text-muted hover:text-foreground sm:block">
              Log out
            </button>
          ) : (
            <Link to="/login" className="hidden text-[13px] text-muted hover:text-foreground sm:block">
              Log in
            </Link>
          )}
          <button
            onClick={() => setMobileOpen((v) => !v)}
            aria-expanded={mobileOpen}
            aria-controls="mobile-nav"
            aria-label={mobileOpen ? "Close menu" : "Open menu"}
            className="flex h-8 w-8 items-center justify-center text-foreground md:hidden"
          >
            {mobileOpen ? <CloseGlyphIcon className="h-[18px] w-[18px]" /> : <MenuGlyphIcon className="h-[18px] w-[18px]" />}
          </button>
        </div>
      </div>

      {mobileOpen && (
        <nav id="mobile-nav" aria-label="Primary mobile" className="flex flex-col gap-1 border-t border-border px-4 py-5 md:hidden">
          {links.map((l) => (
            <NavLink
              key={l.to}
              to={l.to}
              end={l.end ?? l.to === menuHref}
              onClick={() => setMobileOpen(false)}
              className="py-2 text-sm text-foreground"
            >
              {l.label}
            </NavLink>
          ))}
          <div className="mt-3 flex items-center justify-between border-t border-border pt-4">
            <Link to={cartHref} onClick={() => setMobileOpen(false)} className="flex items-center gap-2 text-sm text-foreground">
              <CartIcon className="h-4 w-4" />
              Cart ({itemCount})
            </Link>
            {userName ? (
              <button onClick={onLogout} className="text-sm text-muted">
                Log out
              </button>
            ) : (
              <Link to="/login" onClick={() => setMobileOpen(false)} className="text-sm text-muted">
                Log in
              </Link>
            )}
          </div>
        </nav>
      )}
    </header>
  );
}
