import { Reveal } from "@restaurant/ui";
import { formatCurrency } from "@restaurant/utils";
import type { HeroProps } from "../types";
import { ArrowRightIcon } from "../icons";

/** Luxury — an asymmetric editorial two-column composition, never a centered hero-card. A
 *  restrained serif text block (kicker, name, one quiet line of description, availability stated
 *  as plain text, a text/underline CTA — no filled button, no badges) sits in its own column
 *  beside a large photograph; on mobile the two stack with the photograph leading and the text
 *  block's generous spacing preserved rather than compressed. */
export function LuxuryHero({ restaurant, availability, orderingOpen, directionsQuery, hasCategories, onStartOrder }: HeroProps) {
  const locality = [restaurant?.city, restaurant?.state].filter(Boolean).join(", ");

  return (
    <section className="grid grid-cols-1 gap-10 py-8 sm:grid-cols-2 sm:items-stretch sm:gap-0 sm:py-0">
      {/* DOM order puts the image first so it naturally leads on mobile (a plain stack, no
         reordering needed); on desktop `sm:order-2` moves it to the right-hand column so the text
         block reads first, left, as the editorial "lede." */}
      <div className="order-1 aspect-[4/5] w-full overflow-hidden bg-secondary sm:order-2 sm:aspect-auto sm:min-h-[560px]">
        {restaurant?.coverImage ? (
          <img src={restaurant.coverImage} alt="" className="h-full w-full object-cover" loading="eager" />
        ) : (
          <div className="h-full w-full bg-gradient-to-br from-secondary to-secondary/70" />
        )}
      </div>

      <div className="order-2 flex flex-col justify-center gap-7 px-1 py-4 sm:order-1 sm:px-12 sm:py-16 lg:px-16">
        {locality && (
          <Reveal variant="fade" className="text-xs font-medium uppercase tracking-[0.32em] text-muted">
            {locality}
          </Reveal>
        )}

        <Reveal as="h1" className="max-w-md font-heading text-4xl font-normal leading-[1.08] text-foreground sm:text-5xl lg:text-6xl">
          {restaurant?.name}
        </Reveal>

        {restaurant?.description && (
          <Reveal variant="fade" index={1} className="max-w-sm text-[15px] leading-relaxed text-muted">
            {restaurant.description}
          </Reveal>
        )}

        <Reveal variant="fade" index={2} className="flex items-center gap-2.5 text-xs font-medium uppercase tracking-[0.18em] text-muted">
          <span className={`h-1.5 w-1.5 rounded-full ${orderingOpen ? "bg-success" : "bg-warning"}`} aria-hidden />
          {orderingOpen ? "Open for orders" : availability?.status === "paused" ? availability.reason || "Temporarily paused" : "Closed right now"}
        </Reveal>

        <Reveal variant="fade" index={3} className="flex flex-col gap-3 pt-2">
          {orderingOpen && hasCategories && (
            <button
              onClick={onStartOrder}
              className="group flex w-fit items-center gap-2 border-b border-foreground pb-1 text-sm font-medium tracking-[0.02em] text-foreground transition-opacity duration-fast hover:opacity-70"
            >
              View the menu
              <ArrowRightIcon className="h-3.5 w-3.5 transition-transform duration-normal group-hover:translate-x-1" />
            </button>
          )}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted">
            {!!restaurant?.settings.minOrderAmount && (
              <span>{formatCurrency(restaurant.settings.minOrderAmount, restaurant.settings.currency)} minimum</span>
            )}
            {directionsQuery && (
              <a
                href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(directionsQuery)}`}
                target="_blank"
                rel="noreferrer"
                className="underline-offset-4 hover:text-foreground hover:underline"
              >
                Get directions ↗
              </a>
            )}
          </div>
        </Reveal>
      </div>
    </section>
  );
}
