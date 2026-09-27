import { useRef } from "react";
import { Link } from "react-router-dom";
import { Button, Reveal } from "@restaurant/ui";
import { HeroBackdrop } from "./HeroBackdrop";
import { HeroScene } from "./HeroScene";
import { ActDivider } from "./ActDivider";
import { GlowMark } from "./GlowMark";
import { FilmGrain } from "./FilmGrain";

/**
 * The cinematic build's "Arrival" — reuses HomePage.tsx's Hero exactly (same HeroBackdrop/
 * HeroFieldScene/CameraRig environment layer, same protected HeroScene live iframe + kitchen-ticket
 * object, same headline/body/CTA/trust-row copy and links) beneath a new opening beat: the mark,
 * lit by the shared `GlowMark` treatment, with the brand's cinematic tagline beneath it, separated
 * from the pitch below by a hairline rule. Stays at rest once revealed — a scroll-tied dim/shrink
 * effect was tried here and reverted, the static glow was preferred. A barely-there film-grain
 * layer sits over the whole section per the brief's own "subtle grain / atmosphere where
 * appropriate."
 */
export function CinematicHero() {
  const heroSectionRef = useRef<HTMLElement>(null);

  return (
    <section ref={heroSectionRef} className="relative isolate -mt-[61px] overflow-hidden bg-background pt-[61px]">
      <ActDivider roman="I" title="Arrival" />
      <HeroBackdrop sectionRef={heroSectionRef} />
      <FilmGrain />

      <div className="pointer-events-none absolute inset-0 hidden lg:block" aria-hidden>
        <div className="absolute right-[6%] top-32 h-40 w-64 rounded-sm border border-dashed border-white/10" />
        <span className="absolute right-[6%] top-28 font-mono text-[9px] uppercase tracking-[0.16em] text-white/25">
          Sec. A — Dining
        </span>
      </div>

      <div className="relative flex min-h-[100svh] flex-col px-5 pb-10 pt-24 sm:px-8 sm:pt-28 lg:px-14">
        {/* Kept deliberately compact — this sits ABOVE the existing headline/body/CTA/HeroScene
            block, all still their original size, so this addition must not meaningfully grow the
            Hero's total height. An earlier, larger version pushed the whole Hero tall enough that
            on shorter viewports the protected HeroScene composition landed awkwardly at the fold.
            This is a beat, not a second hero. */}
        <Reveal variant="scale" className="mb-8 flex flex-col items-center gap-3 text-center sm:mb-10">
          <GlowMark />
          <span className="font-heading text-lg italic tracking-tight text-white sm:text-xl">
            The Restaurant, In Motion.
          </span>
          <span className="h-px w-12" style={{ background: "rgba(245,239,230,0.25)" }} />
        </Reveal>

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
            className="mb-16 flex flex-wrap items-center gap-x-8 gap-y-2 font-mono text-[11px] uppercase tracking-[0.1em] text-white/45"
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
  );
}
