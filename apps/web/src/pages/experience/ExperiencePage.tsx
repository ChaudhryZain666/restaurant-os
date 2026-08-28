import { useNavigate } from "react-router-dom";
import { Button, Reveal } from "@restaurant/ui";
import { useRestaurant } from "../../context/RestaurantContext";
import { useAuth } from "../../context/AuthContext";
import { useCart } from "../../context/CartContext";
import { useNoIndex } from "../../hooks/useNoIndex";
import { PlaygroundPanel } from "./PlaygroundPanel";
import { QrPanel } from "./QrPanel";

const ADMIN_URL = import.meta.env.VITE_ADMIN_URL ?? "http://localhost:5174";
const MARKETING_URL = import.meta.env.VITE_MARKETING_URL ?? "http://localhost:5175";

/**
 * Phase 32 — the public sales playground. Composes entirely real, unmodified product surfaces
 * (the actual theme engine via PlaygroundPanel's embedded <MenuPage/>, the actual cart/checkout at
 * /r/:slug/cart) around a small amount of demo-specific chrome (this file). Deliberately NOT a
 * second storefront: nothing here re-implements menu rendering, cart logic, or order creation.
 *
 * noindex, deliberately (Phase 13's existing SEO policy against duplicate indexable URLs — see
 * App.tsx's LegacyRedirect comment): the canonical, search-indexed URL for this restaurant stays
 * /r/:slug; this route is a sales tool, not a second page that should compete with it in results.
 */
export function ExperiencePage() {
  useNoIndex();
  const { restaurant, loading } = useRestaurant();
  const { user, startDemoSession } = useAuth();
  const { lines } = useCart();
  const navigate = useNavigate();

  if (loading || !restaurant) return null;

  const experienceUrl = `${window.location.origin}/r/${restaurant.slug}/experience`;
  const itemCount = lines.reduce((n, l) => n + l.quantity, 0);

  async function handleTryCheckout() {
    if (!user) await startDemoSession();
    navigate(`/r/${restaurant!.slug}/cart`);
  }

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-16 pb-16">
      <Reveal as="section" className="flex flex-col items-center gap-4 pt-10 text-center">
        <span className="rounded-full border border-border bg-surface px-3 py-1 text-xs font-medium uppercase tracking-wide text-muted">
          Live product demo
        </span>
        <h1 className="max-w-2xl font-heading text-3xl font-semibold text-foreground sm:text-5xl">
          This is {restaurant.name}, running on our platform.
        </h1>
        <p className="max-w-xl text-base text-muted sm:text-lg">
          A real restaurant, a real menu, a real cart — customize how it looks below, then order from it
          yourself. Nothing here is a mockup.
        </p>
        <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
          <Button onClick={handleTryCheckout} size="lg">
            {itemCount > 0 ? `Try a real checkout (${itemCount})` : "Order online"}
          </Button>
          <Button
            variant="secondary"
            size="lg"
            onClick={() => document.getElementById("playground")?.scrollIntoView({ behavior: "smooth" })}
          >
            Explore the menu
          </Button>
        </div>
      </Reveal>

      <Reveal as="section" id="playground" className="flex flex-col gap-4">
        <div className="text-center">
          <h2 className="font-heading text-2xl font-semibold text-foreground">Make it yours</h2>
          <p className="mx-auto max-w-lg text-sm text-muted">
            Switch themes, change the brand colors, toggle sections — the preview on the right updates
            instantly, using the exact same rendering engine every real restaurant on this platform uses.
          </p>
        </div>
        <PlaygroundPanel />
      </Reveal>

      <Reveal as="section" className="grid grid-cols-1 items-center gap-8 sm:grid-cols-2">
        <QrPanel url={experienceUrl} />
        <div className="flex flex-col gap-3">
          <h2 className="font-heading text-xl font-semibold text-foreground">From website to table, in one scan</h2>
          <p className="text-sm text-muted">
            A restaurant using this platform prints this same QR code on a table tent or a menu card. A
            customer scans it, the menu opens instantly on their phone, and they order — no app to
            download, no separate system for dine-in versus online orders.
          </p>
        </div>
      </Reveal>

      <Reveal as="section" className="rounded-2xl border border-border bg-surface p-6 text-center sm:p-10">
        <h2 className="font-heading text-2xl font-semibold text-foreground">Also running an agency?</h2>
        <p className="mx-auto mt-2 max-w-xl text-sm text-muted">
          Manage every client restaurant's storefront, theme, and orders from one place — one login, many
          businesses.
        </p>
        <a href={`${ADMIN_URL}/start`} className="mt-4 inline-block">
          <Button variant="secondary">Set up an agency</Button>
        </a>
      </Reveal>

      <Reveal as="section" className="flex flex-col items-center gap-4 text-center">
        <h2 className="font-heading text-3xl font-semibold text-foreground">Ready to build yours?</h2>
        <p className="max-w-md text-sm text-muted">
          Everything you just used — the theme, the menu, the cart, the checkout — is exactly what your
          restaurant gets.
        </p>
        <div className="flex flex-wrap items-center justify-center gap-3">
          <a href={`${MARKETING_URL}/start-trial`}>
            <Button size="lg">Create your restaurant</Button>
          </a>
          <a href={MARKETING_URL}>
            <Button variant="ghost" size="lg">
              Explore the platform
            </Button>
          </a>
        </div>
      </Reveal>
    </div>
  );
}
