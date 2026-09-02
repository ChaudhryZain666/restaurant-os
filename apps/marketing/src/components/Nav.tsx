import { useState } from "react";
import { Link, NavLink } from "react-router-dom";
import { Button, Logo } from "@restaurant/ui";
import { ADMIN_LOGIN_URL } from "../lib/links";

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
    { label: "Cafés", to: "/solutions#cafes", description: "Fast, simple counter ordering" },
    { label: "Takeaways", to: "/solutions#takeaways", description: "Built for pickup speed" },
    { label: "Fast Food", to: "/solutions#fast-food", description: "High volume, low friction" },
    { label: "Pizzerias", to: "/solutions#pizzerias", description: "Modifiers built for topping choices" },
    { label: "Multiple Locations", to: "/solutions#multi-location", description: "Manage every branch centrally" },
    { label: "Growing Businesses", to: "/solutions#growing", description: "Scale without losing your brand" },
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
        className="flex items-center gap-1 rounded-pill px-3.5 py-2 text-sm font-medium text-foreground/80 transition-colors duration-fast hover:bg-black/[0.04] hover:text-foreground"
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
    isActive ? "bg-primary/10 text-primary" : "text-foreground/80 hover:bg-black/[0.04] hover:text-foreground",
  ].join(" ");
}

function MobileDropdown({ menu, onNavigate }: { menu: NavDropdown; onNavigate: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between rounded-pill px-3.5 py-2 text-sm font-medium text-foreground/80 hover:bg-black/[0.04] hover:text-foreground"
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
              className="rounded-lg px-2.5 py-1.5 text-sm text-foreground/70 hover:bg-black/[0.03] hover:text-foreground"
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

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-surface/90 backdrop-blur supports-[backdrop-filter]:bg-surface/70">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
        <Link to="/">
          <Logo />
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
            className="hidden rounded-pill px-3 py-2 text-sm font-medium text-foreground/80 hover:text-foreground sm:inline-block"
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
            <a href={ADMIN_LOGIN_URL} className="text-sm font-medium text-foreground/80">
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
