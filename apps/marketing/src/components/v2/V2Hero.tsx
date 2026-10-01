import { Link } from "react-router-dom";
import { Button, Reveal } from "@restaurant/ui";
import { GlowMark } from "../GlowMark";
import { FilmGrain } from "../FilmGrain";
import { ChapterMark } from "./Chapter";
import { SystemRing, SystemStrip } from "./SystemRing";

const WHAT_IT_RUNS = [
  { href: "#sell", label: "Sell", copy: "Storefront, menu, QR ordering, promotions" },
  { href: "#run", label: "Run", copy: "Orders, kitchen, POS, delivery" },
  { href: "#grow", label: "Grow", copy: "Loyalty, analytics, customers, locations" },
  { href: "#system", label: "Connect", copy: "Stripe payments, Uber Eats, your own domain" },
];

/**
 * 01 — Arrival. Headline left, the restaurant's order loop right (the product's actual shape, not
 * a decorative object), and directly beneath, a plain-English answer to "what is this?" so nobody
 * has to scroll three sections to find out. Atmosphere is the CSS blueprint grid only — the old
 * hero's lazy R3F panels are deliberately not used here: beside the ring they were cropped,
 * meaningless shapes competing with the one visual that carries meaning, and a ~900KB chunk.
 */
export function V2Hero() {
  return (
    <section className="relative isolate -mt-[61px] overflow-hidden bg-[color:var(--gt-ink-fixed)] pt-[61px]">
      <div
        aria-hidden
        className="bg-grid-drift pointer-events-none absolute inset-0 opacity-[0.07]"
        style={{
          backgroundImage:
            "linear-gradient(rgba(255,255,255,0.7) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.7) 1px, transparent 1px)",
          backgroundSize: "88px 88px",
        }}
      />
      <FilmGrain />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse 50% 55% at 76% 42%, rgba(97,27,40,0.32), transparent 70%)",
        }}
      />

      <div className="relative mx-auto grid max-w-7xl items-center gap-12 px-5 pb-20 pt-20 sm:px-8 sm:pt-24 lg:min-h-[calc(100svh-61px)] lg:grid-cols-[1.05fr_0.95fr] lg:px-14">
        <div>
          <Reveal className="flex items-center gap-3">
            <GlowMark size={26} glowSize={54} />
            <span className="font-mono text-[11px] uppercase tracking-[0.24em] text-white/55">
              The Restaurant, In Motion
            </span>
          </Reveal>

          <Reveal index={1}>
            <p className="mt-10 font-mono text-[11px] uppercase tracking-[0.24em] text-[#c9838d]">
              Built for independent restaurants
            </p>
            <h1
              className="mt-4 font-heading text-[13vw] font-semibold leading-[0.95] tracking-tight text-[#f6f0e2] sm:text-7xl lg:text-[3.8rem] xl:text-[4.35rem]"
              style={{ textWrap: "balance" }}
            >
              Your restaurant.
              <br />
              <span className="italic text-[#f6f0e2]/80">Running on your terms.</span>
            </h1>
          </Reveal>

          <Reveal index={2}>
            <p className="mt-7 max-w-lg text-lg leading-relaxed text-white/70">
              Your own ordering storefront, the kitchen and counter behind it, and the customers who
              come back — run from one system, with no commission taken from a single direct order.
            </p>
            <div className="mt-9 flex flex-wrap items-center gap-3">
              <Link to="/start-trial">
                <Button size="lg">Start your restaurant</Button>
              </Link>
              <a
                href="#demo"
                className="inline-flex h-12 items-center rounded-pill border border-white/30 px-6 text-sm font-medium text-white transition-colors hover:bg-white/10"
              >
                Explore the demo
              </a>
            </div>
            <ul className="mt-6 flex list-none flex-wrap gap-x-6 gap-y-2 p-0 text-sm text-white/55">
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

          <div className="mt-10 lg:hidden">
            <SystemStrip />
          </div>
        </div>

        <Reveal index={3} variant="fade" className="hidden lg:block">
          <SystemRing />
        </Reveal>
      </div>

      {/* What is GarnishTable — answered on the first screen-and-a-half, in plain words. */}
      <div className="relative border-t border-white/10 px-5 py-16 sm:px-8 lg:px-14">
        <div className="mx-auto grid max-w-7xl gap-10 lg:grid-cols-[0.8fr_2.2fr] lg:gap-16">
          <Reveal>
            <ChapterMark n="01" label="What GarnishTable is" dark />
          </Reveal>
          <div>
            <Reveal>
              <p
                className="max-w-3xl font-heading text-2xl leading-snug text-[#f6f0e2] sm:text-3xl"
                style={{ textWrap: "balance" }}
              >
                A restaurant operating platform. It brings ordering, day-to-day operations, customer
                relationships, growth tools and integrations into one system that belongs to the
                restaurant.
              </p>
            </Reveal>
            <ul className="mt-10 grid list-none grid-cols-2 gap-x-8 gap-y-6 p-0 lg:grid-cols-4">
              {WHAT_IT_RUNS.map((item, i) => (
                <Reveal as="li" key={item.label} index={i}>
                  <a href={item.href} className="group block border-t border-white/15 pt-4">
                    <span className="font-heading text-lg text-[#f6f0e2] transition-colors group-hover:text-[#e3aab2]">
                      {item.label} <span aria-hidden>→</span>
                    </span>
                    <span className="mt-1 block text-sm text-white/50">{item.copy}</span>
                  </a>
                </Reveal>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}
