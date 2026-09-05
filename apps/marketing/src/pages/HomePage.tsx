import { Link } from "react-router-dom";
import { Button, Reveal } from "@restaurant/ui";
import { Section, SectionHeading } from "../components/Section";
import { usePageMeta } from "../hooks/usePageMeta";
import { ProductShowcase } from "../components/ProductShowcase";
import { HeroScene } from "../components/HeroScene";
import { OperationsBoard } from "../components/OperationsBoard";
import { JourneyRoute } from "../components/JourneyRoute";
import { ScaleSelector } from "../components/ScaleSelector";
import { WhyWeExist } from "../components/WhyWeExist";
import { WhyUseful } from "../components/WhyUseful";
import { WhatWeReplace } from "../components/WhatWeReplace";
import { MainGoal } from "../components/MainGoal";
import { FAQS } from "../lib/content";
import { IconArrowRight } from "../components/icons";

export function HomePage() {
  usePageMeta({
    title: "Tablecloth — Online Ordering for Independent Restaurants",
    description:
      "Launch your own branded online ordering experience. Menu, orders, delivery, loyalty and analytics — one platform, no commission-hungry marketplace.",
  });
  return (
    <div className="theme-obsidian bg-background">
      {/* Hero — "Arrival": the marketing site gets its OWN visual language here, deliberately
          distinct from the storefront themes it sells (Cinematic's own hero is exactly "dimmed
          restaurant photo + serif headline on top" — reusing that here would make the marketing
          site look like a clone of its own product, not a marketing experience around it). Instead
          of photography, the environment is graphic/technical: a floor-plan blueprint — the
          restaurant as a schematic, operational diagram, not a moody dining-room photo. The real
          product (the live iframe) is still the one photographic-fidelity object in the scene. */}
      <section className="relative isolate overflow-hidden bg-background">
        {/* Neutral blueprint lines and a plain-white spotlight — not amber. Amber is reserved for
            the one functional brand/action moment in this whole section (the Start Free Trial
            button) rather than washing the entire environment in the brand color. */}
        <div
          className="bg-grid-drift absolute inset-0 opacity-[0.1]"
          style={{
            backgroundImage: "linear-gradient(rgba(255,255,255,0.7) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.7) 1px, transparent 1px)",
            backgroundSize: "88px 88px",
          }}
          aria-hidden
        />
        <div
          className="absolute inset-0"
          style={{ background: "radial-gradient(ellipse 60% 50% at 30% 8%, rgba(255,255,255,0.08), transparent 65%)" }}
          aria-hidden
        />
        {/* schematic floor-plan zone — abstract, not a literal photo of a dining room. Pinned to a
            fixed offset from the top (not a content-height-relative percentage — the section's
            actual height varies with content/breakpoint, and a percentage position drifted into
            the slogan strip lower on the page on shorter viewports). */}
        <div className="pointer-events-none absolute inset-0 hidden lg:block" aria-hidden>
          <div className="absolute right-[6%] top-32 h-40 w-64 rounded-sm border border-dashed border-white/10" />
          <span className="absolute right-[6%] top-28 font-mono text-[9px] uppercase tracking-[0.16em] text-white/25">
            Sec. A — Dining
          </span>
        </div>

        <div className="relative flex min-h-[100svh] flex-col px-5 pb-10 pt-24 sm:px-8 sm:pt-28 lg:px-14">
          <Reveal className="max-w-4xl">
            <span className="animate-fade-up font-mono text-[11px] uppercase tracking-[0.24em] text-white/50">
              Built for independent restaurants
            </span>
            <h1 className="animate-fade-up font-heading text-[15vw] font-semibold leading-[0.92] tracking-tight text-white sm:text-[10vw] lg:text-[5.6rem] xl:text-[6.6rem]">
              Your restaurant.
              <br />
              <span className="italic text-white/85">Running on your terms.</span>
            </h1>
            <p className="mt-6 max-w-md animate-fade-up text-lg text-white/75" style={{ animationDelay: "60ms" }}>
              Tablecloth gives your restaurant a branded ordering page, a real order-management dashboard, and the
              customer data a marketplace app never hands back to you.
            </p>
            <div className="mt-8 flex animate-fade-up flex-wrap items-center gap-3" style={{ animationDelay: "120ms" }}>
              <Link to="/start-trial">
                <Button size="lg">Start Free Trial</Button>
              </Link>
              <Link to="/how-it-works">
                <Button size="lg" variant="outline" className="border-white/40 text-white hover:bg-white/10">
                  See How It Works
                </Button>
              </Link>
            </div>
            <div className="mt-5 flex animate-fade-up items-center gap-6 text-sm text-white/60" style={{ animationDelay: "180ms" }}>
              <span className="flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-success" /> No commission on direct orders
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-success" /> Your own brand, not a listing
              </span>
            </div>
          </Reveal>

          <div className="mt-16 lg:mt-auto lg:pt-16">
            <Reveal
              index={1}
              className="mb-8 flex flex-wrap items-center gap-x-8 gap-y-2 font-mono text-[11px] uppercase tracking-[0.1em] text-white/45"
            >
              <span>
                <span className="text-white">Best for</span> — independent restaurants, not a listing
              </span>
              <span>
                <span className="text-white">Best at</span> — ordering, menu, delivery, loyalty, analytics
              </span>
              <span>
                <span className="text-white">Replaces</span> — commission-charging marketplace apps
              </span>
            </Reveal>
            <Reveal index={2} variant="mask">
              <HeroScene />
            </Reveal>
          </div>
        </div>
      </section>

      {/* What we offer — "the restaurant coming alive": the same 12 features, same copy, same
          /product#id links, but as an operations board of varied-scale live moments instead of a
          repeated icon/title/paragraph card grid. Deliberately its own dark near-black canvas
          (not the Hero's blueprint grid) — same visual world, different composition, per the
          approved direction. */}
      <section id="offer" className="bg-[#0b0a08] px-5 py-20 sm:px-8 sm:py-28 lg:px-14">
        <OperationsBoard />
      </section>

      {/* Product showcase — "the control room": a third distinct scene in the same dark world.
          Hero is spatial/neutral (entering the system); Offer is a dense operations board
          (watching it run); this is a monitor wall (looking directly into it) — its own accent
          (cool info-blue, not amber) so the whole site doesn't collapse into one repeated
          dark+amber formula. */}
      <section id="showcase" className="bg-[#0f0d0c] px-5 py-20 sm:px-8 sm:py-28 lg:px-14">
        <ProductShowcase />
      </section>

      {/* How it works — "the route": a fourth distinct composition (a single continuous scroll-
          linked path, not a card grid) that still shares the Hero's neutral blueprint language
          rather than introducing a new dominant color. */}
      <section className="bg-[#0b0a08] px-5 py-20 sm:px-8 sm:py-28 lg:px-14">
        <JourneyRoute />
      </section>

      {/* Pricing — "choose your scale": a genuine new chapter, not another dark/neutral/amber
          section. Warm parchment ground, deep wine accent, no monospace (every earlier chapter
          used that register for operational/technical content; this one is commercial/editorial,
          so it deliberately drops it). The gradient at the top is the chapter transition itself —
          the previous section's near-black resolves into this one's warmth over the first ~14% of
          the section's height, rather than an abrupt hard cut between two backgrounds. */}
      <section
        className="px-5 py-24 sm:px-8 lg:px-14"
        style={{ background: "linear-gradient(180deg, #0b0a08 0%, #eee7d7 14%, #eee7d7 100%)" }}
      >
        <ScaleSelector />
      </section>

      {/* Why we exist — the problem, shown rather than stated. Transitions out of Pricing's warm
          parchment back into the dark world: a deliberate tone shift ("scale" to "why it matters"),
          not a random bounce. */}
      <section
        className="px-5 py-24 sm:px-8 lg:px-14"
        style={{ background: "linear-gradient(180deg, #eee7d7 0%, #0b0a08 16%, #0b0a08 100%)" }}
      >
        <WhyWeExist />
      </section>

      {/* Why it's useful, then what we replace — one sustained warm "business case" chapter (the
          real Benefits content, redesigned as a transformation, plus the real-pricing invoice
          collapse) rather than two more dark sections in a row. */}
      <section
        className="px-5 py-24 sm:px-8 lg:px-14"
        style={{ background: "linear-gradient(180deg, #0b0a08 0%, #eee7d7 16%, #eee7d7 100%)" }}
      >
        <WhyUseful />
      </section>
      <section className="px-5 pb-24 pt-4 sm:px-8 lg:px-14" style={{ background: "#eee7d7" }}>
        <WhatWeReplace />
      </section>

      {/* The main goal — the mission, back in the dark cinematic register for the closing beat. */}
      <section
        className="px-5 py-28 sm:px-8 lg:px-14"
        style={{ background: "linear-gradient(180deg, #eee7d7 0%, #0b0a08 16%, #0b0a08 100%)" }}
      >
        <MainGoal />
      </section>

      {/* Mini FAQ — a quiet, settled close after Main Goal's cinematic peak (per the brief:
          "restrained buildup, then stillness" applies here too, not just inside one section). Same
          dark canvas as Main Goal (no seam — genuinely the same background, not a redesign), but
          the material shifts from typography-as-hero to a plain answer list, deliberately calmer. */}
      <Section>
        <SectionHeading eyebrow="Questions" title="Quick answers" />
        <div className="mx-auto mt-10 flex max-w-2xl flex-col divide-y divide-white/10 border-t border-white/10">
          {FAQS.slice(0, 4).map((item, i) => (
            <Reveal key={item.q} index={i} className="py-5">
              <p className="font-heading text-lg text-secondary-foreground">{item.q}</p>
              <p className="mt-1.5 text-sm text-secondary-foreground/60">{item.a}</p>
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
        <Reveal variant="scale" className="flex flex-col items-center gap-6 rounded-2xl border border-border bg-gradient-to-br from-primary to-accent p-10 text-center sm:p-16">
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
    </div>
  );
}
