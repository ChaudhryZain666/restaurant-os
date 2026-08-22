import { Link } from "react-router-dom";
import { Badge, Button, Reveal } from "@restaurant/ui";
import { Section, SectionHeading } from "../components/Section";
import { usePageMeta } from "../hooks/usePageMeta";
import { FeatureCard } from "../components/FeatureCard";
import { ProductShowcase } from "../components/ProductShowcase";
import { StepList } from "../components/StepList";
import { OFFER_FEATURES, BENEFITS, FAQS } from "../lib/content";
import { STOREFRONT_URL } from "../lib/links";
import {
  IconArrowRight,
  IconCart,
  IconChart,
  IconClipboard,
  IconHeadset,
  IconMapPin,
  IconMenuBook,
  IconPalette,
  IconQr,
  IconStar,
  IconTag,
  IconTruck,
  IconUsers,
} from "../components/icons";

const FEATURE_ICONS = {
  "online-ordering": IconCart,
  "digital-menu": IconMenuBook,
  "order-management": IconClipboard,
  delivery: IconTruck,
  customers: IconUsers,
  promotions: IconTag,
  analytics: IconChart,
  loyalty: IconStar,
  "qr-ordering": IconQr,
  "multi-location": IconMapPin,
  branding: IconPalette,
  support: IconHeadset,
} as const;

export function HomePage() {
  usePageMeta({
    title: "Tablecloth — Online Ordering for Independent Restaurants",
    description:
      "Launch your own branded online ordering experience. Menu, orders, delivery, loyalty and analytics — one platform, no commission-hungry marketplace.",
  });
  return (
    <>
      {/* Hero */}
      <Section className="relative overflow-hidden pt-14 sm:pt-20">
        <div className="bg-grid pointer-events-none absolute inset-0 opacity-40 [mask-image:radial-gradient(ellipse_60%_50%_at_50%_0%,black,transparent)]" aria-hidden />
        <div className="relative grid items-center gap-12 lg:grid-cols-2">
          <Reveal className="flex flex-col items-start gap-6">
            <Badge tone="warning" className="animate-fade-up">
              Built for independent restaurants
            </Badge>
            <h1 className="animate-fade-up font-heading text-4xl font-semibold leading-[1.1] text-foreground sm:text-5xl">
              Launch your restaurant's <span className="text-gradient">own online ordering</span> experience
            </h1>
            <p className="max-w-lg animate-fade-up text-lg text-muted" style={{ animationDelay: "60ms" }}>
              Tablecloth gives your restaurant a branded ordering page, a real order-management dashboard, and the
              customer data a marketplace app never hands back to you.
            </p>
            <div className="flex animate-fade-up flex-wrap items-center gap-3" style={{ animationDelay: "120ms" }}>
              <Link to="/start-trial">
                <Button size="lg">Start Free Trial</Button>
              </Link>
              <Link to="/how-it-works">
                <Button size="lg" variant="outline">
                  See How It Works
                </Button>
              </Link>
            </div>
            <div className="flex animate-fade-up items-center gap-6 pt-2 text-sm text-muted" style={{ animationDelay: "180ms" }}>
              <span className="flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-success" /> No commission on direct orders
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-success" /> Your own brand, not a listing
              </span>
            </div>
          </Reveal>

          <Reveal index={1} className="relative">
            <div className="animate-float overflow-hidden rounded-2xl border border-border bg-surface shadow-elevated">
              <div className="flex items-center gap-1.5 border-b border-border bg-background px-4 py-2.5">
                <span className="h-2.5 w-2.5 rounded-full bg-danger/60" />
                <span className="h-2.5 w-2.5 rounded-full bg-warning/60" />
                <span className="h-2.5 w-2.5 rounded-full bg-success/60" />
                <span className="ml-3 truncate text-xs text-muted">{STOREFRONT_URL.replace("http://", "")}</span>
              </div>
              <iframe
                src={STOREFRONT_URL}
                title="Live demo restaurant preview"
                className="h-[420px] w-full border-0"
                loading="lazy"
              />
            </div>
            <div className="absolute -bottom-5 -left-5 hidden rounded-xl border border-border bg-surface p-3 shadow-lg sm:flex sm:items-center sm:gap-3">
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-success/15 text-success">
                <IconChart className="h-[18px] w-[18px]" />
              </span>
              <div>
                <p className="text-xs text-muted">Revenue this week</p>
                <p className="font-heading text-sm font-semibold text-foreground">$8,420</p>
              </div>
            </div>
          </Reveal>
        </div>
      </Section>

      {/* What we offer */}
      <Section id="offer" tone="surface">
        <SectionHeading
          eyebrow="What we offer"
          title="Everything a restaurant needs to sell online"
          description="Not a stripped-down ordering form — a full restaurant commerce toolkit, in one dashboard."
        />
        <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {OFFER_FEATURES.map((feature, i) => {
            const Icon = FEATURE_ICONS[feature.id];
            return (
              <FeatureCard
                key={feature.id}
                id={feature.id}
                to={`/product#${feature.id}`}
                index={i}
                icon={<Icon className="h-5 w-5" />}
                title={feature.title}
                description={feature.description}
                status={feature.status}
              />
            );
          })}
        </div>
      </Section>

      {/* Product showcase */}
      <Section id="showcase">
        <SectionHeading
          eyebrow="See it for yourself"
          title="This is what your restaurant could look like"
          description="A real owner dashboard, real menu management, and the actual live customer ordering experience."
        />
        <div className="mt-12">
          <ProductShowcase />
        </div>
      </Section>

      {/* How it works teaser */}
      <Section tone="surface">
        <SectionHeading eyebrow="How it works" title="From signup to your first order" />
        <div className="mt-14">
          <StepList compact />
        </div>
        <Reveal className="mt-10 flex justify-center">
          <Link to="/how-it-works">
            <Button variant="outline">
              See the full walkthrough <IconArrowRight className="h-4 w-4" />
            </Button>
          </Link>
        </Reveal>
      </Section>

      {/* Benefits */}
      <Section tone="dark">
        <SectionHeading
          eyebrow="Why restaurants switch"
          title={<span className="text-secondary-foreground">More than another ordering form</span>}
          description={<span className="text-secondary-foreground/70">The business case, not just the feature list.</span>}
        />
        <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {BENEFITS.map((benefit, i) => (
            <Reveal key={benefit.title} index={i % 3} className="flex flex-col gap-2 rounded-xl border border-white/10 bg-white/5 p-5">
              <h3 className="font-heading text-lg font-semibold text-secondary-foreground">{benefit.title}</h3>
              <p className="text-sm text-secondary-foreground/70">{benefit.description}</p>
            </Reveal>
          ))}
        </div>
      </Section>

      {/* Mini FAQ */}
      <Section tone="surface">
        <SectionHeading eyebrow="Questions" title="Quick answers" />
        <div className="mx-auto mt-10 grid max-w-3xl gap-3">
          {FAQS.slice(0, 4).map((item, i) => (
            <Reveal key={item.q} index={i} className="rounded-xl border border-border bg-background p-5">
              <p className="font-medium text-foreground">{item.q}</p>
              <p className="mt-1 text-sm text-muted">{item.a}</p>
            </Reveal>
          ))}
        </div>
        <Reveal className="mt-8 flex justify-center">
          <Link to="/faq">
            <Button variant="ghost">
              View all FAQs <IconArrowRight className="h-4 w-4" />
            </Button>
          </Link>
        </Reveal>
      </Section>

      {/* Final CTA */}
      <Section>
        <Reveal className="flex flex-col items-center gap-6 rounded-2xl border border-border bg-gradient-to-br from-primary to-accent p-10 text-center sm:p-16">
          <h2 className="font-heading text-3xl font-semibold text-primary-foreground sm:text-4xl">
            Ready to own your ordering experience?
          </h2>
          <p className="max-w-xl text-primary-foreground/90">
            Tell us about your restaurant — our team will get your ordering page set up.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-3">
            <Link to="/start-trial">
              <Button size="lg" variant="secondary">
                Start Free Trial
              </Button>
            </Link>
            <Link to="/pricing">
              <Button size="lg" variant="outline" className="border-primary-foreground/40 text-primary-foreground hover:bg-white/10">
                View Pricing
              </Button>
            </Link>
          </div>
        </Reveal>
      </Section>
    </>
  );
}
