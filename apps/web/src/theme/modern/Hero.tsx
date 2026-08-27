import { Button } from "@restaurant/ui";
import { formatCurrency } from "@restaurant/utils";
import type { HeroProps } from "../types";

/** Modern — an asymmetric split: bold display headline + status/CTA on the left, a large offset
 *  photo (or a solid color block with a giant initial) on the right, framed by an accent-colored
 *  panel behind it. Structurally unlike Classic's single full-bleed banner card. */
export function ModernHero({ restaurant, availability, orderingOpen, directionsQuery, hasCategories, onStartOrder }: HeroProps) {
  return (
    <section className="grid grid-cols-1 gap-6 lg:grid-cols-[1.1fr_1fr] lg:items-center lg:gap-10">
      <div className="flex flex-col gap-5">
        <span
          className={`inline-flex w-fit items-center gap-1.5 border-2 px-2.5 py-1 text-[11px] font-bold uppercase tracking-widest ${
            orderingOpen ? "border-success text-success" : "border-warning text-warning"
          }`}
        >
          <span className={`h-1.5 w-1.5 ${orderingOpen ? "bg-success" : "bg-warning"}`} aria-hidden />
          {orderingOpen ? "Open now" : availability?.status === "paused" ? availability.reason || "Paused" : "Closed"}
        </span>

        <h1 className="text-4xl font-black uppercase leading-[0.95] tracking-tight text-foreground sm:text-6xl">{restaurant?.name}</h1>

        {restaurant?.description && <p className="max-w-md text-base text-muted">{restaurant.description}</p>}

        <div className="flex flex-wrap items-center gap-4 text-xs font-semibold uppercase tracking-wide text-foreground/70">
          {restaurant?.settings.pickupEnabled && <span>Pickup</span>}
          {restaurant?.settings.deliveryEnabled && <span>Delivery</span>}
          {!!restaurant?.settings.minOrderAmount && <span>{formatCurrency(restaurant.settings.minOrderAmount, restaurant.settings.currency)} min</span>}
          {directionsQuery && (
            <a
              href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(directionsQuery)}`}
              target="_blank"
              rel="noreferrer"
              className="underline-offset-4 hover:underline"
            >
              Directions ↗
            </a>
          )}
        </div>

        {orderingOpen && hasCategories && (
          <Button size="lg" className="w-fit rounded-none px-8" onClick={onStartOrder}>
            Order now
          </Button>
        )}
      </div>

      <div className="relative aspect-[4/3] w-full lg:aspect-square">
        <div className="absolute -bottom-3 -right-3 h-full w-full bg-primary" aria-hidden />
        {restaurant?.coverImage ? (
          <img src={restaurant.coverImage} alt="" className="relative h-full w-full border-2 border-foreground object-cover" loading="lazy" />
        ) : (
          <div className="relative flex h-full w-full items-center justify-center border-2 border-foreground bg-secondary">
            <span className="font-black text-8xl text-secondary-foreground/90">{restaurant?.name?.[0]?.toUpperCase() ?? "R"}</span>
          </div>
        )}
      </div>
    </section>
  );
}
