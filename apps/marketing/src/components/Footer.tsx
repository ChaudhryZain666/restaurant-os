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

export function Footer() {
  return (
    <footer className="border-t border-border bg-surface">
      <Container className="grid grid-cols-2 gap-8 py-12 sm:grid-cols-3 lg:grid-cols-5">
        <div className="col-span-2 flex flex-col gap-3 sm:col-span-3 lg:col-span-1">
          <Link to="/">
            <Logo size="sm" />
          </Link>
          <p className="max-w-xs text-sm text-muted">
            Online ordering built for independent restaurants — your menu, your brand, your customer relationship.
          </p>
        </div>

        {COLUMNS.map((col) => (
          <div key={col.title} className="flex flex-col gap-2">
            <p className="text-sm font-semibold text-foreground">{col.title}</p>
            {col.links.map((link) => (
              <Link key={link.to} to={link.to} className="text-sm text-muted transition-colors hover:text-foreground">
                {link.label}
              </Link>
            ))}
          </div>
        ))}
      </Container>

      <Container className="flex flex-col gap-3 border-t border-border py-6 text-sm text-muted sm:flex-row sm:items-center sm:justify-between">
        <p>&copy; {new Date().getFullYear()} Tablecloth. A demo restaurant-commerce platform.</p>
        <div className="flex items-center gap-4">
          <a href={STOREFRONT_URL} className="transition-colors hover:text-foreground">
            View live demo restaurant
          </a>
          <a href={ADMIN_LOGIN_URL} className="transition-colors hover:text-foreground">
            Restaurant owner login
          </a>
        </div>
      </Container>
    </footer>
  );
}
