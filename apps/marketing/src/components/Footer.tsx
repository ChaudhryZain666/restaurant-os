import { Link } from "react-router-dom";
import { Logo } from "@restaurant/ui";
import { Container } from "./Container";
import { ADMIN_LOGIN_URL, STOREFRONT_URL } from "../lib/links";

const COLUMNS = [
  {
    title: "Product",
    links: [
      { label: "Online Ordering", to: "/product#online-ordering" },
      { label: "Digital Menu", to: "/product#digital-menu" },
      { label: "Order Management", to: "/product#order-management" },
      { label: "Analytics", to: "/product#analytics" },
      { label: "Loyalty", to: "/product#loyalty" },
    ],
  },
  {
    title: "Solutions",
    links: [
      { label: "Independent Restaurants", to: "/solutions#independent" },
      { label: "Cafés & Fast Food", to: "/solutions#counter-service" },
      { label: "Takeaways & Pizzerias", to: "/solutions#pickup-heavy" },
      { label: "Multi-location & Growing", to: "/solutions#growing" },
      { label: "Agencies", to: "/solutions#agencies" },
    ],
  },
  {
    title: "Resources",
    links: [
      { label: "How It Works", to: "/how-it-works" },
      { label: "Pricing", to: "/pricing" },
      { label: "FAQs", to: "/faq" },
      { label: "Demo", to: "/demo" },
    ],
  },
  {
    title: "Company",
    links: [
      { label: "About", to: "/about" },
      { label: "Contact", to: "/contact" },
      { label: "Start Free Trial", to: "/start-trial" },
    ],
  },
];

/** Ink, like the scene every page now ends on — the closing CTA runs straight into it. */
export function Footer() {
  return (
    <footer className="theme-obsidian border-t border-white/10" style={{ background: "#0f0c0d" }}>
      <Container className="grid grid-cols-2 gap-8 py-14 sm:grid-cols-3 lg:grid-cols-5">
        <div className="col-span-2 flex flex-col gap-4 sm:col-span-3 lg:col-span-1">
          <Link to="/">
            <Logo size="sm" variant="light" />
          </Link>
          <p className="max-w-xs text-sm leading-relaxed text-white/55">
            Online ordering built for independent restaurants — your menu, your brand, your customer
            relationship.
          </p>
        </div>

        {COLUMNS.map((col) => (
          <div key={col.title} className="flex flex-col gap-2.5">
            <p className="mb-1 font-mono text-[10px] uppercase tracking-[0.26em] text-[#c9838d]">
              {col.title}
            </p>
            {col.links.map((link) => (
              <Link
                key={link.to}
                to={link.to}
                className="text-sm text-white/60 transition-colors hover:text-white"
              >
                {link.label}
              </Link>
            ))}
          </div>
        ))}
      </Container>

      <Container className="flex flex-col gap-3 border-t border-white/10 py-6 text-sm text-white/45 sm:flex-row sm:items-center sm:justify-between">
        <p>
          &copy; {new Date().getFullYear()} GarnishTable. Online ordering for independent
          restaurants.
        </p>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <Link to="/terms" className="transition-colors hover:text-white">
            Terms
          </Link>
          <Link to="/privacy" className="transition-colors hover:text-white">
            Privacy
          </Link>
          <Link to="/refund-policy" className="transition-colors hover:text-white">
            Refunds
          </Link>
          <a href={STOREFRONT_URL} className="transition-colors hover:text-white">
            View live demo restaurant
          </a>
          <a href={ADMIN_LOGIN_URL} className="transition-colors hover:text-white">
            Restaurant owner login
          </a>
        </div>
      </Container>
    </footer>
  );
}
