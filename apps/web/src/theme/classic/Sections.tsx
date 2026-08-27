import { Button, Reveal } from "@restaurant/ui";
import { formatCurrency } from "@restaurant/utils";
import type { AboutProps, CtaProps, FeaturedProps, GalleryProps } from "../types";
import { PlateIcon } from "../icons";

/** Classic — the same warm card language as the menu grid, applied to the optional sections. */
export function ClassicFeatured({ restaurant, items, currency }: FeaturedProps) {
  if (items.length === 0) return null;
  return (
    <section aria-label="Featured items" className="flex flex-col gap-3">
      <h2 className="text-xl font-semibold text-foreground">Popular picks</h2>
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {items.map((item) => (
          <li key={item.id} className="flex flex-col gap-1.5 rounded-xl border border-border bg-surface p-2.5 shadow-sm">
            {item.imageUrl ? (
              <img src={item.imageUrl} alt="" loading="lazy" className="aspect-square w-full rounded-lg object-cover" />
            ) : (
              <div className="flex aspect-square w-full items-center justify-center rounded-lg bg-gradient-to-br from-primary/10 to-accent/10 text-primary/40">
                <PlateIcon className="h-8 w-8" />
              </div>
            )}
            <strong className="line-clamp-1 text-sm font-semibold text-foreground">{item.name}</strong>
            <span className="text-xs font-medium text-primary">{formatCurrency(item.price, currency ?? restaurant?.settings.currency)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function ClassicAbout({ restaurant }: AboutProps) {
  if (!restaurant?.description) return null;
  return (
    <section aria-label="About" className="rounded-2xl border border-border bg-surface p-6 shadow-sm sm:p-8">
      <h2 className="mb-2 font-heading text-xl font-semibold text-foreground">Our story</h2>
      <p className="max-w-2xl text-sm text-muted sm:text-base">{restaurant.description}</p>
    </section>
  );
}

export function ClassicGallery({ restaurant }: GalleryProps) {
  const images = [restaurant?.coverImage, restaurant?.logo].filter((src): src is string => Boolean(src));
  if (images.length === 0) return null;
  return (
    <section aria-label="Gallery" className="grid grid-cols-2 gap-3">
      {images.map((src, i) => (
        <Reveal key={src} index={i} className="aspect-[4/3] overflow-hidden rounded-xl border border-border">
          <img src={src} alt="" loading="lazy" className="h-full w-full object-cover" />
        </Reveal>
      ))}
    </section>
  );
}

export function ClassicCta({ hasCategories, orderingOpen, onStartOrder }: CtaProps) {
  if (!hasCategories || !orderingOpen) return null;
  return (
    <section className="flex flex-col items-center gap-3 rounded-2xl bg-gradient-to-br from-secondary to-secondary/80 px-6 py-10 text-center">
      <h2 className="font-heading text-2xl font-semibold text-secondary-foreground">Ready when you are</h2>
      <p className="text-sm text-secondary-foreground/80">Pick up where you left off and get your order in.</p>
      <Button size="sm" onClick={onStartOrder}>
        Start your order
      </Button>
    </section>
  );
}
