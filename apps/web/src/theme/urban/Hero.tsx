import { Reveal } from "@restaurant/ui";
import { formatCurrency } from "@restaurant/utils";
import type { HeroProps } from "../types";
import { ArrowRightIcon } from "../icons";

/** Urban — a grounded, asymmetric two-block composition (never centered, never a viewport-height
 *  photo like Cinematic, never Modern's simple offset-square split): a dark full-bleed panel on
 *  the left carries a huge condensed headline anchored to its own thick color rule, and a layered
 *  image collage on the right — a solid accent block behind, the photo itself cut sharp and offset
 *  in front of it, with real-data corner tags (pickup/delivery/min-order) floating over the seam
 *  between photo and color block. Nothing centered, nothing rounded, nothing soft. */
export function UrbanHero({ restaurant, availability, orderingOpen, directionsQuery, hasCategories, onStartOrder }: HeroProps) {
  const statusLabel = orderingOpen
    ? "Open now"
    : availability?.status === "paused"
      ? availability.reason || "Paused"
      : "Closed";

  return (
    <section className="-mx-4 -mt-6 grid grid-cols-1 bg-secondary sm:-mx-6 sm:-mt-8 lg:grid-cols-[1.15fr_1fr]">
      <div className="flex min-w-0 flex-col justify-end gap-6 px-6 py-12 sm:px-14 sm:py-16 lg:py-20">
        <Reveal variant="fade" className="flex w-fit items-center gap-2 bg-primary px-3 py-1.5 text-[11px] font-black uppercase tracking-[0.16em] text-primary-foreground">
          <span className={`h-1.5 w-1.5 shrink-0 ${orderingOpen ? "bg-success" : "bg-warning"}`} aria-hidden />
          {statusLabel}
        </Reveal>

        <div className="flex flex-col gap-3">
          <Reveal
            as="h1"
            className="max-w-2xl break-words font-heading text-5xl font-black uppercase leading-[0.9] tracking-tight text-secondary-foreground sm:text-6xl lg:text-7xl"
          >
            {restaurant?.name}
          </Reveal>
          <span className="h-2 w-24 bg-primary" aria-hidden />
        </div>

        {restaurant?.description && (
          <Reveal variant="fade" index={1} className="max-w-md text-sm leading-relaxed text-secondary-foreground/70 sm:text-base">
            {restaurant.description}
          </Reveal>
        )}

        <Reveal variant="fade" index={2} className="flex flex-wrap items-center gap-5 pt-1">
          {orderingOpen && hasCategories && (
            <button
              onClick={onStartOrder}
              className="group flex items-center gap-2.5 bg-primary px-7 py-3.5 text-xs font-black uppercase tracking-[0.16em] text-primary-foreground transition-transform duration-fast hover:-translate-y-0.5"
            >
              Start your order
              <ArrowRightIcon className="h-3.5 w-3.5 transition-transform duration-fast group-hover:translate-x-1" />
            </button>
          )}
          {directionsQuery && (
            <a
              href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(directionsQuery)}`}
              target="_blank"
              rel="noreferrer"
              className="text-xs font-black uppercase tracking-[0.14em] text-secondary-foreground/60 underline-offset-4 hover:text-secondary-foreground hover:underline"
            >
              Get directions ↗
            </a>
          )}
        </Reveal>
      </div>

      <div className="relative min-h-[280px] sm:min-h-[380px] lg:min-h-0">
        <div className="absolute inset-6 bg-primary sm:inset-10" aria-hidden />
        <Reveal variant="scale" className="absolute inset-0 h-full w-full overflow-hidden">
          {restaurant?.coverImage ? (
            <img src={restaurant.coverImage} alt="" className="h-full w-full border-4 border-secondary object-cover" loading="lazy" />
          ) : (
            <div className="flex h-full w-full items-center justify-center border-4 border-secondary bg-secondary">
              <span className="font-heading text-9xl font-black text-secondary-foreground/15">{restaurant?.name?.[0]?.toUpperCase() ?? "R"}</span>
            </div>
          )}
        </Reveal>

        {(restaurant?.settings.pickupEnabled || restaurant?.settings.deliveryEnabled || !!restaurant?.settings.minOrderAmount) && (
          <div className="absolute bottom-4 left-4 flex flex-wrap gap-1.5 sm:bottom-6 sm:left-6">
            {restaurant?.settings.pickupEnabled && (
              <span className="bg-secondary px-2.5 py-1 text-[10px] font-black uppercase tracking-widest text-secondary-foreground">Pickup</span>
            )}
            {restaurant?.settings.deliveryEnabled && (
              <span className="bg-secondary px-2.5 py-1 text-[10px] font-black uppercase tracking-widest text-secondary-foreground">Delivery</span>
            )}
            {!!restaurant?.settings.minOrderAmount && (
              <span className="bg-secondary px-2.5 py-1 text-[10px] font-black uppercase tracking-widest text-secondary-foreground">
                {formatCurrency(restaurant.settings.minOrderAmount, restaurant.settings.currency)} min
              </span>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
