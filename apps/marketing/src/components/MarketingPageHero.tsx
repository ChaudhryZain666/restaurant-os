import type { ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { Button, Reveal } from "@restaurant/ui";
import { Container } from "./Container";

/**
 * The opening shared by every marketing page except Home — the same visual world as the
 * homepage's film-still opener, at a secondary page's weight: ink ground with a low wine glow,
 * left-aligned editorial type (rose mono eyebrow, large Playfair title, quiet body), and the same
 * "Start your restaurant" / "Explore the demo" pair. Pulled up under the transparent nav
 * (`-mt-[61px]` + matching padding; the route is listed in Nav's DARK_HERO_ROUTES).
 *
 * `.theme-obsidian` scopes the dark palette to this section only, so the shared Button picks up
 * its rose-on-ink treatment exactly as it does on the homepage. Titles may include an `<em>` for
 * the homepage's italic accent.
 */
export function MarketingPageHero({
  eyebrow,
  title,
  description,
  hideCta = false,
}: {
  eyebrow: string;
  title: ReactNode;
  description: ReactNode;
  hideCta?: boolean;
}) {
  const { pathname } = useLocation();
  return (
    <section
      className="theme-obsidian relative isolate -mt-[61px] overflow-hidden pt-[61px]"
      style={{ background: "#0f0c0d" }}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(55% 75% at 88% 20%, rgba(97,27,40,0.42), transparent 70%), radial-gradient(40% 50% at 0% 100%, rgba(97,27,40,0.18), transparent 70%)",
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-white/10"
      />
      <Container className="relative py-20 sm:py-28 lg:py-32">
        <Reveal className="max-w-4xl">
          <p className="font-mono text-[11px] uppercase tracking-[0.3em] text-[#e3aab2]">
            {eyebrow}
          </p>
          <h1
            className="mt-6 font-heading text-[2.6rem] font-semibold leading-[1] tracking-[-0.02em] text-[#f6f0e2] sm:text-6xl lg:text-[4.8rem] [&_em]:text-[#f6f0e2]/85"
            style={{ textWrap: "balance" }}
          >
            {title}
          </h1>
          <p className="mt-6 max-w-2xl text-lg leading-relaxed text-white/65 sm:text-xl">
            {description}
          </p>
          {!hideCta && (
            <div className="mt-9 flex flex-wrap items-center gap-3">
              <Link to="/start-trial">
                <Button size="lg">Start your restaurant</Button>
              </Link>
              {pathname !== "/demo" && (
                <Link
                  to="/demo"
                  className="inline-flex h-12 items-center rounded-pill border border-white/30 px-6 text-sm font-medium text-white transition-colors hover:bg-white/10"
                >
                  Explore the demo
                </Link>
              )}
            </div>
          )}
        </Reveal>
      </Container>
    </section>
  );
}
