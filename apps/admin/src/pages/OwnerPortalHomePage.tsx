import { Link } from "react-router-dom";
import { Card, Logo } from "@restaurant/ui";
import {
  MARKETING_CONTACT_URL,
  MARKETING_HOME_URL,
  MARKETING_PRICING_URL,
  MARKETING_PRIVACY_URL,
  MARKETING_REFUND_URL,
  MARKETING_TERMS_URL,
} from "../lib/links";

const FEATURES = [
  { title: "Your own ordering storefront", body: "A branded page where customers order pickup and delivery directly from your restaurant." },
  { title: "Menu management", body: "Build your menu by hand or import it from a PDF, photos or your existing website." },
  { title: "Orders and kitchen", body: "Live order tracking, a kitchen display and staff accounts with their own permissions." },
  { title: "Simple subscription", body: "Monthly or annual plans, billed by Paddle. Start with a 14-day free trial, no card needed." },
];

/**
 * Launch, 2026-11-22 — the public home of app.garnishtable.com for a signed-out visitor (see
 * lib/publicHome.ts for exactly when it is shown). It says what this host is, and links to sign
 * in, start a trial, and the public pricing, terms, privacy, refund policy and contact on the
 * marketing site. Nothing here reads account data.
 */
export function OwnerPortalHomePage() {
  return (
    <div className="flex min-h-svh flex-col items-center bg-background px-4 py-10">
      <main className="flex w-full max-w-3xl flex-col gap-8">
        <header className="flex flex-wrap items-center justify-between gap-4">
          <Logo />
          <Link to="/login" className="text-sm font-medium text-primary hover:underline">
            Sign in
          </Link>
        </header>

        <section className="flex flex-col gap-4">
          <h1 className="font-heading text-3xl font-semibold text-foreground sm:text-4xl" style={{ textWrap: "balance" }}>
            The GarnishTable owner portal
          </h1>
          <p className="max-w-2xl text-base text-muted">
            GarnishTable is online ordering software for restaurants. Owners sign in here to run their storefront,
            menu, orders and staff, and to manage their GarnishTable subscription.
          </p>
          <div className="flex flex-wrap gap-3">
            <Link
              to="/login"
              className="inline-flex items-center justify-center rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90"
            >
              Sign in to your restaurant
            </Link>
            <Link
              to="/signup"
              className="inline-flex items-center justify-center rounded-lg border border-border px-4 py-2 text-sm font-semibold text-foreground hover:bg-surface"
            >
              Start a 14-day free trial
            </Link>
            <a
              href={MARKETING_PRICING_URL}
              className="inline-flex items-center justify-center px-2 py-2 text-sm font-medium text-primary hover:underline"
            >
              See pricing
            </a>
          </div>
        </section>

        <section aria-label="What GarnishTable includes" className="grid gap-4 sm:grid-cols-2">
          {FEATURES.map((f) => (
            <Card key={f.title} className="flex flex-col gap-1">
              <h2 className="text-sm font-semibold text-foreground">{f.title}</h2>
              <p className="text-sm text-muted">{f.body}</p>
            </Card>
          ))}
        </section>

        <footer className="flex flex-col gap-3 border-t border-border pt-6 text-xs text-muted">
          <p>
            GarnishTable subscriptions are sold and billed by Paddle, our merchant of record.{" "}
            <a href={MARKETING_HOME_URL} className="font-medium text-primary hover:underline">
              garnishtable.com
            </a>
          </p>
          <nav aria-label="GarnishTable policies" className="flex flex-wrap gap-x-4 gap-y-1">
            <a href={MARKETING_PRICING_URL} className="hover:underline">Pricing</a>
            <a href={MARKETING_TERMS_URL} className="hover:underline">Terms</a>
            <a href={MARKETING_PRIVACY_URL} className="hover:underline">Privacy</a>
            <a href={MARKETING_REFUND_URL} className="hover:underline">Refund policy</a>
            <a href={MARKETING_CONTACT_URL} className="hover:underline">Contact</a>
          </nav>
        </footer>
      </main>
    </div>
  );
}
