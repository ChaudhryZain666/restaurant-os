import { Reveal } from "@restaurant/ui";
import { formatCurrency } from "@restaurant/utils";
import type { AboutProps, CtaProps, FeaturedProps, GalleryProps } from "../types";
import { ArrowRightIcon, PlateIcon } from "../icons";

/** Luxury — one large image with generous whitespace around it and a caption-style treatment
 *  beneath (name/description left, price right, a hairline above) — never a grid of equal cards. */
export function LuxuryFeatured({ restaurant, items, currency }: FeaturedProps) {
  const pick = items[0];
  if (!pick) return null;
  return (
    <section aria-label="Featured item" className="mx-auto flex max-w-3xl flex-col gap-6 py-6 sm:py-14">
      <span className="text-xs font-medium uppercase tracking-[0.28em] text-muted">Featured</span>
      <Reveal variant="fade" className="aspect-[3/2] w-full overflow-hidden bg-secondary">
        {pick.imageUrl ? (
          <img src={pick.imageUrl} alt="" loading="lazy" className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-secondary-foreground/20">
            <PlateIcon className="h-12 w-12" />
          </div>
        )}
      </Reveal>
      <div className="flex items-start justify-between gap-6 border-t border-border pt-5">
        <div className="flex flex-col gap-1.5">
          <h2 className="font-heading text-2xl font-normal text-foreground sm:text-3xl">{pick.name}</h2>
          {pick.description && <p className="max-w-md text-sm leading-relaxed text-muted">{pick.description}</p>}
        </div>
        <span className="shrink-0 whitespace-nowrap font-heading text-xl text-foreground">
          {formatCurrency(pick.price, currency ?? restaurant?.settings.currency)}
        </span>
      </div>
    </section>
  );
}

/** Luxury — the restaurant's own description as a large quiet editorial statement: a small kicker
 *  label in its own column beside (not above) a generous serif paragraph — never a boxed "About
 *  Us" card, never a centered pull-quote. */
export function LuxuryAbout({ restaurant }: AboutProps) {
  if (!restaurant?.description) return null;
  return (
    <section aria-label="About" className="grid grid-cols-1 gap-5 py-12 sm:grid-cols-[1fr_2.2fr] sm:gap-16 sm:py-20">
      <span className="text-xs font-medium uppercase tracking-[0.28em] text-muted">Our story</span>
      <Reveal variant="fade" as="p" className="max-w-2xl font-heading text-2xl font-normal leading-relaxed text-foreground sm:text-3xl">
        {restaurant.description}
      </Reveal>
    </section>
  );
}

/** Luxury — a restrained asymmetric pairing (cover leading, larger; logo trailing, smaller,
 *  offset downward) when both exist, contained within the page's own margins with generous
 *  whitespace around it — a single contained image when only one exists. Never a symmetric grid,
 *  never edge-to-edge full bleed (that register belongs to Cinematic). */
export function LuxuryGallery({ restaurant }: GalleryProps) {
  const primary = restaurant?.coverImage;
  const secondary = restaurant?.logo;
  if (!primary && !secondary) return null;

  if (primary && secondary) {
    return (
      <section aria-label="Gallery" className="py-6 sm:py-14">
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-[2fr_1fr] sm:gap-10">
          <Reveal variant="fade" className="aspect-[4/3] overflow-hidden bg-secondary">
            <img src={primary} alt="" loading="lazy" className="h-full w-full object-cover" />
          </Reveal>
          <Reveal variant="fade" index={1} className="aspect-[4/3] overflow-hidden bg-secondary sm:mt-12">
            <img src={secondary} alt="" loading="lazy" className="h-full w-full object-cover" />
          </Reveal>
        </div>
      </section>
    );
  }

  return (
    <section aria-label="Gallery" className="py-6 sm:py-14">
      <Reveal variant="fade" className="mx-auto aspect-[16/9] max-w-4xl overflow-hidden bg-secondary">
        <img src={primary ?? secondary} alt="" loading="lazy" className="h-full w-full object-cover" />
      </Reveal>
    </section>
  );
}

/** Luxury — the closing invitation stays in the page's own quiet register: two hairline rules and
 *  a plain text/underline CTA, never a bright filled card. */
export function LuxuryCta({ restaurant, hasCategories, orderingOpen, onStartOrder }: CtaProps) {
  if (!hasCategories || !orderingOpen) return null;
  return (
    <section className="flex flex-col items-center gap-6 border-y border-border py-16 text-center sm:py-24">
      <h2 className="max-w-md font-heading text-2xl font-normal leading-snug text-foreground sm:text-3xl">
        {restaurant?.name ? `${restaurant.name} is ready when you are.` : "Ready when you are."}
      </h2>
      <button
        onClick={onStartOrder}
        className="group flex items-center gap-2 border-b border-foreground pb-1 text-sm font-medium tracking-[0.02em] text-foreground transition-opacity duration-fast hover:opacity-70"
      >
        View the menu
        <ArrowRightIcon className="h-3.5 w-3.5 transition-transform duration-normal group-hover:translate-x-1" />
      </button>
    </section>
  );
}
