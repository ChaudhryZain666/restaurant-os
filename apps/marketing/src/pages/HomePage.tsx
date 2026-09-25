import { useRef } from "react";
import { Link } from "react-router-dom";
import { Button, Logo, Reveal } from "@restaurant/ui";
import { Section, SectionHeading } from "../components/Section";
import { usePageMeta } from "../hooks/usePageMeta";
import { ProductShowcase } from "../components/ProductShowcase";
import { HeroScene } from "../components/HeroScene";
import { HeroBackdrop } from "../components/HeroBackdrop";
import { OperationsBoard } from "../components/OperationsBoard";
import { JourneyRoute } from "../components/JourneyRoute";
import { ScaleSelector } from "../components/ScaleSelector";
import { WhyWeExist } from "../components/WhyWeExist";
import { WhyUseful } from "../components/WhyUseful";
import { WhatWeReplace } from "../components/WhatWeReplace";
import { MainGoal } from "../components/MainGoal";
import { WhatIsGarnishTable } from "../components/WhatIsGarnishTable";
import { WhoIsItFor } from "../components/WhoIsItFor";
import { WhyGarnishTable } from "../components/WhyGarnishTable";
import { ThemeShowcase } from "../components/ThemeShowcase";
import { IntegrationsSection } from "../components/IntegrationsSection";
import { FAQS } from "../lib/content";
import { IconArrowRight } from "../components/icons";
import { FaqItem } from "./FaqPage";

export function HomePage() {
  usePageMeta({
    title: "GarnishTable — Online Ordering for Independent Restaurants",
    description:
      "Launch your own branded online ordering experience. Menu, orders, delivery, loyalty and analytics — one platform, no commission-hungry marketplace.",
  });
  const heroSectionRef = useRef<HTMLElement>(null);
  return (
    <div className="theme-obsidian bg-background">
      {/* Hero — "Arrival": the marketing site gets its OWN visual language here, deliberately
          distinct from the storefront themes it sells (Cinematic's own hero is exactly "dimmed
          restaurant photo + serif headline on top" — reusing that here would make the marketing
          site look like a clone of its own product, not a marketing experience around it). Instead
          of photography, the environment is graphic/technical: a floor-plan blueprint — the
          restaurant as a schematic, operational diagram, not a moody dining-room photo. The real
          product (the live iframe) is still the one photographic-fidelity object in the scene. */}
      {/* Phase 80 — pulled up by the nav's own at-rest height (61px, measured) and padded back
          down by the same amount: apps/web's Cinematic theme establishes the exact same pattern
          ("Hero.tsx pulls itself up to cancel Layout's own <main> padding") for the identical
          reason — Nav is `position: sticky`, which still occupies real layout space, so without
          this the hero's own box starts BELOW the nav with nothing overlapping behind it, and
          "transparent" nav mode has nothing dark to reveal (confirmed directly: it silently fell
          back to Layout's plain light `<body>` background instead of this section's dark canvas).
          Only this one hero pulls up — every other page keeps <main>'s normal, un-clawed-back
          top spacing, exactly like Cinematic's own header requires no Layout-wide change either. */}
      <section ref={heroSectionRef} className="relative isolate -mt-[61px] overflow-hidden bg-background pt-[61px]">
        {/* Phase 80 — the neutral blueprint lines + plain-white spotlight (not amber; amber stays
            reserved for the one functional brand/action moment, the Start Free Trial button) now
            live inside HeroBackdrop, which also owns the optional R3F upgrade: on eligible desktop
            devices it lazily cross-fades this CSS layer into a real 3D environment at idle, after
            first paint. Everyone else (mobile, reduced motion, low-power, no WebGL) simply keeps
            this exact CSS treatment forever — see HeroBackdrop.tsx for the full contract. */}
        <HeroBackdrop sectionRef={heroSectionRef} />
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
              GarnishTable gives your restaurant a branded ordering page, a real order-management dashboard, and the
              customer data a marketplace app never hands back to you.
            </p>
            <div className="mt-8 flex animate-fade-up flex-wrap items-center gap-3" style={{ animationDelay: "120ms" }}>
              <Link to="/start-trial">
                <Button size="lg">Start Free Trial</Button>
              </Link>
              <Link to="/demo">
                <Button size="lg" variant="outline" className="border-white/40 text-white hover:bg-white/10">
                  View Demo
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

      {/* What is GarnishTable — Phase 80 content add-on: the site's first calm beat, answering
          "what is this" in plain English before anything else asks the visitor to parse a feature
          list. A genuine light/parchment chapter break from the Hero's dark opening, not another
          dark scene — the "high movement -> calm" rhythm the brief asks for, placed as early as
          the narrative allows rather than buried after the product sections. */}
      <section
        className="px-5 py-24 sm:px-8 lg:px-14"
        style={{ background: "linear-gradient(180deg, var(--gt-ink-fixed) 0%, var(--gt-parchment-fixed) 14%, var(--gt-parchment-fixed) 100%)" }}
      >
        <WhatIsGarnishTable />
      </section>

      {/* What we offer — "the restaurant coming alive": the same 12 features, same copy, same
          /product#id links, but as an operations board of varied-scale live moments instead of a
          repeated icon/title/paragraph card grid. Deliberately its own dark near-black canvas
          (not the Hero's blueprint grid) — same visual world, different composition, per the
          approved direction. Phase 80 — now preceded by the light What-Is chapter rather than
          following the Hero directly, so this section's own top needs the parchment->ink
          transition that used to be unnecessary here. */}
      <section
        id="offer"
        className="px-5 py-20 sm:px-8 sm:py-28 lg:px-14"
        style={{ background: "linear-gradient(180deg, var(--gt-parchment-fixed) 0%, var(--gt-ink-fixed) 12%, var(--gt-ink-fixed) 100%)" }}
      >
        <OperationsBoard />
      </section>

      {/* Product showcase — "the control room": a third distinct scene in the same dark world.
          Hero is spatial/neutral (entering the system); Offer is a dense operations board
          (watching it run); this is a monitor wall (looking directly into it) — its own accent
          (cool info-blue, not amber) so the whole site doesn't collapse into one repeated
          dark+amber formula. */}
      <section id="showcase" className="bg-[color:var(--gt-ink-fixed)] px-5 py-20 sm:px-8 sm:py-28 lg:px-14">
        <ProductShowcase />
      </section>

      {/* How it works — "the route": a fourth distinct composition (a single continuous scroll-
          linked path, not a card grid) that still shares the Hero's neutral blueprint language
          rather than introducing a new dominant color. */}
      <section className="bg-[color:var(--gt-ink-fixed)] px-5 py-20 sm:px-8 sm:py-28 lg:px-14">
        <JourneyRoute />
      </section>

      {/* Phase 80 content add-on — the "decision" cluster: per the brief's own visual-hierarchy
          section, Who it's for / Why GarnishTable / Pricing / FAQ share one calmer, non-cinematic
          register, deliberately sustained across several sections rather than broken up with more
          dark chapters between each — this IS the "calm" half of "high movement -> calm," not
          monotony. Theme Showcase and Integrations join that same cluster (product-proof content
          that supports the decision, same register as Pricing). Only the first section here
          (Who's it for) carries the dark->parchment transition; everything after it is already on
          parchment and stays flat. */}
      <section
        className="px-5 py-24 sm:px-8 lg:px-14"
        style={{ background: "linear-gradient(180deg, var(--gt-ink-fixed) 0%, var(--gt-parchment-fixed) 14%, var(--gt-parchment-fixed) 100%)" }}
      >
        <WhoIsItFor />
      </section>
      <section className="px-5 py-20 sm:px-8 lg:px-14" style={{ background: "var(--gt-parchment-fixed)" }}>
        <WhyGarnishTable />
      </section>
      <section className="px-5 py-20 sm:px-8 lg:px-14" style={{ background: "var(--gt-parchment-fixed)" }}>
        <ThemeShowcase />
      </section>
      <section className="px-5 py-20 sm:px-8 lg:px-14" style={{ background: "var(--gt-parchment-fixed)" }}>
        <IntegrationsSection />
      </section>

      {/* Pricing — "choose your scale": a genuine new chapter, not another dark/neutral/amber
          section. Warm parchment ground, deep wine accent, no monospace (every earlier chapter
          used that register for operational/technical content; this one is commercial/editorial,
          so it deliberately drops it). Phase 80 — no longer needs its own top gradient: the
          decision cluster immediately above is already flat parchment, so the section-to-section
          cut here is seamless without one. */}
      <section className="px-5 py-24 sm:px-8 lg:px-14" style={{ background: "var(--gt-parchment-fixed)" }}>
        <ScaleSelector />
      </section>

      {/* Why we exist — the problem, shown rather than stated. Transitions out of Pricing's warm
          parchment back into the dark world: a deliberate tone shift ("scale" to "why it matters"),
          not a random bounce. */}
      <section
        className="px-5 py-24 sm:px-8 lg:px-14"
        style={{ background: "linear-gradient(180deg, var(--gt-parchment-fixed) 0%, var(--gt-ink-fixed) 16%, var(--gt-ink-fixed) 100%)" }}
      >
        <WhyWeExist />
      </section>

      {/* Why it's useful, then what we replace — one sustained warm "business case" chapter (the
          real Benefits content, redesigned as a transformation, plus the real-pricing invoice
          collapse) rather than two more dark sections in a row. */}
      <section
        className="px-5 py-24 sm:px-8 lg:px-14"
        style={{ background: "linear-gradient(180deg, var(--gt-ink-fixed) 0%, var(--gt-parchment-fixed) 16%, var(--gt-parchment-fixed) 100%)" }}
      >
        <WhyUseful />
      </section>
      <section className="px-5 pb-24 pt-4 sm:px-8 lg:px-14" style={{ background: "var(--gt-parchment-fixed)" }}>
        <WhatWeReplace />
      </section>

      {/* The main goal — the mission, back in the dark cinematic register for the closing beat. */}
      <section
        className="px-5 py-28 sm:px-8 lg:px-14"
        style={{ background: "linear-gradient(180deg, var(--gt-parchment-fixed) 0%, var(--gt-ink-fixed) 16%, var(--gt-ink-fixed) 100%)" }}
      >
        <MainGoal />
      </section>

      {/* Mini FAQ — a quiet, settled close after Main Goal's cinematic peak. Reuses FaqPage's own
          FaqItem accordion (Phase 79) rather than the old always-expanded divide-y list: that
          previous treatment rendered its answer text via `text-secondary-foreground/60`, a Tailwind
          opacity modifier applied to a custom color that is itself a chained `var()` reference
          (--color-secondary-foreground: var(--gt-ink-foreground)) — the exact class of bug this
          codebase has already hit and fixed elsewhere (see POSLayout.tsx's own
          --color-sidebar-foreground-dim comment), which left every answer essentially invisible
          against the dark canvas. An accordion sidesteps it entirely (closed by default, full
          opacity when opened) and reads as a considered, interactive moment rather than a wall of
          dim text — the same real component the standalone /faq page already uses, so both surfaces
          stay in sync for free. */}
      <Section>
        <SectionHeading eyebrow="Questions" title="Quick answers" />
        <div className="mx-auto mt-10 flex max-w-2xl flex-col gap-3">
          {FAQS.slice(0, 4).map((item, i) => (
            <FaqItem key={item.q} q={item.q} a={item.a} index={i} />
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

      {/* Final CTA — Phase 79 redesign: the previous version was a boxed gradient card, generic
          against the bespoke composition of every section above it. This instead bookends the Hero:
          the same blueprint-grid texture and radial glow "arrival" motif, the real logo mark as a
          closing signature, and the identical trust-indicator row the Hero opened with — a
          deliberate full-circle callback rather than a second, unrelated visual language, still on
          the same continuous dark canvas as Main Goal/FAQ above (no boxed card, no seam). */}
      <section className="relative isolate overflow-hidden px-5 py-28 sm:px-8 sm:py-36 lg:px-14">
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.08]"
          style={{
            backgroundImage:
              "linear-gradient(rgba(255,255,255,0.7) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.7) 1px, transparent 1px)",
            backgroundSize: "88px 88px",
          }}
          aria-hidden
        />
        <div
          className="pointer-events-none absolute inset-0"
          style={{ background: "radial-gradient(ellipse 55% 60% at 50% 40%, rgba(201,131,141,0.14), transparent 65%)" }}
          aria-hidden
        />
        <Reveal variant="scale" className="relative mx-auto flex max-w-2xl flex-col items-center gap-6 text-center">
          <Logo hideText size="lg" variant="light" />
          <h2 className="font-heading text-4xl font-semibold text-white sm:text-5xl">
            Ready to own your ordering experience?
          </h2>
          <p className="max-w-xl text-white/65">
            Tell us about your restaurant — our team will get your ordering page set up.
          </p>
          <div className="mt-2 flex flex-wrap items-center justify-center gap-3">
            <Link to="/start-trial">
              <Button size="lg">Start Free Trial</Button>
            </Link>
            <Link to="/demo">
              <Button size="lg" variant="outline" className="border-white/30 text-white hover:bg-white/10">
                View Demo
              </Button>
            </Link>
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-center gap-6 text-sm text-white/50">
            <span className="flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-success" /> No commission on direct orders
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-success" /> 14-day trial, no card required
            </span>
          </div>
        </Reveal>
      </section>
    </div>
  );
}
