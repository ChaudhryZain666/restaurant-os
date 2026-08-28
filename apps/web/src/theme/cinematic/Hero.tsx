import { Reveal } from "@restaurant/ui";
import { formatCurrency } from "@restaurant/utils";
import type { HeroProps } from "../types";
import { useActiveTheme } from "../useActiveTheme";
import { ArrowRightIcon } from "../icons";

/** Cinematic — viewport-height, full-bleed photography with typography sitting directly on the
 *  image (no card behind it, no centered box). Pulls itself up over Layout's own <main> padding so
 *  nothing separates the viewport edge from the photograph but the transparent header strip above
 *  it. Large display type sits low-left (an editorial/film-poster placement, not centered), a
 *  minimal outlined CTA (not a filled pill), a scroll cue at the base. */
export function CinematicHero({ restaurant, availability, orderingOpen, directionsQuery, hasCategories, onStartOrder }: HeroProps) {
  const { tokens } = useActiveTheme();
  const overlay = tokens.overlayOpacity ?? 0.55;

  return (
    // The header is `sticky` (in-flow, so it reserves normal clearance on every other page — see
    // CinematicHeader's doc comment for why it isn't `fixed`), but at the TOP of the page it's just
    // a transparent bar sitting in normal flow above this section. Pulling this section up by BOTH
    // <main>'s own padding AND the header's rendered height (~76px) makes the image visually extend
    // behind the header's sticky box — the header stays visually on top (its own z-40 stacking
    // context beats DOM order), giving the "type sits directly on a full-bleed image, nav floats
    // transparently over it" look without requiring Layout.tsx (shared by every theme) to change.
    <section className="relative -mx-4 -mt-[calc(1.5rem+76px)] flex min-h-[88vh] flex-col justify-end overflow-hidden bg-secondary sm:-mx-6 sm:-mt-[calc(2rem+76px)] sm:min-h-[92vh]">
      {restaurant?.coverImage && (
        <img src={restaurant.coverImage} alt="" className="absolute inset-0 h-full w-full object-cover" />
      )}
      <div className="absolute inset-0 bg-gradient-to-t from-black via-black/30 to-black/10" style={{ opacity: overlay + 0.15 }} />
      <div className="absolute inset-0 bg-gradient-to-b from-black/50 via-transparent to-transparent" style={{ opacity: overlay }} />

      <div className="relative flex flex-col gap-6 px-6 pb-16 pt-40 sm:px-14 sm:pb-24 sm:pt-56">
        <Reveal variant="fade" className="flex items-center gap-3 text-white/70">
          <span className={`h-1.5 w-1.5 rounded-full ${orderingOpen ? "bg-success" : "bg-warning"}`} aria-hidden />
          <span className="text-xs font-medium uppercase tracking-[0.3em]">
            {orderingOpen ? "Open for orders" : availability?.status === "paused" ? availability.reason || "Temporarily paused" : "Closed right now"}
          </span>
        </Reveal>

        <Reveal as="h1" className="max-w-4xl font-heading text-5xl font-semibold leading-[0.95] text-white sm:text-7xl lg:text-8xl">
          {restaurant?.name}
        </Reveal>

        {restaurant?.description && (
          <Reveal variant="fade" index={1} className="max-w-lg text-sm leading-relaxed text-white/75 sm:text-base">
            {restaurant.description}
          </Reveal>
        )}

        <Reveal variant="fade" index={2} className="flex flex-wrap items-center gap-6 pt-2">
          {orderingOpen && hasCategories && (
            <button
              onClick={onStartOrder}
              className="group flex items-center gap-2.5 border border-white/70 px-6 py-3 text-xs font-semibold uppercase tracking-[0.22em] text-white transition-colors duration-normal hover:bg-white hover:text-secondary"
            >
              Reserve the menu
              <ArrowRightIcon className="h-3.5 w-3.5 transition-transform duration-normal group-hover:translate-x-1" />
            </button>
          )}
          {!!restaurant?.settings.minOrderAmount && (
            <span className="text-xs font-medium uppercase tracking-[0.18em] text-white/50">
              {formatCurrency(restaurant.settings.minOrderAmount, restaurant.settings.currency)} minimum
            </span>
          )}
          {directionsQuery && (
            <a
              href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(directionsQuery)}`}
              target="_blank"
              rel="noreferrer"
              className="text-xs font-medium uppercase tracking-[0.18em] text-white/60 underline-offset-4 hover:text-white hover:underline"
            >
              Get directions ↗
            </a>
          )}
        </Reveal>
      </div>

      <div className="relative flex justify-center pb-6 text-white/40" aria-hidden>
        <span className="h-8 w-px animate-pulse bg-white/40" />
      </div>
    </section>
  );
}
