import { Reveal } from "@restaurant/ui";
import { formatCurrency } from "@restaurant/utils";
import type { AboutProps, CtaProps, FeaturedProps, GalleryProps } from "../types";
import { ArrowRightIcon, PlateIcon } from "../icons";

/** Cinematic — one large hero-scale dish, mask-revealed on scroll, not a strip of three cards. The
 *  dish IS the section; text sits beside/over it, never in a separate card below an image. */
export function CinematicFeatured({ restaurant, items, currency }: FeaturedProps) {
  const pick = items[0];
  if (!pick) return null;
  return (
    <section aria-label="Featured items" className="grid grid-cols-1 gap-0 sm:grid-cols-2">
      <Reveal variant="mask" className="aspect-[4/3] overflow-hidden bg-secondary sm:aspect-auto sm:min-h-[420px]">
        {pick.imageUrl ? (
          <img src={pick.imageUrl} alt="" loading="lazy" className="cinematic-grade h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-secondary-foreground/20">
            <PlateIcon className="h-16 w-16" />
          </div>
        )}
      </Reveal>
      <div className="flex flex-col justify-center gap-4 bg-secondary px-8 py-14 text-secondary-foreground sm:px-14">
        <span className="text-xs font-semibold uppercase tracking-[0.28em] text-secondary-foreground/50">Signature dish</span>
        <h2 className="font-heading text-4xl font-semibold leading-tight text-secondary-foreground sm:text-5xl">{pick.name}</h2>
        {pick.description && <p className="max-w-sm text-sm leading-relaxed text-secondary-foreground/70">{pick.description}</p>}
        <span className="font-heading text-2xl">{formatCurrency(pick.price, currency ?? restaurant?.settings.currency)}</span>
      </div>
    </section>
  );
}

/** Cinematic — a large pull-quote treatment of the restaurant's own description, not a boxed "About
 *  Us" card. */
export function CinematicAbout({ restaurant }: AboutProps) {
  if (!restaurant?.description) return null;
  return (
    <section className="mx-auto max-w-3xl px-2 py-20 text-center sm:py-28">
      <p className="font-heading text-3xl font-light italic leading-snug text-foreground sm:text-4xl">"{restaurant.description}"</p>
      <p className="mt-6 text-xs font-semibold uppercase tracking-[0.28em] text-muted">{restaurant.name}</p>
    </section>
  );
}

/** Cinematic — an asymmetric two-image composition (cover leading, larger; logo trailing, smaller)
 *  when both exist, a single full-bleed band when only one does. Never a symmetric grid. */
export function CinematicGallery({ restaurant }: GalleryProps) {
  const primary = restaurant?.coverImage;
  const secondary = restaurant?.logo;
  if (!primary && !secondary) return null;
  if (primary && secondary) {
    return (
      <section aria-label="Gallery" className="-mx-4 grid grid-cols-1 gap-1 sm:-mx-6 sm:grid-cols-[2fr_1fr]">
        <Reveal variant="mask" className="aspect-[16/10] overflow-hidden bg-secondary">
          <img src={primary} alt="" loading="lazy" className="cinematic-grade h-full w-full object-cover" />
        </Reveal>
        <Reveal variant="mask" index={1} className="aspect-[16/10] overflow-hidden bg-secondary sm:aspect-auto">
          <img src={secondary} alt="" loading="lazy" className="cinematic-grade h-full w-full object-cover" />
        </Reveal>
      </section>
    );
  }
  return (
    <Reveal variant="mask" as="section" aria-label="Gallery" className="-mx-4 aspect-[21/9] overflow-hidden bg-secondary sm:-mx-6">
      <img src={primary ?? secondary} alt="" loading="lazy" className="cinematic-grade h-full w-full object-cover" />
    </Reveal>
  );
}

/** Cinematic — the closing statement is its own full-bleed dark section, not a card, matching the
 *  hero's visual register so the page feels bookended. */
export function CinematicCta({ restaurant, hasCategories, orderingOpen, onStartOrder }: CtaProps) {
  if (!hasCategories || !orderingOpen) return null;
  return (
    <section className="-mx-4 flex flex-col items-center gap-5 bg-secondary px-6 py-20 text-center sm:-mx-6 sm:py-28">
      <h2 className="max-w-lg font-heading text-3xl font-semibold leading-tight text-secondary-foreground sm:text-5xl">
        {restaurant?.name ? `${restaurant.name} is ready when you are.` : "Ready when you are."}
      </h2>
      <button
        onClick={onStartOrder}
        className="group flex items-center gap-2.5 border border-secondary-foreground/60 px-7 py-3.5 text-xs font-semibold uppercase tracking-[0.22em] text-secondary-foreground transition-colors duration-normal hover:bg-secondary-foreground hover:text-secondary"
      >
        View the menu
        <ArrowRightIcon className="h-3.5 w-3.5 transition-transform duration-normal group-hover:translate-x-1" />
      </button>
    </section>
  );
}
