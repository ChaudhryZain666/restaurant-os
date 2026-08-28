import { Reveal } from "@restaurant/ui";
import { formatCurrency } from "@restaurant/utils";
import type { AboutProps, CtaProps, FeaturedProps, GalleryProps } from "../types";
import { ArrowRightIcon, PlateIcon } from "../icons";

/** Contemporary — the dish photo and its text card intentionally OVERLAP: the card is pulled up over
 *  the image's bottom edge with a negative margin and set off-left (never centered), the theme's
 *  recurring "overlap" motif (see Hero's floating minimum-order card). Not two clean separate
 *  halves. */
export function ContemporaryFeatured({ restaurant, items, currency }: FeaturedProps) {
  const pick = items[0];
  if (!pick) return null;
  return (
    <section aria-label="Featured item" className="relative mb-20 sm:mb-28">
      <Reveal variant="mask" className="aspect-[16/10] w-full overflow-hidden bg-secondary sm:aspect-[21/9]">
        {pick.imageUrl ? (
          <img src={pick.imageUrl} alt="" loading="lazy" className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-secondary-foreground/20">
            <PlateIcon className="h-16 w-16" />
          </div>
        )}
      </Reveal>
      <Reveal
        variant="scale"
        index={1}
        className="relative z-10 mx-6 -mt-16 max-w-sm border-2 border-foreground bg-surface p-6 sm:mx-0 sm:-mt-20 sm:ml-14 sm:max-w-md sm:p-10"
      >
        <span className="text-[10px] font-bold uppercase tracking-[0.28em] text-muted">Signature dish</span>
        <h2 className="mt-2 font-heading text-3xl font-black leading-tight text-foreground sm:text-4xl">{pick.name}</h2>
        {pick.description && <p className="mt-3 max-w-sm text-sm leading-relaxed text-muted">{pick.description}</p>}
        <span className="mt-4 block font-heading text-2xl font-black text-primary">
          {formatCurrency(pick.price, currency ?? restaurant?.settings.currency)}
        </span>
      </Reveal>
    </section>
  );
}

/** Contemporary — the restaurant's own description set in large off-grid type: a ghost-toned index
 *  number occupies its own narrow column, the paragraph starts a third of the way across (column
 *  4 of 12) and stops before the far edge — never full-width, never centered. */
export function ContemporaryAbout({ restaurant }: AboutProps) {
  if (!restaurant?.description) return null;
  return (
    <section className="grid grid-cols-1 gap-6 py-20 sm:grid-cols-12 sm:gap-8 sm:py-28">
      <span aria-hidden className="hidden font-heading text-8xl font-black leading-none text-border sm:col-span-2 sm:block">
        02
      </span>
      <p className="font-heading text-2xl font-medium leading-snug text-foreground sm:col-span-8 sm:col-start-4 sm:text-4xl">
        {restaurant.description}
      </p>
    </section>
  );
}

/** Contemporary — an uneven two-tile grid (never a clean symmetric layout): the larger tile runs
 *  full height while the smaller one is pushed down with its own top margin, breaking the shared
 *  baseline the way a plain 2fr/1fr split alone wouldn't. */
export function ContemporaryGallery({ restaurant }: GalleryProps) {
  const primary = restaurant?.coverImage;
  const secondary = restaurant?.logo;
  if (!primary && !secondary) return null;
  if (primary && secondary) {
    return (
      <section aria-label="Gallery" className="-mx-4 grid grid-cols-1 gap-1 sm:-mx-6 sm:grid-cols-12">
        <Reveal variant="mask" className="aspect-[4/3] overflow-hidden bg-secondary sm:col-span-8 sm:aspect-auto sm:min-h-[26rem]">
          <img src={primary} alt="" loading="lazy" className="h-full w-full object-cover" />
        </Reveal>
        <Reveal variant="mask" index={1} className="aspect-square overflow-hidden bg-secondary sm:col-span-4 sm:mt-14 sm:aspect-auto sm:min-h-[20rem]">
          <img src={secondary} alt="" loading="lazy" className="h-full w-full object-cover" />
        </Reveal>
      </section>
    );
  }
  return (
    <Reveal variant="mask" as="section" aria-label="Gallery" className="-mx-4 aspect-[21/9] overflow-hidden bg-secondary sm:-mx-6">
      <img src={primary ?? secondary} alt="" loading="lazy" className="h-full w-full object-cover" />
    </Reveal>
  );
}

/** Contemporary — a bold geometric closing band, not a centered card: a full-bleed dark block with a
 *  left-aligned headline occupying most of its width and a detached button pinned to the
 *  bottom-right, an eyebrow index tag running the full width above both for visual rhythm. */
export function ContemporaryCta({ restaurant, hasCategories, orderingOpen, onStartOrder }: CtaProps) {
  if (!hasCategories || !orderingOpen) return null;
  return (
    <section className="-mx-4 grid grid-cols-1 gap-10 bg-foreground px-6 py-16 sm:-mx-6 sm:grid-cols-12 sm:px-14 sm:py-24">
      <span className="text-xs font-bold uppercase tracking-[0.28em] text-background/50 sm:col-span-12">— Ready to order</span>
      <h2 className="font-heading text-4xl font-black uppercase leading-[0.95] text-background sm:col-span-8 sm:text-6xl">
        {restaurant?.name ? `${restaurant.name} is plating up.` : "The kitchen is ready."}
      </h2>
      <div className="flex items-end sm:col-span-4 sm:justify-end">
        <button
          onClick={onStartOrder}
          className="group flex items-center gap-2.5 bg-background px-7 py-3.5 text-xs font-bold uppercase tracking-[0.2em] text-foreground transition-transform duration-normal hover:-translate-y-0.5"
        >
          View the menu
          <ArrowRightIcon className="h-3.5 w-3.5 transition-transform duration-normal group-hover:translate-x-1" />
        </button>
      </div>
    </section>
  );
}
