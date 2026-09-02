import { Reveal, cn } from "@restaurant/ui";
import { formatCurrency } from "@restaurant/utils";
import type { AboutProps, CtaProps, FeaturedProps, GalleryProps } from "../types";
import { usePreviewMode } from "../PreviewContext";
import { ArrowRightIcon, PlateIcon } from "../icons";

// See index.css's .full-bleed doc comment — escapes MenuPage's max-w-5xl wrapper to the real
// viewport, but must fall back to a plain margin-cancel inside the Theme Studio playground's own
// bounded device-frame, or it would blow straight past the frame into the surrounding page.
function fullBleedClass(preview: boolean) {
  return preview ? "-mx-4 sm:-mx-6" : "full-bleed";
}

/** Urban — a tight grid strip (not Modern's horizontal scroll, not Cinematic's single oversized
 *  mask-reveal dish): up to three items on a full-bleed near-black band, each with a huge faint
 *  index number behind the image and a solid color chip (never a gradient scrim) carrying
 *  name+price flush to the bottom edge. */
export function UrbanFeatured({ restaurant, items, currency }: FeaturedProps) {
  const preview = usePreviewMode();
  const picks = items.slice(0, 3);
  if (picks.length === 0) return null;
  return (
    <section
      aria-label="Featured items"
      className={cn(fullBleedClass(preview), "flex flex-col gap-6 bg-foreground px-6 py-14 sm:px-14 sm:py-20")}
    >
      <div className="flex items-center gap-3">
        <span className="h-6 w-2.5 shrink-0 bg-primary" aria-hidden />
        <h2 className="font-heading text-2xl font-black uppercase tracking-tight text-background sm:text-3xl">Crowd favorites</h2>
      </div>
      <ul className="grid grid-cols-1 gap-0.5 sm:grid-cols-3">
        {picks.map((item, i) => (
          <Reveal as="li" index={i} key={item.id} className="group relative aspect-square overflow-hidden bg-secondary">
            <span
              aria-hidden
              className="pointer-events-none absolute left-2 top-1 select-none font-heading text-7xl font-black leading-none text-background/10"
            >
              {String(i + 1).padStart(2, "0")}
            </span>
            {item.imageUrl ? (
              <img
                src={item.imageUrl}
                alt=""
                loading="lazy"
                className="h-full w-full object-cover transition-transform duration-slow ease-premium group-hover:scale-[1.06]"
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-background/20">
                <PlateIcon className="h-12 w-12" />
              </div>
            )}
            <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-2 bg-primary px-3 py-2.5">
              <span className="truncate text-sm font-black uppercase tracking-tight text-primary-foreground">{item.name}</span>
              <span className="shrink-0 text-sm font-black text-primary-foreground">{formatCurrency(item.price, currency ?? restaurant?.settings.currency)}</span>
            </div>
          </Reveal>
        ))}
      </ul>
    </section>
  );
}

/** Urban — a bold color-block statement of the restaurant's real description, left-aligned (never
 *  centered/italicized like a magazine pull-quote): a vertical primary rule anchors a large,
 *  uppercase, high-contrast paragraph on a dark full-bleed band. */
export function UrbanAbout({ restaurant }: AboutProps) {
  const preview = usePreviewMode();
  if (!restaurant?.description) return null;
  return (
    <section className={cn(fullBleedClass(preview), "flex bg-secondary px-6 py-16 sm:px-14 sm:py-24")}>
      <div className="mx-auto flex max-w-4xl gap-6 sm:gap-10">
        <span className="w-2 shrink-0 bg-primary" aria-hidden />
        <div className="flex flex-col gap-4">
          <span className="text-xs font-black uppercase tracking-[0.2em] text-primary">The story</span>
          <p className="font-heading text-2xl font-black uppercase leading-snug tracking-tight text-secondary-foreground sm:text-4xl">
            {restaurant.description}
          </p>
        </div>
      </div>
    </section>
  );
}

/** Urban — a layered overlap, not a symmetric grid: one large crop with a second image offset over
 *  its corner, hard-bordered like a cutout pinned on top rather than tiled beside it. Falls back to
 *  a single sharp-cropped band (angled corner cut) when only one image exists. */
export function UrbanGallery({ restaurant }: GalleryProps) {
  const preview = usePreviewMode();
  const primary = restaurant?.coverImage;
  const secondary = restaurant?.logo;
  if (!primary && !secondary) return null;

  if (primary && secondary) {
    return (
      <section
        aria-label="Gallery"
        className={cn(fullBleedClass(preview), "relative aspect-[16/9] overflow-hidden bg-secondary sm:aspect-[21/9]")}
      >
        <Reveal variant="scale" className="h-full w-full">
          <img src={primary} alt="" loading="lazy" className="h-full w-full object-cover" />
        </Reveal>
        <Reveal
          variant="scale"
          index={1}
          className="absolute bottom-4 left-4 h-28 w-28 overflow-hidden border-4 border-background sm:bottom-8 sm:left-8 sm:h-44 sm:w-44"
        >
          <img src={secondary} alt="" loading="lazy" className="h-full w-full object-cover" />
        </Reveal>
        <span className="absolute right-4 top-4 bg-primary px-2.5 py-1 text-[10px] font-black uppercase tracking-widest text-primary-foreground sm:right-8 sm:top-8">
          {restaurant?.name}
        </span>
      </section>
    );
  }

  return (
    <Reveal
      variant="scale"
      as="section"
      aria-label="Gallery"
      className={cn(fullBleedClass(preview), "aspect-[21/9] overflow-hidden bg-secondary")}
      style={{ clipPath: "polygon(0 0, 100% 0, 100% 88%, 88% 100%, 0 100%)" }}
    >
      <img src={primary ?? secondary} alt="" loading="lazy" className="h-full w-full object-cover" />
    </Reveal>
  );
}

/** Urban — the closing statement is a bright solid primary block (not dark, unlike Cinematic's and
 *  Modern's CTAs), the theme's most energetic single moment: huge dark-on-bright type and a
 *  hand-rolled inverted block button. */
export function UrbanCta({ restaurant, hasCategories, orderingOpen, onStartOrder }: CtaProps) {
  const preview = usePreviewMode();
  if (!hasCategories || !orderingOpen) return null;
  return (
    <section className={cn(fullBleedClass(preview), "flex flex-col items-start gap-6 bg-primary px-6 py-16 sm:px-14 sm:py-24")}>
      <h2 className="max-w-xl font-heading text-3xl font-black uppercase leading-[0.95] tracking-tight text-primary-foreground sm:text-5xl">
        {restaurant?.name ? `${restaurant.name} is firing up your order.` : "Let's get your order going."}
      </h2>
      <button
        onClick={onStartOrder}
        className="group flex items-center gap-2.5 bg-secondary px-7 py-3.5 text-xs font-black uppercase tracking-[0.16em] text-secondary-foreground transition-transform duration-fast hover:-translate-y-0.5"
      >
        View the menu
        <ArrowRightIcon className="h-3.5 w-3.5 transition-transform duration-fast group-hover:translate-x-1" />
      </button>
    </section>
  );
}
