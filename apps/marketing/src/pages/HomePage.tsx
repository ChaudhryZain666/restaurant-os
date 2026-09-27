import { Link } from "react-router-dom";
import { Button, Reveal } from "@restaurant/ui";
import { Section, SectionHeading } from "../components/Section";
import { usePageMeta } from "../hooks/usePageMeta";
import { CinematicHero } from "../components/CinematicHero";
import { CinematicLoader } from "../components/CinematicLoader";
import { GlowMark } from "../components/GlowMark";
import { FilmGrain } from "../components/FilmGrain";
import { ProductShowcase } from "../components/ProductShowcase";
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
import { ActDivider } from "../components/ActDivider";
import { FAQS } from "../lib/content";
import { IconArrowRight } from "../components/icons";
import { FaqItem } from "./FaqPage";

/**
 * The homepage — the cinematic redesign, promoted here from its former `/cinematic` review route
 * once approved. The 16 sections keep the same real copy, live iframe, `usePublicPlans()` pricing,
 * links and FAQ as always; they're grouped into four narrative Acts via `ActDivider` corner labels
 * (no layout/background change from that), and the Hero/Final CTA are the genuinely new pieces
 * (`CinematicHero`, `GlowMark`, `FilmGrain`, `CinematicLoader`) built and reviewed at that separate
 * route before landing here.
 */
export function HomePage() {
  usePageMeta({
    title: "GarnishTable — Online Ordering for Independent Restaurants",
    description:
      "Launch your own branded online ordering experience. Menu, orders, delivery, loyalty and analytics — one platform, no commission-hungry marketplace.",
  });

  return (
    <div className="theme-obsidian bg-background">
      <CinematicLoader />
      <CinematicHero />

      <section
        className="px-5 py-24 sm:px-8 lg:px-14"
        style={{ background: "linear-gradient(180deg, var(--gt-ink-fixed) 0%, var(--gt-parchment-fixed) 14%, var(--gt-parchment-fixed) 100%)" }}
      >
        <WhatIsGarnishTable />
      </section>

      <section
        id="offer"
        className="px-5 py-20 sm:px-8 sm:py-28 lg:px-14"
        style={{ background: "linear-gradient(180deg, var(--gt-parchment-fixed) 0%, var(--gt-ink-fixed) 12%, var(--gt-ink-fixed) 100%)" }}
      >
        <OperationsBoard />
      </section>

      <section id="showcase" className="bg-[color:var(--gt-ink-fixed)] px-5 py-20 sm:px-8 sm:py-28 lg:px-14">
        <ProductShowcase />
      </section>

      <section className="relative bg-[color:var(--gt-ink-fixed)] px-5 py-20 sm:px-8 sm:py-28 lg:px-14">
        <ActDivider roman="II" title="The Order" />
        <JourneyRoute />
      </section>

      <section
        className="px-5 pb-16 pt-24 sm:px-8 lg:px-14"
        style={{ background: "linear-gradient(180deg, var(--gt-ink-fixed) 0%, var(--gt-parchment-fixed) 14%, var(--gt-parchment-fixed) 100%)" }}
      >
        <WhoIsItFor />
      </section>
      <section className="px-5 py-16 sm:px-8 lg:px-14" style={{ background: "var(--gt-parchment-fixed)" }}>
        <WhyGarnishTable />
      </section>
      <section className="px-5 py-20 sm:px-8 lg:px-14" style={{ background: "var(--gt-parchment-fixed)" }}>
        <ThemeShowcase />
      </section>

      <section className="relative px-5 py-20 sm:px-8 lg:px-14" style={{ background: "var(--gt-parchment-fixed)" }}>
        <ActDivider roman="III" title="The System" dark={false} />
        <IntegrationsSection />
      </section>

      <section className="px-5 py-24 sm:px-8 lg:px-14" style={{ background: "var(--gt-parchment-fixed)" }}>
        <ScaleSelector />
      </section>

      <section
        className="px-5 py-24 sm:px-8 lg:px-14"
        style={{ background: "linear-gradient(180deg, var(--gt-parchment-fixed) 0%, var(--gt-ink-fixed) 16%, var(--gt-ink-fixed) 100%)" }}
      >
        <WhyWeExist />
      </section>

      <section
        className="px-5 py-24 sm:px-8 lg:px-14"
        style={{ background: "linear-gradient(180deg, var(--gt-ink-fixed) 0%, var(--gt-parchment-fixed) 16%, var(--gt-parchment-fixed) 100%)" }}
      >
        <WhyUseful />
      </section>
      <section className="px-5 pb-24 pt-4 sm:px-8 lg:px-14" style={{ background: "var(--gt-parchment-fixed)" }}>
        <WhatWeReplace />
      </section>

      <section
        className="relative px-5 py-28 sm:px-8 lg:px-14"
        style={{ background: "linear-gradient(180deg, var(--gt-parchment-fixed) 0%, var(--gt-ink-fixed) 16%, var(--gt-ink-fixed) 100%)" }}
      >
        <ActDivider roman="IV" title="The Thesis" dark={false} />
        <MainGoal />
      </section>

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

      <section className="relative isolate overflow-hidden px-5 py-28 sm:px-8 sm:py-36 lg:px-14">
        <FilmGrain />
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
        {/* bookends the Hero — the same glow-lit mark and cinematic tagline that opened the film,
            closing it. */}
        <Reveal variant="scale" className="relative mx-auto flex max-w-2xl flex-col items-center gap-5 text-center">
          <GlowMark size={64} glowSize={120} />
          <span className="font-heading text-base italic tracking-tight text-white/70">
            The Restaurant, In Motion.
          </span>
          <h2 className="mt-2 font-heading text-4xl font-semibold text-white sm:text-5xl">
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
