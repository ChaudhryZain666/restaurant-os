import { cn } from "@restaurant/ui";
import { formatCurrency } from "@restaurant/utils";
import type { AboutProps, CtaProps, FeaturedProps, GalleryProps } from "../types";
import { usePreviewMode } from "../PreviewContext";

/** Editorial — a single large "editor's pick" spotlight rather than a grid/strip, a centered
 *  pull-quote for About, one full-width image band for Gallery, and a quiet text-link CTA. */
export function EditorialFeatured({ items, currency, restaurant }: FeaturedProps) {
  const pick = items[0];
  if (!pick) return null;
  return (
    <section aria-label="Featured items" className="grid grid-cols-1 items-center gap-6 sm:grid-cols-2 sm:gap-10">
      <div className="aspect-[4/3] overflow-hidden rounded-sm bg-border">
        {pick.imageUrl ? (
          <img src={pick.imageUrl} alt="" loading="lazy" className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-muted">
            <span className="font-heading text-4xl italic">{pick.name[0]?.toUpperCase()}</span>
          </div>
        )}
      </div>
      <div className="flex flex-col gap-2">
        <p className="text-xs uppercase tracking-[0.2em] text-muted">Editor's pick</p>
        <h2 className="font-heading text-3xl italic text-foreground">{pick.name}</h2>
        {pick.description && <p className="text-sm text-muted">{pick.description}</p>}
        <p className="mt-1 font-heading text-lg text-foreground">{formatCurrency(pick.price, currency ?? restaurant?.settings.currency)}</p>
      </div>
    </section>
  );
}

export function EditorialAbout({ restaurant }: AboutProps) {
  if (!restaurant?.description) return null;
  return (
    <section className="mx-auto max-w-2xl py-6 text-center">
      <p className="font-heading text-2xl italic leading-relaxed text-foreground">"{restaurant.description}"</p>
    </section>
  );
}

export function EditorialGallery({ restaurant }: GalleryProps) {
  const preview = usePreviewMode();
  const image = restaurant?.coverImage ?? restaurant?.logo;
  if (!image) return null;
  return (
    <section aria-label="Gallery" className={cn(preview ? "-mx-4 sm:-mx-6" : "full-bleed")}>
      <img src={image} alt="" loading="lazy" className="h-64 w-full object-cover sm:h-80" />
    </section>
  );
}

export function EditorialCta({ hasCategories, orderingOpen, onStartOrder }: CtaProps) {
  if (!hasCategories || !orderingOpen) return null;
  return (
    <section className="flex flex-col items-center gap-2 border-y border-border py-10 text-center">
      <p className="font-heading text-xl italic text-foreground">Ready to order?</p>
      <button onClick={onStartOrder} className="text-xs uppercase tracking-[0.2em] text-primary underline-offset-4 hover:underline">
        View the menu
      </button>
    </section>
  );
}
