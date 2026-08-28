import { Reveal } from "@restaurant/ui";
import { formatCurrency } from "@restaurant/utils";
import type { HeroProps } from "../types";
import { ArrowRightIcon } from "../icons";

/** Minimal — no full-bleed photograph, no centered hero + CTA. When a cover image exists, an
 *  asymmetric spread: text left (7/12), a small precisely-cropped portrait-ratio image right
 *  (5/12), both sitting quietly inside the page's own `max-w-5xl` column — there is nothing to
 *  break out of, unlike Cinematic's viewport-height bleed. Typography stays small and confident
 *  (the h1 tops out at `text-5xl`, `font-normal` — not a bold display size) and availability is a
 *  plain sentence with no color/dot signal, per the brief. Without a cover image the text column
 *  simply narrows to a `max-w-xl` title page — still left-aligned, never centered. */
export function MinimalHero({ restaurant, availability, orderingOpen, directionsQuery, hasCategories, onStartOrder }: HeroProps) {
  const statusLine = orderingOpen
    ? "Open for orders"
    : availability?.status === "paused"
      ? availability.reason || "Temporarily paused"
      : "Closed right now";

  const metaBits = [restaurant?.settings.pickupEnabled && "Pickup", restaurant?.settings.deliveryEnabled && "Delivery"]
    .filter(Boolean)
    .join(" · ");

  const textColumn = (
    <div className="flex flex-col gap-6">
      <Reveal variant="fade" className="text-[13px] tracking-[0.04em] text-muted">
        {statusLine}
      </Reveal>

      <Reveal as="h1" index={1} variant="fade" className="max-w-xl text-4xl font-normal leading-[1.08] tracking-tight text-foreground sm:text-5xl">
        {restaurant?.name}
      </Reveal>

      {restaurant?.description && (
        <Reveal variant="fade" index={2} className="max-w-md text-[15px] leading-relaxed text-muted">
          {restaurant.description}
        </Reveal>
      )}

      <Reveal variant="fade" index={3} className="flex flex-wrap items-center gap-x-6 gap-y-2 text-[13px] text-muted">
        {metaBits && <span>{metaBits}</span>}
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
            Directions
          </a>
        )}
      </Reveal>

      {orderingOpen && hasCategories && (
        <Reveal variant="fade" index={4}>
          <button
            onClick={onStartOrder}
            className="group inline-flex items-center gap-2 border-b border-foreground pb-0.5 text-[13px] tracking-[0.04em] text-foreground"
          >
            View the menu
            <ArrowRightIcon className="h-3 w-3 transition-transform duration-normal group-hover:translate-x-1" />
          </button>
        </Reveal>
      )}
    </div>
  );

  if (!restaurant?.coverImage) {
    return (
      <section className="py-16 sm:py-24">
        <div className="max-w-xl">{textColumn}</div>
      </section>
    );
  }

  return (
    <section className="grid grid-cols-1 gap-10 py-12 sm:py-16 lg:grid-cols-12 lg:items-center lg:gap-16">
      <div className="lg:col-span-7">{textColumn}</div>
      <Reveal variant="fade" index={2} className="lg:col-span-5">
        <div className="aspect-[4/5] max-w-sm overflow-hidden bg-secondary lg:max-w-none">
          <img src={restaurant.coverImage} alt="" className="h-full w-full object-cover" />
        </div>
      </Reveal>
    </section>
  );
}
