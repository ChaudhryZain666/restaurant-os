import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { Reveal } from "@restaurant/ui";
import { Container } from "./Container";
import { ButtonLink } from "./ButtonLink";

/**
 * The closing moment shared by every marketing page except Home — the homepage's Departure scene
 * without the photograph: a large centered Playfair line on ink, a wine glow rising from below,
 * the same CTA pair, and the platform's two plain facts set as a mono line rather than badges.
 * `title`/`description` are per-page.
 */
export function MarketingClosingCta({
  title,
  description,
}: {
  title: ReactNode;
  description: ReactNode;
}) {
  return (
    <section
      className="theme-obsidian relative isolate overflow-hidden py-24 sm:py-32"
      style={{ background: "#0f0c0d" }}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background: "radial-gradient(60% 80% at 50% 115%, rgba(97,27,40,0.55), transparent 70%)",
        }}
      />
      <Container>
        <Reveal className="relative mx-auto flex max-w-3xl flex-col items-center text-center">
          <p className="font-mono text-[11px] uppercase tracking-[0.3em] text-[#e3aab2]">
            Your restaurant. Running on your terms.
          </p>
          <h2
            className="mt-6 font-heading text-4xl font-semibold leading-[1.02] tracking-tight text-[#f6f0e2] sm:text-6xl"
            style={{ textWrap: "balance" }}
          >
            {title}
          </h2>
          <p className="mt-5 max-w-xl text-lg leading-relaxed text-white/60">{description}</p>
          <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
            <ButtonLink to="/start-trial" size="lg">
              Start your restaurant
            </ButtonLink>
            <Link
              to="/demo"
              className="inline-flex h-12 items-center rounded-pill border border-white/30 px-6 text-sm font-medium text-white transition-colors hover:bg-white/10"
            >
              Explore the demo
            </Link>
          </div>
          <p className="mt-9 font-mono text-[10px] uppercase tracking-[0.26em] text-white/40">
            0% platform commission on direct orders · 14-day trial, no card required
          </p>
        </Reveal>
      </Container>
    </section>
  );
}
