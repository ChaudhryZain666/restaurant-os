import { Reveal, cn } from "@restaurant/ui";
import { formatCurrency } from "@restaurant/utils";
import type { AboutProps, CtaProps, FeaturedProps, GalleryProps } from "../types";
import { usePreviewMode } from "../PreviewContext";
import { ArrowRightIcon, PlateIcon } from "../icons";

// See Hero.tsx's identical note — .full-bleed escapes to the real viewport, which is only correct
// on the live storefront; inside the Theme Studio playground's bounded device-frame, the frame's
// own width is what "full width" should mean, so these full-bleed sections fall back to the
// original margin-cancel-only behavior there.
function fullBleedClass(preview: boolean) {
  return preview ? "-mx-4 sm:-mx-6" : "full-bleed";
}

/** Cinematic — one large hero-scale dish, mask-revealed on scroll, not a strip of three cards. The
 *  dish IS the section; text sits beside/over it, never in a separate card below an image. The
 *  image now gets the same slow hover-zoom as a menu row (via `group`) and the text block reveals
 *  a beat after the image mask finishes, instead of appearing instantly alongside it. */
export function CinematicFeatured({ restaurant, items, currency }: FeaturedProps) {
  const pick = items[0];
  if (!pick) return null;
  return (
    <section aria-label="Featured items" className="group grid grid-cols-1 gap-0 sm:grid-cols-2">
      <Reveal variant="mask" className="aspect-[4/3] overflow-hidden bg-secondary sm:aspect-auto sm:min-h-[420px]">
        {pick.imageUrl ? (
          <img
            src={pick.imageUrl}
            alt=""
            loading="lazy"
            className="cinematic-grade h-full w-full object-cover transition-transform duration-slow ease-premium group-hover:scale-[1.04]"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-secondary-foreground/20">
            <PlateIcon className="h-16 w-16" />
          </div>
        )}
      </Reveal>
      <Reveal
        variant="fade"
        index={1}
        className="flex flex-col justify-center gap-4 bg-secondary px-8 py-14 text-secondary-foreground sm:px-14"
      >
        <span className="text-xs font-semibold uppercase tracking-[0.28em] text-secondary-foreground/50">Signature dish</span>
        <span className="h-px w-14 bg-accent/70 transition-[width] duration-slow ease-premium group-hover:w-24" aria-hidden />
        <h2 className="font-heading text-4xl font-semibold leading-tight tracking-tight text-secondary-foreground sm:text-5xl">{pick.name}</h2>
        {pick.description && <p className="max-w-sm text-sm leading-relaxed text-secondary-foreground/70">{pick.description}</p>}
        <span className="font-heading text-2xl">{formatCurrency(pick.price, currency ?? restaurant?.settings.currency)}</span>
      </Reveal>
    </section>
  );
}

/** Cinematic — a large pull-quote treatment of the restaurant's own description, not a boxed "About
 *  Us" card. Now reveals in on scroll, same as every other section, rather than appearing instantly
 *  (the one section that had no entrance motion at all before). */
export function CinematicAbout({ restaurant }: AboutProps) {
  if (!restaurant?.description) return null;
  return (
    <Reveal variant="fade" as="section" className="mx-auto max-w-3xl px-2 py-20 text-center sm:py-28">
      <p className="font-heading text-3xl font-light italic leading-snug text-foreground sm:text-4xl">"{restaurant.description}"</p>
      <p className="mt-6 text-xs font-semibold uppercase tracking-[0.28em] text-muted">{restaurant.name}</p>
    </Reveal>
  );
}

/** Cinematic — an asymmetric two-image composition (cover leading, larger; logo trailing, smaller)
 *  when both exist, a single full-bleed band when only one does. Never a symmetric grid. Each image
 *  now gets the same restrained hover-zoom as a menu row and Featured's dish, for one consistent
 *  "photography responds to you" language across the whole theme. */
export function CinematicGallery({ restaurant }: GalleryProps) {
  const preview = usePreviewMode();
  const primary = restaurant?.coverImage;
  const secondary = restaurant?.logo;
  if (!primary && !secondary) return null;
  const zoomImg = "cinematic-grade h-full w-full object-cover transition-transform duration-slow ease-premium hover:scale-[1.04]";
  if (primary && secondary) {
    return (
      <section aria-label="Gallery" className={cn(fullBleedClass(preview), "grid grid-cols-1 gap-1 sm:grid-cols-[2fr_1fr]")}>
        <Reveal variant="mask" className="aspect-[16/10] overflow-hidden bg-secondary">
          <img src={primary} alt="" loading="lazy" className={zoomImg} />
        </Reveal>
        <Reveal variant="mask" index={1} className="aspect-[16/10] overflow-hidden bg-secondary sm:aspect-auto">
          <img src={secondary} alt="" loading="lazy" className={zoomImg} />
        </Reveal>
      </section>
    );
  }
  return (
    <Reveal variant="mask" as="section" aria-label="Gallery" className={cn(fullBleedClass(preview), "aspect-[21/9] overflow-hidden bg-secondary")}>
      <img src={primary ?? secondary} alt="" loading="lazy" className={zoomImg} />
    </Reveal>
  );
}

/** Cinematic — the closing statement is its own full-bleed dark section, not a card, matching the
 *  hero's visual register so the page feels bookended. Now reveals as one group (rule, heading,
 *  button) rather than appearing instantly — the same fade-up entrance every other section uses. */
export function CinematicCta({ restaurant, hasCategories, orderingOpen, onStartOrder }: CtaProps) {
  const preview = usePreviewMode();
  if (!hasCategories || !orderingOpen) return null;
  return (
    <Reveal
      as="section"
      className={cn(fullBleedClass(preview), "flex flex-col items-center gap-5 bg-secondary px-6 py-24 text-center sm:py-32")}
    >
      <span className="h-px w-14 bg-accent/70" aria-hidden />
      <h2 className="max-w-lg font-heading text-3xl font-semibold leading-tight tracking-tight text-secondary-foreground sm:text-5xl">
        {restaurant?.name ? `${restaurant.name} is ready when you are.` : "Ready when you are."}
      </h2>
      <button
        onClick={onStartOrder}
        className="group flex items-center gap-2.5 border border-secondary-foreground/60 px-7 py-3.5 text-xs font-semibold uppercase tracking-[0.22em] text-secondary-foreground transition-colors duration-normal hover:bg-secondary-foreground hover:text-secondary"
      >
        View the menu
        <ArrowRightIcon className="h-3.5 w-3.5 transition-transform duration-normal group-hover:translate-x-1" />
      </button>
    </Reveal>
  );
}
