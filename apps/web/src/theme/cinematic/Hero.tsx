import { Reveal } from "@restaurant/ui";
import { formatCurrency } from "@restaurant/utils";
import type { HeroProps } from "../types";
import { useActiveTheme } from "../useActiveTheme";
import { usePreviewMode } from "../PreviewContext";
import { ArrowRightIcon } from "../icons";

/** Cinematic — viewport-height, full-bleed photography with typography sitting directly on the
 *  image (no card behind it, no centered box). Pulls itself up over Layout's own <main> padding so
 *  nothing separates the viewport edge from the photograph but the transparent header strip above
 *  it. Large display type sits low-left (an editorial/film-poster placement, not centered), a
 *  minimal outlined CTA (not a filled pill), a scroll cue at the base. */
export function CinematicHero({ restaurant, availability, orderingOpen, directionsQuery, hasCategories, onStartOrder }: HeroProps) {
  const { tokens } = useActiveTheme();
  const overlay = tokens.overlayOpacity ?? 0.55;
  // The Theme Studio playground renders this exact component inside a frame capped at
  // `max-h-[80vh]` (see PlaygroundPanel.tsx) — but `vh` units on a descendant resolve against the
  // real browser viewport, not that ancestor's max-height, so the full 88-92vh hero would exceed
  // the frame before any content is visible. 70vh leaves real headroom under the 80vh cap.
  const preview = usePreviewMode();

  return (
    // The header is `sticky` (in-flow, so it reserves normal clearance on every other page — see
    // CinematicHeader's doc comment for why it isn't `fixed`), but at the TOP of the page it's just
    // a transparent bar sitting in normal flow above this section. Pulling this section up by BOTH
    // <main>'s own padding AND the header's rendered height (~76px) makes the image visually extend
    // behind the header's sticky box — the header stays visually on top (its own z-40 stacking
    // context beats DOM order), giving the "type sits directly on a full-bleed image, nav floats
    // transparently over it" look without requiring Layout.tsx (shared by every theme) to change.
    <section
      className={`relative -mt-[calc(1.5rem+76px)] flex flex-col justify-end overflow-hidden bg-secondary sm:-mt-[calc(2rem+76px)] ${
        // .full-bleed escapes to the real browser viewport via 100vw — correct on the live
        // storefront, but inside the Theme Studio playground's own bounded device-frame it would
        // blow straight past the frame into the surrounding page. The playground frame's own width
        // IS the hero's available width there, so plain edge-to-edge-of-parent margins are what's
        // actually correct in preview mode.
        preview ? "-mx-4 sm:-mx-6" : "full-bleed"
      } ${preview ? "min-h-[70vh]" : "min-h-[88vh] sm:min-h-[92vh]"}`}
    >
      {restaurant?.coverImage && (
        <img src={restaurant.coverImage} alt="" className="cinematic-grade absolute inset-0 h-full w-full object-cover" />
      )}
      <div className="absolute inset-0 bg-gradient-to-t from-secondary via-secondary/30 to-secondary/10" style={{ opacity: overlay + 0.15 }} />
      <div className="absolute inset-0 bg-gradient-to-b from-secondary/50 via-transparent to-transparent" style={{ opacity: overlay }} />

      <div className="relative flex flex-col gap-7 px-6 pb-20 pt-40 sm:px-16 sm:pb-32 sm:pt-56">
        <Reveal variant="fade" className="flex items-center gap-3 text-secondary-foreground/70">
          <span className={`h-1.5 w-1.5 rounded-full ${orderingOpen ? "bg-success" : "bg-warning"}`} aria-hidden />
          <span className="text-xs font-medium uppercase tracking-[0.3em]">
            {orderingOpen ? "Open for orders" : availability?.status === "paused" ? availability.reason || "Temporarily paused" : "Closed right now"}
          </span>
        </Reveal>

        <Reveal
          as="h1"
          className="max-w-4xl font-heading text-5xl font-semibold leading-[0.9] tracking-tight text-secondary-foreground sm:text-7xl lg:text-8xl"
        >
          {restaurant?.name}
        </Reveal>

        {/* Stage 2B — a thin editorial rule (the flagship's restrained-typography signature),
            colored with the theme's own accent token rather than a hardcoded color. */}
        <span className="h-px w-14 bg-accent/70" aria-hidden />

        {restaurant?.description && (
          <Reveal variant="fade" index={1} className="max-w-lg text-sm leading-relaxed text-secondary-foreground/75 sm:text-base">
            {restaurant.description}
          </Reveal>
        )}

        <Reveal variant="fade" index={2} className="flex flex-wrap items-center gap-6 pt-2">
          {orderingOpen && hasCategories && (
            <button
              onClick={onStartOrder}
              className="group flex items-center gap-2.5 border border-secondary-foreground/70 px-6 py-3 text-xs font-semibold uppercase tracking-[0.22em] text-secondary-foreground transition-colors duration-normal hover:bg-secondary-foreground hover:text-secondary"
            >
              Reserve the menu
              <ArrowRightIcon className="h-3.5 w-3.5 transition-transform duration-normal group-hover:translate-x-1" />
            </button>
          )}
          {!!restaurant?.settings.minOrderAmount && (
            <span className="text-xs font-medium uppercase tracking-[0.18em] text-secondary-foreground/50">
              {formatCurrency(restaurant.settings.minOrderAmount, restaurant.settings.currency)} minimum
            </span>
          )}
          {directionsQuery && (
            <a
              href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(directionsQuery)}`}
              target="_blank"
              rel="noreferrer"
              className="text-xs font-medium uppercase tracking-[0.18em] text-secondary-foreground/60 underline-offset-4 hover:text-secondary-foreground hover:underline"
            >
              Get directions ↗
            </a>
          )}
        </Reveal>
      </div>

      <div className="relative flex justify-center pb-6 text-secondary-foreground/40" aria-hidden>
        <span className="h-8 w-px animate-pulse bg-secondary-foreground/40" />
      </div>
    </section>
  );
}
