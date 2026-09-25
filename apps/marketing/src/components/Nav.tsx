import { useState } from "react";
import { Link, NavLink, useLocation } from "react-router-dom";
import { Button, Logo } from "@restaurant/ui";
import { ADMIN_LOGIN_URL } from "../lib/links";
import { useScrolled } from "../hooks/useScrolled";

// Phase 80 — routes whose hero renders on HomePage's dark `.theme-obsidian` canvas. Nav lives in
// Layout.tsx, OUTSIDE that wrapper, so it needs its own explicit list rather than inferring "dark
// hero" from page content — a synchronous, route-keyed check (not a context + effect) so there's
// zero flash-of-wrong-state on first paint. Extend this set as other routes get their own dark
// cinematic openers in a later stage.
const DARK_HERO_ROUTES = new Set(["/"]);

interface DropdownLink {
  label: string;
  to: string;
  description: string;
}

interface NavDropdown {
  label: string;
  links: DropdownLink[];
}

const PRODUCT: NavDropdown = {
  label: "Product",
  links: [
    { label: "Online Ordering", to: "/product#online-ordering", description: "Direct orders, no marketplace cut" },
    { label: "Digital Menu", to: "/product#digital-menu", description: "Photos, modifiers, availability" },
    { label: "Order Management", to: "/product#order-management", description: "Accept, prepare, complete" },
    { label: "Delivery", to: "/product#delivery", description: "Zones, fees and pickup together" },
    { label: "Customer Management", to: "/product#customers", description: "Order history at a glance" },
    { label: "Promotions", to: "/product#promotions", description: "Offers that bring people back" },
    { label: "Analytics", to: "/product#analytics", description: "Revenue and trends in real time" },
    { label: "Loyalty", to: "/product#loyalty", description: "Points that reward repeat orders" },
    { label: "QR Ordering", to: "/product#qr-ordering", description: "Table-side ordering by phone" },
    { label: "Restaurant Branding", to: "/product#branding", description: "Your colors, your identity" },
    { label: "Multi-location", to: "/product#multi-location", description: "One dashboard, every location" },
    { label: "Customer Support", to: "/product#support", description: "A help center customers actually use" },
  ],
};

const SOLUTIONS: NavDropdown = {
  label: "Solutions",
  links: [
    { label: "Independent Restaurants", to: "/solutions#independent", description: "Your own ordering channel" },
    { label: "Cafés & Fast Food", to: "/solutions#counter-service", description: "Fast, simple counter ordering" },
    { label: "Takeaways & Pizzerias", to: "/solutions#pickup-heavy", description: "Built for pickup speed" },
    { label: "Multi-location & Growing", to: "/solutions#growing", description: "Scale without losing your brand" },
    { label: "Agencies", to: "/solutions#agencies", description: "One login, every client's business" },
  ],
};

const RESOURCES: NavDropdown = {
  label: "Resources",
  links: [
    { label: "How It Works", to: "/how-it-works", description: "From signup to first order" },
    { label: "Features", to: "/product", description: "Everything the platform includes" },
    { label: "Demo", to: "/demo", description: "Try a real restaurant menu" },
    { label: "FAQs", to: "/faq", description: "Common questions answered" },
    { label: "Help Center", to: "/demo#help-center", description: "The support experience customers see" },
  ],
};

function Dropdown({ menu }: { menu: NavDropdown }) {
  return (
    <div className="group relative">
      <button
        // Phase 80 note: was `text-foreground/80`. Tailwind can't generate an opacity-modifier
        // utility for a color defined as a raw `var(--color-foreground)` reference (same class of
        // bug as this file's own header-background comment below, for `bg-surface/90`) — the class
        // silently failed to generate at all, so this button had no `color` rule of its own and
        // inherited whatever `:root` resolved to at load, frozen even after `.theme-obsidian`
        // overrides the custom property further down the tree (confirmed: nav links stayed dark
        // brown over the dark hero, unreadable). `text-muted` needs no opacity modifier — it's
        // already the correct "de-emphasized foreground" token, and it's theme-aware for real.
        className="flex items-center gap-1 rounded-pill px-3.5 py-2 text-sm font-medium text-muted transition-colors duration-fast hover:bg-black/[0.04] hover:text-foreground"
        aria-haspopup="true"
      >
        {menu.label}
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-3.5 w-3.5" aria-hidden>
          <path d="m6 9 6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      <div className="invisible absolute left-1/2 top-full z-30 w-[560px] -translate-x-1/2 pt-2 opacity-0 transition-all duration-fast group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100">
        <div className="grid grid-cols-2 gap-1 rounded-xl border border-border bg-surface p-3 shadow-elevated">
          {menu.links.map((link) => (
            <Link
              key={link.to}
              to={link.to}
              className="rounded-lg px-3 py-2.5 transition-colors duration-fast hover:bg-black/[0.03]"
            >
              <p className="text-sm font-medium text-foreground">{link.label}</p>
              <p className="text-xs text-muted">{link.description}</p>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}

function navLinkClass({ isActive }: { isActive: boolean }) {
  return [
    "rounded-pill px-3.5 py-2 text-sm font-medium transition-colors duration-fast",
    // Phase 80: `text-foreground/80` -> `text-muted`, same fix as Dropdown's button above.
    // `bg-primary/10` (active state) has the identical opacity-on-var() issue and was already
    // silently not generating before this phase — pre-existing, out of this stage's scope; the
    // active link's `text-primary` (no opacity modifier) still colors correctly either way.
    isActive ? "bg-primary/10 text-primary" : "text-muted hover:bg-black/[0.04] hover:text-foreground",
  ].join(" ");
}

function MobileDropdown({ menu, onNavigate }: { menu: NavDropdown; onNavigate: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between rounded-pill px-3.5 py-2 text-sm font-medium text-muted hover:bg-black/[0.04] hover:text-foreground"
      >
        {menu.label}
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          className={`h-3.5 w-3.5 transition-transform duration-fast ${open ? "rotate-180" : ""}`}
          aria-hidden
        >
          <path d="m6 9 6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <div className="ml-3 mt-1 flex flex-col gap-0.5 border-l border-border pl-3">
          {menu.links.map((link) => (
            <Link
              key={link.to}
              to={link.to}
              onClick={onNavigate}
              className="rounded-lg px-2.5 py-1.5 text-sm text-muted hover:bg-black/[0.03] hover:text-foreground"
            >
              {link.label}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

export function Nav() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const { pathname } = useLocation();
  const overDarkHero = DARK_HERO_ROUTES.has(pathname);
  // Raised from 10 to 24 (Phase 80) — at 10px the transparent-vs-solid swap felt twitchy right at
  // rest; 24px gives the dark hero a moment to actually read before the bar commits to solid.
  const scrolled = useScrolled(24);
  // Phase 80 — mirrors apps/web/src/theme/cinematic/Header.tsx's exact `solid = scrolled ||
  // mobileOpen || !hasHeroBehindIt` shape: a page with no dark hero is solid from pixel one (every
  // route but Home, today), an open mobile panel is always solid regardless of scroll position,
  // and Home itself only goes solid once actually scrolled.
  const solid = scrolled || mobileOpen || !overDarkHero;

  return (
    <header
      className={`sticky top-0 z-40 border-b backdrop-blur transition-[background-color,box-shadow,border-color] duration-300 ${
        solid ? "border-border shadow-sm" : "theme-obsidian border-transparent"
      }`}
      // Tailwind can't generate an opacity-modifier utility (`bg-surface/90`) for a color defined
      // as a raw `var(--color-surface)` reference (its `/N` syntax needs an rgb-channel or hex
      // literal it can splice an alpha into) — `bg-surface/90` silently compiled to nothing, so the
      // header had NO background at all and read whatever page content scrolled underneath it
      // (confirmed: unreadable nav text once scrolled past the dark hero). color-mix() works with
      // any valid color, opaque var() included, so it's the safe fix here without touching every
      // other place this app's tokens are consumed as plain `var(--color-*)` colors.
      //
      // Phase 80 — transparent mode (`!solid`) additionally applies the `.theme-obsidian` class
      // right here on the header itself. Nav renders in Layout.tsx, OUTSIDE HomePage's own
      // `.theme-obsidian` wrapper, so without this every `var(--color-foreground)`/`var(--color-
      // muted)`/`var(--color-primary)` reference below would resolve to :root's LIGHT palette —
      // dark-brown-on-near-black nav text over the dark hero. This is the exact ghost-nav bug
      // apps/web/src/theme/cinematic/Header.tsx already hit and fixed once; same fix here.
      style={{ backgroundColor: solid ? "color-mix(in srgb, var(--color-surface) 90%, transparent)" : "transparent" }}
    >
      <div
        className={`mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 transition-[padding] duration-300 sm:px-6 ${
          scrolled ? "py-2.5" : "py-3"
        }`}
      >
        <Link to="/">
          <Logo variant={solid ? "default" : "light"} />
        </Link>

        <nav className="hidden items-center gap-1 lg:flex" aria-label="Primary">
          <Dropdown menu={PRODUCT} />
          <Dropdown menu={SOLUTIONS} />
          <NavLink to="/pricing" className={navLinkClass}>
            Pricing
          </NavLink>
          <Dropdown menu={RESOURCES} />
          <NavLink to="/about" className={navLinkClass}>
            Company
          </NavLink>
        </nav>

        <div className="flex items-center gap-2">
          <a
            href={ADMIN_LOGIN_URL}
            className="hidden rounded-pill px-3 py-2 text-sm font-medium text-muted hover:text-foreground sm:inline-block"
          >
            Log in
          </a>
          <Link to="/start-trial" className="hidden sm:inline-block">
            <Button size="sm">Start Free Trial</Button>
          </Link>
          <button
            onClick={() => setMobileOpen((v) => !v)}
            aria-expanded={mobileOpen}
            aria-controls="mobile-nav"
            aria-label={mobileOpen ? "Close menu" : "Open menu"}
            className="flex h-10 w-10 items-center justify-center rounded-pill border border-border text-foreground lg:hidden"
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

      {/* Phase 80 note: an earlier draft of this panel used Framer Motion (LazyMotion + m +
          AnimatePresence) for a real exit animation. Measured against a real production build,
          that pulled motion/react's core into THIS app's entry chunk regardless — Nav.tsx is
          shared chrome, reachable synchronously from main.tsx via Layout.tsx, so nothing imported
          here can be deferred by LazyMotion's `features` prop (that only defers the
          domAnimation/domMax feature bundle, not the base package). Entry chunk grew by +30KB
          gzip, well past this stage's own +10KB budget. Reverted to the plain CSS entrance
          animation (`animate-slide-up`, see index.css) this panel already shipped with — no exit
          animation on close, same as before this phase. Framer Motion stays installed for Stage 2,
          where it belongs in route-level lazy-loaded components, not here. */}
      {mobileOpen && (
        <nav
          id="mobile-nav"
          aria-label="Primary mobile"
          className="animate-slide-up flex flex-col gap-1 border-t border-border px-4 py-3 lg:hidden"
        >
          <MobileDropdown menu={PRODUCT} onNavigate={() => setMobileOpen(false)} />
          <MobileDropdown menu={SOLUTIONS} onNavigate={() => setMobileOpen(false)} />
          <Link to="/pricing" className={navLinkClass({ isActive: false })} onClick={() => setMobileOpen(false)}>
            Pricing
          </Link>
          <Link to="/how-it-works" className={navLinkClass({ isActive: false })} onClick={() => setMobileOpen(false)}>
            How it works
          </Link>
          <Link to="/demo" className={navLinkClass({ isActive: false })} onClick={() => setMobileOpen(false)}>
            Demo
          </Link>
          <Link to="/faq" className={navLinkClass({ isActive: false })} onClick={() => setMobileOpen(false)}>
            FAQs
          </Link>
          <Link to="/about" className={navLinkClass({ isActive: false })} onClick={() => setMobileOpen(false)}>
            Company
          </Link>
          <div className="mt-2 flex items-center justify-between border-t border-border pt-3">
            <a href={ADMIN_LOGIN_URL} className="text-sm font-medium text-muted">
              Log in
            </a>
            <Link to="/start-trial" onClick={() => setMobileOpen(false)}>
              <Button size="sm">Start Free Trial</Button>
            </Link>
          </div>
        </nav>
      )}
    </header>
  );
}
