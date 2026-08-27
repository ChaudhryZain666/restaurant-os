import { Button } from "@restaurant/ui";
import { formatCurrency } from "@restaurant/utils";
import type { AboutProps, CtaProps, FeaturedProps, GalleryProps } from "../types";

/** Modern — a horizontal-scroll snap strip (not a grid) for featured items, a full-bleed dark CTA
 *  band, a bold two-column about block. */
export function ModernFeatured({ items, currency, restaurant }: FeaturedProps) {
  if (items.length === 0) return null;
  return (
    <section aria-label="Featured items" className="flex flex-col gap-3">
      <h2 className="text-sm font-black uppercase tracking-[0.16em] text-foreground">Popular right now</h2>
      <ul className="flex snap-x gap-0.5 overflow-x-auto pb-1">
        {items.map((item) => (
          <li key={item.id} className="relative aspect-square w-40 shrink-0 snap-start overflow-hidden bg-border sm:w-52">
            {item.imageUrl ? (
              <img src={item.imageUrl} alt="" loading="lazy" className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full w-full items-center justify-center bg-accent/20 text-foreground/70">
                <span className="text-2xl font-black">{item.name[0]?.toUpperCase()}</span>
              </div>
            )}
            <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 to-transparent px-2 py-2">
              <p className="truncate text-xs font-bold text-white">{item.name}</p>
              <p className="text-xs font-black text-white">{formatCurrency(item.price, currency ?? restaurant?.settings.currency)}</p>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function ModernAbout({ restaurant }: AboutProps) {
  if (!restaurant?.description) return null;
  return (
    <section className="grid grid-cols-1 gap-4 border-y-2 border-foreground py-8 sm:grid-cols-[auto_1fr] sm:gap-10">
      <h2 className="text-3xl font-black uppercase leading-none tracking-tight text-foreground">Our story</h2>
      <p className="max-w-xl text-base text-muted">{restaurant.description}</p>
    </section>
  );
}

export function ModernGallery({ restaurant }: GalleryProps) {
  const images = [restaurant?.coverImage, restaurant?.logo].filter((src): src is string => Boolean(src));
  if (images.length === 0) return null;
  return (
    <section aria-label="Gallery" className="grid grid-cols-3 gap-0.5">
      {images.map((src) => (
        <div key={src} className="aspect-square overflow-hidden bg-border">
          <img src={src} alt="" loading="lazy" className="h-full w-full object-cover" />
        </div>
      ))}
    </section>
  );
}

export function ModernCta({ hasCategories, orderingOpen, onStartOrder }: CtaProps) {
  if (!hasCategories || !orderingOpen) return null;
  return (
    <section className="flex flex-col items-center gap-4 bg-foreground px-6 py-14 text-center">
      <h2 className="text-3xl font-black uppercase tracking-tight text-background sm:text-4xl">Hungry yet?</h2>
      <Button size="lg" className="rounded-none px-8" onClick={onStartOrder}>
        Order now
      </Button>
    </section>
  );
}
