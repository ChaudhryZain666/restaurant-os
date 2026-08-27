import { Button } from "@restaurant/ui";
import { formatCurrency } from "@restaurant/utils";
import type { HeroProps } from "../types";

/** Classic — a single rounded banner card: cover image (or a warm gradient fallback) behind the
 *  restaurant's identity, availability badges, and a "Start your order" CTA. */
export function ClassicHero({ restaurant, availability, orderingOpen, directionsQuery, hasCategories, onStartOrder }: HeroProps) {
  return (
    <section
      className="relative overflow-hidden rounded-2xl border border-border shadow-md"
      style={
        restaurant?.coverImage
          ? {
              backgroundImage: `linear-gradient(0deg, rgba(28,25,23,0.72), rgba(28,25,23,0.35)), url(${restaurant.coverImage})`,
              backgroundSize: "cover",
              backgroundPosition: "center",
            }
          : undefined
      }
    >
      <div className={restaurant?.coverImage ? "px-6 py-10 sm:px-10 sm:py-14" : "bg-gradient-to-br from-secondary to-secondary/80 px-6 py-10 sm:px-10 sm:py-14"}>
        <div className="flex items-center gap-3">
          {restaurant?.logo && (
            <img
              src={restaurant.logo}
              alt=""
              className={`h-12 w-12 shrink-0 rounded-full object-cover ring-2 ${restaurant?.coverImage ? "ring-white/70" : "ring-secondary-foreground/20"}`}
            />
          )}
          <h1 className={`animate-fade-up font-heading text-3xl font-semibold sm:text-4xl ${restaurant?.coverImage ? "text-white" : "text-secondary-foreground"}`}>
            {restaurant?.name}
          </h1>
        </div>
        {restaurant?.description && (
          <p
            className={`mt-2 max-w-xl animate-fade-up text-sm sm:text-base ${restaurant?.coverImage ? "text-white/85" : "text-secondary-foreground/80"}`}
            style={{ animationDelay: "60ms" }}
          >
            {restaurant.description}
          </p>
        )}
        <div className="mt-4 flex flex-wrap items-center gap-2 animate-fade-up" style={{ animationDelay: "120ms" }}>
          <span
            className={`inline-flex items-center gap-1.5 rounded-pill px-3 py-1 text-xs font-semibold ${
              orderingOpen ? "bg-success/15 text-success" : "bg-warning/15 text-warning"
            } ${restaurant?.coverImage ? "backdrop-blur" : ""}`}
          >
            <span className={`h-1.5 w-1.5 rounded-full ${orderingOpen ? "bg-success" : "bg-warning"}`} aria-hidden />
            {orderingOpen ? "Open for orders" : availability?.status === "paused" ? availability.reason || "Temporarily paused" : "Closed right now"}
          </span>
          {restaurant?.settings.pickupEnabled && (
            <span className={`rounded-pill px-3 py-1 text-xs font-medium ${restaurant?.coverImage ? "bg-white/15 text-white backdrop-blur" : "bg-black/[0.06] text-foreground"}`}>
              Pickup available
            </span>
          )}
          {restaurant?.settings.deliveryEnabled && (
            <span className={`rounded-pill px-3 py-1 text-xs font-medium ${restaurant?.coverImage ? "bg-white/15 text-white backdrop-blur" : "bg-black/[0.06] text-foreground"}`}>
              Delivery available
            </span>
          )}
          {!!restaurant?.settings.minOrderAmount && (
            <span className={`rounded-pill px-3 py-1 text-xs font-medium ${restaurant?.coverImage ? "bg-white/15 text-white backdrop-blur" : "bg-black/[0.06] text-foreground"}`}>
              {formatCurrency(restaurant.settings.minOrderAmount, restaurant.settings.currency)} minimum order
            </span>
          )}
          {directionsQuery && (
            <a
              href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(directionsQuery)}`}
              target="_blank"
              rel="noreferrer"
              className={`rounded-pill px-3 py-1 text-xs font-medium underline-offset-2 hover:underline ${restaurant?.coverImage ? "bg-white/15 text-white backdrop-blur" : "bg-black/[0.06] text-foreground"}`}
            >
              Get directions ↗
            </a>
          )}
        </div>
        {orderingOpen && hasCategories && (
          <Button size="sm" className="mt-5 animate-fade-up" style={{ animationDelay: "160ms" }} onClick={onStartOrder}>
            Start your order
          </Button>
        )}
      </div>
    </section>
  );
}
