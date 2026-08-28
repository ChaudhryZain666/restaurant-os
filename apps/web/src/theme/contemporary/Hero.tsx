import { Reveal } from "@restaurant/ui";
import { formatCurrency } from "@restaurant/utils";
import type { HeroProps } from "../types";
import { ArrowRightIcon } from "../icons";

/** Contemporary — a genuinely split viewport: a 60%-wide text column whose content is deliberately
 *  NOT stacked as one centered block (the eyebrow status sits at the TOP of the column while the
 *  oversized left-aligned headline is pinned to the BOTTOM, an intentional off-grid stagger), beside
 *  a 40%-wide full-bleed photograph. Asymmetric 3:2, not a plain 50/50 split. The header stays solid
 *  (see Header.tsx), so this section only needs to cancel <main>'s own horizontal padding
 *  (`-mx-4 sm:-mx-6`, from Layout.tsx) to reach the viewport edge — no vertical pull-up hack needed. */
export function ContemporaryHero({ restaurant, availability, orderingOpen, directionsQuery, hasCategories, onStartOrder }: HeroProps) {
  return (
    <section className="-mx-4 grid grid-cols-1 sm:-mx-6 lg:grid-cols-[3fr_2fr]">
      <div className="flex min-h-[56vh] flex-col justify-between gap-10 bg-background px-6 py-10 sm:px-10 sm:py-14 lg:min-h-[82vh] lg:py-16">
        <Reveal variant="fade" className="flex items-center gap-3">
          <span className={`h-2 w-2 shrink-0 ${orderingOpen ? "bg-success" : "bg-warning"}`} aria-hidden />
          <span className="text-xs font-bold uppercase tracking-[0.28em] text-foreground/60">
            {orderingOpen ? "Open for orders" : availability?.status === "paused" ? availability.reason || "Temporarily paused" : "Closed right now"}
          </span>
        </Reveal>

        <div className="flex flex-col gap-6">
          <Reveal
            as="h1"
            variant="scale"
            className="font-heading text-5xl font-black uppercase leading-[0.85] tracking-tight text-foreground sm:text-7xl lg:text-8xl"
          >
            {restaurant?.name}
          </Reveal>

          {restaurant?.description && (
            <Reveal variant="fade" index={1} className="max-w-md text-sm leading-relaxed text-muted sm:text-base">
              {restaurant.description}
            </Reveal>
          )}

          <Reveal variant="fade" index={2} className="flex flex-wrap items-center gap-6 pt-2">
            {orderingOpen && hasCategories && (
              <button
                onClick={onStartOrder}
                className="group flex items-center gap-2.5 bg-primary px-7 py-3.5 text-xs font-bold uppercase tracking-[0.2em] text-primary-foreground transition-transform duration-normal hover:-translate-y-0.5"
              >
                Start an order
                <ArrowRightIcon className="h-3.5 w-3.5 transition-transform duration-normal group-hover:translate-x-1" />
              </button>
            )}
            {directionsQuery && (
              <a
                href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(directionsQuery)}`}
                target="_blank"
                rel="noreferrer"
                className="text-xs font-bold uppercase tracking-[0.18em] text-foreground/60 underline-offset-4 hover:text-foreground hover:underline"
              >
                Get directions ↗
              </a>
            )}
          </Reveal>
        </div>
      </div>

      <div className="relative min-h-[38vh] overflow-hidden bg-secondary lg:min-h-[82vh]">
        {restaurant?.coverImage ? (
          <img src={restaurant.coverImage} alt="" className="absolute inset-0 h-full w-full object-cover" />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-secondary-foreground/20">
            <span className="font-heading text-[8rem] font-black leading-none">{restaurant?.name?.[0]?.toUpperCase() ?? "R"}</span>
          </div>
        )}

        {!!restaurant?.settings.minOrderAmount && (
          <Reveal
            variant="scale"
            index={3}
            className="absolute bottom-6 left-4 z-10 max-w-[12rem] border-2 border-foreground bg-surface p-5 sm:bottom-10 sm:left-8"
          >
            <span className="block text-[10px] font-bold uppercase tracking-[0.2em] text-muted">Minimum order</span>
            <span className="mt-1 block font-heading text-2xl font-black text-foreground">
              {formatCurrency(restaurant.settings.minOrderAmount, restaurant.settings.currency)}
            </span>
          </Reveal>
        )}
      </div>
    </section>
  );
}
