import { Button, cn } from "@restaurant/ui";
import type { HeroProps } from "../types";
import { usePreviewMode } from "../PreviewContext";

/** Editorial — a full-bleed, viewport-edge-to-edge immersive banner (breaks out of the shared page
 *  container via `.full-bleed`, not a plain negative margin — see index.css's doc comment: MenuPage's
 *  `max-w-5xl mx-auto` wrapper means canceling only <main>'s own padding stops short of the real
 *  viewport at wider widths) with large centered serif display type over the image, unlike Classic's
 *  bordered/rounded card or Modern's split composition. */
export function EditorialHero({ restaurant, availability, orderingOpen, directionsQuery, hasCategories, onStartOrder }: HeroProps) {
  const preview = usePreviewMode();
  return (
    <section
      className={cn(
        "relative flex min-h-[52svh] flex-col items-center justify-center overflow-hidden px-6 py-16 text-center sm:min-h-[60svh]",
        preview ? "-mx-4 sm:-mx-6" : "full-bleed"
      )}
      style={
        restaurant?.coverImage
          ? {
              backgroundImage: `linear-gradient(rgba(28,25,23,0.38), rgba(28,25,23,0.62)), url(${restaurant.coverImage})`,
              backgroundSize: "cover",
              backgroundPosition: "center",
            }
          : { background: "var(--color-secondary)" }
      }
    >
      <p
        className={`animate-fade-up text-xs uppercase tracking-[0.3em] ${restaurant?.coverImage ? "text-white/80" : "text-secondary-foreground/70"}`}
      >
        {orderingOpen ? "Open for orders" : availability?.status === "paused" ? availability.reason || "Temporarily paused" : "Closed right now"}
      </p>
      <h1
        className={`animate-fade-up mt-3 max-w-3xl font-heading text-5xl italic leading-[1.05] sm:text-7xl ${restaurant?.coverImage ? "text-white" : "text-secondary-foreground"}`}
        style={{ animationDelay: "60ms" }}
      >
        {restaurant?.name}
      </h1>
      {restaurant?.description && (
        <p
          className={`animate-fade-up mt-4 max-w-lg text-sm sm:text-base ${restaurant?.coverImage ? "text-white/85" : "text-secondary-foreground/80"}`}
          style={{ animationDelay: "120ms" }}
        >
          {restaurant.description}
        </p>
      )}
      <div className="animate-fade-up mt-6 flex flex-wrap items-center justify-center gap-4 text-xs uppercase tracking-widest" style={{ animationDelay: "160ms" }}>
        <span className={restaurant?.coverImage ? "text-white/75" : "text-secondary-foreground/70"}>
          {[restaurant?.settings.pickupEnabled && "Pickup", restaurant?.settings.deliveryEnabled && "Delivery"].filter(Boolean).join(" · ")}
        </span>
        {directionsQuery && (
          <a
            href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(directionsQuery)}`}
            target="_blank"
            rel="noreferrer"
            className={`underline-offset-4 hover:underline ${restaurant?.coverImage ? "text-white/90" : "text-secondary-foreground"}`}
          >
            Directions ↗
          </a>
        )}
      </div>
      {orderingOpen && hasCategories && (
        <Button
          variant="secondary"
          size="sm"
          className="animate-fade-up mt-7 rounded-none border border-current bg-transparent px-6 uppercase tracking-widest text-white hover:bg-white/10"
          style={{ animationDelay: "200ms" }}
          onClick={onStartOrder}
        >
          View the menu
        </Button>
      )}
    </section>
  );
}
