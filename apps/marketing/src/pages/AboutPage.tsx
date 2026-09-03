import { Link } from "react-router-dom";
import { Button, Reveal } from "@restaurant/ui";
import { Section, SectionHeading } from "../components/Section";
import { IconArrowRight, IconChart, IconHeadset, IconPalette, IconStore } from "../components/icons";
import { usePageMeta } from "../hooks/usePageMeta";

const PRINCIPLES = [
  {
    title: "Ownership over rental",
    before: "A marketplace listing you don't control, that can change its terms, its ranking, its cut — at any time.",
    after: "A branded ordering page that's yours: your domain, your colors, your menu, permanently.",
  },
  {
    title: "Direct relationships over anonymous orders",
    before: "\"A customer of the app\" — no name, no order history, no way to reach them again.",
    after: "A real customer account tied to your restaurant, with the order history to prove they came back.",
  },
  {
    title: "Simpler operations over more dashboards",
    before: "A separate login for ordering, another for delivery, another for support — none of them talking to each other.",
    after: "One system: menu, orders, delivery, loyalty, promotions and support, all reading the same data.",
  },
  {
    title: "Sustainable growth over rented traffic",
    before: "Growth that disappears the moment you stop paying for placement in someone else's app.",
    after: "Growth that compounds — repeat customers, loyalty points, and a brand people come back to directly.",
  },
];

const TIMELINE = [
  { label: "The problem", body: "Restaurants selling online meant one thing: hand the relationship to a marketplace and pay for every order, forever." },
  { label: "The decision", body: "Build the tools a restaurant actually needs to sell direct — not a discovery app that happens to include ordering." },
  { label: "The shape it took", body: "A focused ordering platform: menu, orders, delivery, loyalty, promotions, analytics and support, under the restaurant's own brand." },
  { label: "Where it's headed", body: "The same principle applied to every restaurant type — one location or many, independent or agency-managed." },
];

export function AboutPage() {
  usePageMeta({
    title: "About — Tablecloth",
    description: "Why Tablecloth exists: restaurants deserve to own their ordering experience and customer relationships, not rent them back from a marketplace.",
  });
  return (
    <>
      <Section className="pt-14 sm:pt-20">
        <SectionHeading
          as="h1"
          eyebrow="Why this exists"
          title="Restaurants shouldn't have to rent back what they built"
          description="Tablecloth is a focused online ordering platform — not a marketplace, not a website builder. Just the tools a restaurant actually needs to sell direct, and keep what selling direct earns them."
        />
      </Section>

      <Section tone="surface">
        <Reveal className="mx-auto flex max-w-2xl flex-col gap-4 text-center">
          <span className="text-sm font-semibold uppercase tracking-wide text-primary">The premise</span>
          <p className="font-heading text-2xl font-medium text-foreground sm:text-3xl">
            Third-party marketplaces made restaurants easy to find — and expensive to keep every order after that.
          </p>
          <p className="text-muted">
            Every commission on a direct sale is money a restaurant already earned, paid again just to reach its own
            customer. We think that trade stopped making sense once a restaurant has its own brand worth protecting —
            so we built the alternative instead of another listing.
          </p>
        </Reveal>
      </Section>

      <Section>
        <SectionHeading eyebrow="What we chose" title="Four trade-offs we picked on purpose" align="left" />
        <div className="mt-10 grid gap-6 sm:grid-cols-2">
          {PRINCIPLES.map((p, i) => (
            <Reveal key={p.title} index={i} className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-6">
              <h3 className="font-heading text-lg font-semibold text-foreground">{p.title}</h3>
              <div className="flex flex-col gap-2 text-sm">
                <p className="flex gap-2 text-muted">
                  <span className="mt-0.5 shrink-0 font-mono text-xs text-danger/70">NOT</span>
                  {p.before}
                </p>
                <p className="flex gap-2 text-foreground/80">
                  <span className="mt-0.5 shrink-0 font-mono text-xs text-success">YES</span>
                  {p.after}
                </p>
              </div>
            </Reveal>
          ))}
        </div>
      </Section>

      <Section tone="surface">
        <SectionHeading eyebrow="How we got here" title="From problem to platform" />
        <div className="mx-auto mt-10 flex max-w-2xl flex-col divide-y divide-border">
          {TIMELINE.map((step, i) => (
            <Reveal key={step.label} index={i} className="flex gap-5 py-5">
              <span className="w-32 shrink-0 text-sm font-semibold text-primary">{step.label}</span>
              <p className="text-sm text-muted">{step.body}</p>
            </Reveal>
          ))}
        </div>
      </Section>

      <Section>
        <div className="grid gap-6 sm:grid-cols-3">
          {[
            { title: "Restaurants first", description: "Every decision starts with what actually helps a restaurant sell more direct orders — not what looks good on a features list.", icon: IconStore },
            { title: "Own your brand", description: "We build ordering software, not a marketplace listing. Your restaurant's identity stays yours.", icon: IconPalette },
            { title: "Grow on your terms", description: "Analytics, loyalty and promotions that compound the traffic you already earned, instead of renting more of it.", icon: IconChart },
          ].map((value, i) => (
            <Reveal key={value.title} index={i} className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-6">
              <span className="flex h-11 w-11 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <value.icon className="h-5 w-5" />
              </span>
              <h3 className="font-heading text-lg font-semibold text-foreground">{value.title}</h3>
              <p className="text-sm text-muted">{value.description}</p>
            </Reveal>
          ))}
        </div>
      </Section>

      <Section tone="dark">
        <Reveal className="flex flex-col items-center gap-5 text-center">
          <span className="flex h-11 w-11 items-center justify-center rounded-full bg-white/10 text-secondary-foreground">
            <IconHeadset className="h-5 w-5" />
          </span>
          <h2 className="font-heading text-3xl font-semibold text-secondary-foreground">Want to talk it through?</h2>
          <p className="max-w-md text-sm text-secondary-foreground/70">
            No sales script — just a straight answer about whether Tablecloth fits how your restaurant actually runs.
          </p>
          <div className="flex flex-wrap justify-center gap-3">
            <Link to="/contact">
              <Button size="lg" variant="secondary">
                Contact us
              </Button>
            </Link>
            <Link to="/start-trial">
              <Button size="lg" variant="outline" className="border-white/30 text-secondary-foreground hover:bg-white/10">
                Start Free Trial <IconArrowRight className="h-4 w-4" />
              </Button>
            </Link>
          </div>
        </Reveal>
      </Section>
    </>
  );
}
