import { formatCurrency } from "@restaurant/utils";
import type { AboutProps, CtaProps, FeaturedProps, GalleryProps } from "../types";
import { ArrowRightIcon } from "../icons";

/** Minimal — Featured stays in the menu's own register rather than becoming a second, louder
 *  moment: one quiet row (eyebrow, name, the same dotted price leader MenuSection uses, an optional
 *  description line beneath) — no image, no spotlight, no strip of cards. */
export function MinimalFeatured({ items, currency, restaurant }: FeaturedProps) {
  const pick = items[0];
  if (!pick) return null;
  return (
    <section aria-label="Featured items" className="border-y border-border py-8">
      <div className="flex items-end gap-4">
        <span className="shrink-0 text-[12px] tracking-[0.06em] text-muted">Featured</span>
        <span className="text-[15px] text-foreground">{pick.name}</span>
        <span aria-hidden className="mb-1.5 flex-1 border-b border-dotted border-border" />
        <span className="shrink-0 text-[14px] tabular-nums text-foreground">{formatCurrency(pick.price, currency ?? restaurant?.settings.currency)}</span>
      </div>
      {pick.description && <p className="mt-3 max-w-md text-[13px] leading-relaxed text-muted">{pick.description}</p>}
    </section>
  );
}

/** Minimal — the restaurant's real description set as a single careful paragraph directly on the
 *  page background: a measured max-width for reading comfort, generous line-height, no quote
 *  marks, no box, no background color. Left-aligned like everything else in this theme, never a
 *  centered pull-quote (Cinematic/Editorial's register). */
export function MinimalAbout({ restaurant }: AboutProps) {
  if (!restaurant?.description) return null;
  return (
    <section className="max-w-2xl py-4">
      <p className="text-[12px] tracking-[0.06em] text-muted">About</p>
      <p className="mt-4 text-[15px] leading-[1.9] text-foreground sm:text-base">{restaurant.description}</p>
    </section>
  );
}

/** Minimal — one small, precisely-cropped image, contained within the page's own column (never
 *  full-bleed like Editorial's edge-to-edge band, never a grid like Cinematic's asymmetric pair).
 *  Skips entirely when there's nothing real to show, rather than falling back to a placeholder. */
export function MinimalGallery({ restaurant }: GalleryProps) {
  const image = restaurant?.coverImage ?? restaurant?.logo;
  if (!image) return null;
  return (
    <section aria-label="Gallery" className="py-4">
      <div className="aspect-[3/2] max-w-sm overflow-hidden bg-secondary">
        <img src={image} alt="" loading="lazy" className="h-full w-full object-cover" />
      </div>
    </section>
  );
}

/** Minimal — a single quiet line and one underline affordance, left-aligned, no card or color
 *  block. The closing statement matches the Hero's register, not a dramatic bookend. */
export function MinimalCta({ restaurant, hasCategories, orderingOpen, onStartOrder }: CtaProps) {
  if (!hasCategories || !orderingOpen) return null;
  return (
    <section className="flex flex-col items-start gap-4 border-t border-border py-14">
      <h2 className="max-w-lg text-lg font-normal leading-snug text-foreground sm:text-xl">
        {restaurant?.name ? `${restaurant.name} is ready when you are.` : "Ready when you are."}
      </h2>
      <button
        onClick={onStartOrder}
        className="group inline-flex items-center gap-2 border-b border-foreground pb-0.5 text-[13px] tracking-[0.04em] text-foreground"
      >
        View the menu
        <ArrowRightIcon className="h-3 w-3 transition-transform duration-normal group-hover:translate-x-1" />
      </button>
    </section>
  );
}
