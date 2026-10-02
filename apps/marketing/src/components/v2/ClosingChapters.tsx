import { Link } from "react-router-dom";
import { Reveal } from "@restaurant/ui";
import { ProductShowcase } from "../ProductShowcase";
import { ScaleSelector } from "../ScaleSelector";
import { ScaleGlyph } from "../ScaleGlyph";
import { GlowMark } from "../GlowMark";
import { FilmGrain } from "../FilmGrain";
import { AgencyMock, MockFrame } from "../FeatureMocks";
import { FaqItem } from "../FaqItem";
import { ADMIN_START_URL } from "../../lib/links";
import { Chapter, ChapterHeading, ChapterMark, INK, PARCHMENT } from "./Chapter";
import { BUYER_FAQS } from "./faqs";
import { ButtonLink } from "../ButtonLink";

/* ─── 07 — See it ──────────────────────────────────────────────────────────────────────────── */

/** The existing live-demo monitor wall, unchanged in behavior (the real storefront iframe never
 *  remounts), given its own chapter and stronger framing instead of sitting mid-page. */
export function DemoChapter() {
  return (
    <section
      id="demo"
      className="relative scroll-mt-20 px-5 py-24 sm:px-8 sm:py-32 lg:px-14"
      style={{ background: INK }}
    >
      <div className="mx-auto max-w-6xl">
        <ProductShowcase
          eyebrow="07 — See it"
          title="See the restaurant experience for yourself."
          description="Wildwood Kitchen is a demo restaurant running on the real platform — not a screenshot. Order from its storefront, then switch to the dashboard, menu and order queue behind it."
        />
        <div className="mt-10 flex justify-center">
          <Link
            to="/demo"
            className="font-mono text-[11px] uppercase tracking-[0.22em] text-white/55 underline-offset-4 hover:text-white hover:underline"
          >
            Open the full demo →
          </Link>
        </div>
      </div>
    </section>
  );
}

/* ─── 08 — Plans ───────────────────────────────────────────────────────────────────────────── */

/** ScaleSelector exactly as it is — live plans from GET /public/plans, never hardcoded. */
export function PlansChapter() {
  return (
    <section
      id="plans"
      className="relative scroll-mt-20 px-5 pb-24 pt-20 sm:px-8 lg:px-14"
      style={{ background: PARCHMENT }}
    >
      <div className="mx-auto mb-12 flex max-w-6xl justify-center">
        <ChapterMark n="08" label="Plans" dark={false} />
      </div>
      <ScaleSelector />
    </section>
  );
}

/* ─── 09 — Who it's for ────────────────────────────────────────────────────────────────────── */

const SEGMENTS = [
  {
    tier: "one" as const,
    title: "Independent restaurants",
    copy: "One location, a loyal local following, and a menu worth ordering directly. You want your own ordering page, not a listing.",
  },
  {
    tier: "few" as const,
    title: "Growing restaurant groups",
    copy: "Two locations or twenty. Each keeps its own menu, hours and staff, and you see the whole business in one place.",
  },
  {
    tier: "few" as const,
    title: "Restaurants building direct ordering",
    copy: "Already on marketplaces, and want regulars ordering from you instead — with loyalty and promo codes that give them a reason to.",
  },
];

export function WhoChapter() {
  return (
    <Chapter dark={false}>
      <ChapterHeading
        n="09"
        label="Who it's for"
        dark={false}
        title="Built for restaurants that want control."
        intro="GarnishTable is designed for a specific kind of restaurant — and for the agencies that serve them."
      />

      <div
        className="mt-16 grid gap-px overflow-hidden rounded-sm border sm:grid-cols-3"
        style={{ borderColor: "var(--gt-border-fixed)", background: "var(--gt-border-fixed)" }}
      >
        {SEGMENTS.map((s, i) => (
          <Reveal
            key={s.title}
            index={i}
            className="flex flex-col gap-4 p-7"
            style={{ background: PARCHMENT }}
          >
            <ScaleGlyph tier={s.tier} />
            <h3
              className="font-heading text-xl font-semibold"
              style={{ color: "var(--gt-text-fixed)" }}
            >
              {s.title}
            </h3>
            <p
              className="text-[15px] leading-relaxed"
              style={{ color: "var(--gt-text-muted-fixed)" }}
            >
              {s.copy}
            </p>
          </Reveal>
        ))}
      </div>

      {/* Agency — clear, but one band, not a takeover of the page. */}
      <Reveal
        className="mt-8 grid items-center gap-10 overflow-hidden rounded-sm p-8 sm:p-10 lg:grid-cols-[1.15fr_0.85fr]"
        style={{ background: INK }}
      >
        <div>
          <div className="flex items-center gap-4">
            <ScaleGlyph tier="many" />
            <span className="font-mono text-[11px] uppercase tracking-[0.22em] text-[#c9838d]">
              For agencies
            </span>
          </div>
          <h3 className="mt-5 font-heading text-3xl font-semibold text-[#f6f0e2]">
            Run every restaurant client from one login.
          </h3>
          <p className="mt-4 max-w-xl text-white/65">
            If you build websites or marketing for restaurants, an agency account lets you set up
            and manage each client's ordering, menu and storefront. Every client keeps their own
            brand, staff and owner access — and you get one consolidated bill.
          </p>
          <a
            href={ADMIN_START_URL}
            className="mt-7 inline-flex h-11 items-center rounded-pill border border-white/30 px-5 text-sm font-medium text-white transition-colors hover:bg-white/10"
          >
            Start an agency account →
          </a>
        </div>
        <div className="mx-auto w-full max-w-sm">
          <MockFrame>
            <AgencyMock />
          </MockFrame>
        </div>
      </Reveal>

      <p
        className="mt-10 max-w-2xl text-sm leading-relaxed"
        style={{ color: "var(--gt-text-muted-fixed)" }}
      >
        <span className="font-semibold" style={{ color: "var(--gt-text-fixed)" }}>
          Probably not the right fit
        </span>{" "}
        if you only want to be listed on a marketplace and don't plan to share your own ordering
        link — the value of GarnishTable comes from customers ordering from you directly.
      </p>
    </Chapter>
  );
}

/* ─── 10 — Why GarnishTable ────────────────────────────────────────────────────────────────── */

const REASONS = [
  {
    title: "Own the relationship",
    copy: "Customers order from you, under your name. Their details and order history stay with your restaurant, not a marketplace.",
  },
  {
    title: "One operating system",
    copy: "Storefront, kitchen, counter, delivery and growth tools share one order record — instead of five tools that don't talk to each other.",
  },
  {
    title: "Transparent pricing",
    copy: "A flat monthly or yearly subscription, and no GarnishTable commission on direct orders. Card processing is Stripe's standard fee, paid to Stripe.",
  },
  {
    title: "Built for growth",
    copy: "Start with one restaurant. Add locations — or manage client restaurants as an agency — on the same platform.",
  },
  {
    title: "Designed around the restaurant",
    copy: "Modifiers, 86'd items, kitchen timers, table QR codes. It's shaped around how service actually runs.",
  },
];

export function WhyChapter() {
  return (
    <Chapter dark>
      <ChapterHeading
        n="10"
        label="Why GarnishTable"
        dark
        title="One idea, all the way through: the restaurant stays at the center."
      />
      <ul className="mt-16 flex list-none flex-col p-0">
        {REASONS.map((r, i) => (
          <Reveal
            as="li"
            key={r.title}
            index={i}
            className="grid gap-3 border-t border-white/10 py-8 sm:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] sm:gap-12"
          >
            <h3 className="font-heading text-2xl text-[#f6f0e2] sm:text-3xl">{r.title}</h3>
            <p className="max-w-xl text-white/60 sm:pt-1.5">{r.copy}</p>
          </Reveal>
        ))}
      </ul>
    </Chapter>
  );
}

/* ─── 11 — FAQ ─────────────────────────────────────────────────────────────────────────────── */

export function FaqChapter() {
  return (
    <section className="relative px-5 pb-28 pt-8 sm:px-8 lg:px-14" style={{ background: INK }}>
      <div className="mx-auto grid max-w-6xl gap-12 border-t border-white/10 pt-24 lg:grid-cols-[0.85fr_1.15fr] lg:gap-20">
        <div className="lg:sticky lg:top-28 lg:self-start">
          <ChapterHeading n="11" label="Questions" dark title="Before you start." />
          <Link
            to="/faq"
            className="mt-6 inline-block font-mono text-[11px] uppercase tracking-[0.22em] text-white/55 underline-offset-4 hover:text-white hover:underline"
          >
            All questions →
          </Link>
        </div>
        <div className="flex flex-col gap-3">
          {BUYER_FAQS.map((item, i) => (
            <FaqItem key={item.q} q={item.q} a={item.a} index={i} />
          ))}
        </div>
      </div>
    </section>
  );
}

/* ─── 12 — Final CTA ───────────────────────────────────────────────────────────────────────── */

export function FinalChapter() {
  return (
    <section
      className="relative isolate overflow-hidden px-5 py-32 sm:px-8 sm:py-40 lg:px-14"
      style={{ background: INK }}
    >
      <FilmGrain />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.07]"
        style={{
          backgroundImage:
            "linear-gradient(rgba(255,255,255,0.7) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.7) 1px, transparent 1px)",
          backgroundSize: "88px 88px",
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse 50% 55% at 50% 38%, rgba(97,27,40,0.38), transparent 68%)",
        }}
      />
      <Reveal
        variant="scale"
        className="relative mx-auto flex max-w-3xl flex-col items-center text-center"
      >
        <ChapterMark n="12" label="Your move" dark />
        <div className="mt-10">
          <GlowMark size={64} glowSize={124} />
        </div>
        <h2
          className="mt-6 font-heading text-5xl font-semibold leading-[1.02] tracking-tight text-[#f6f0e2] sm:text-6xl lg:text-7xl"
          style={{ textWrap: "balance" }}
        >
          Your restaurant.
          <br />
          <span className="italic text-[#f6f0e2]/80">Running on your terms.</span>
        </h2>
        <p className="mt-7 max-w-xl text-lg leading-relaxed text-white/65">
          Your restaurant already has the brand, the food and the customers. GarnishTable gives you
          the system to run it.
        </p>
        <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
          <ButtonLink to="/start-trial" size="lg">
            Start your restaurant
          </ButtonLink>
          <Link
            to="/demo"
            className="inline-flex h-12 items-center rounded-pill border border-white/30 px-6 text-sm font-medium text-white transition-colors hover:bg-white/10"
          >
            See GarnishTable in action
          </Link>
        </div>
        <ul className="mt-7 flex list-none flex-wrap justify-center gap-x-6 gap-y-2 p-0 text-sm text-white/50">
          <li className="flex items-center gap-2">
            <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-success" />
            0% platform commission on direct orders
          </li>
          <li className="flex items-center gap-2">
            <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-success" />
            14-day trial, no card required
          </li>
        </ul>
      </Reveal>
    </section>
  );
}
