import { Reveal } from "@restaurant/ui";

const PILLARS = [
  {
    title: "Your brand",
    copy: "The ordering experience looks and feels like your restaurant — your colors, your storefront theme, your domain.",
  },
  {
    title: "Direct ordering",
    copy: "Customers order straight from your restaurant. That relationship, and the data behind it, stays yours.",
  },
  {
    title: "No GarnishTable commission",
    copy: "0% platform commission on direct orders — a flat subscription instead. Payment processing and any delivery-provider fees are separate, real costs, never hidden as \"free.\"",
  },
  {
    title: "Built for restaurants",
    copy: "Menus, modifiers, availability, pickup and delivery — the product is shaped around how a restaurant actually operates.",
  },
  {
    title: "Restaurant + agency workflows",
    copy: "An owner runs their restaurant directly. An agency manages many client restaurants from one account. Neither is bolted onto the other.",
  },
  {
    title: "Flexible integrations",
    copy: "Connect the providers your restaurant already uses, through the connection flow each one actually supports today.",
  },
];

/**
 * Phase 80 (content add-on) — the "why us" pitch, kept factual and product-focused per the brief:
 * no claims about payment processors or delivery providers being free, no implication every
 * integration is self-serve today (that honesty lives in the dedicated Integrations section this
 * links to, not restated/oversimplified here).
 *
 * `-fixed` tokens throughout — see WhatIsGarnishTable.tsx's comment for why this section's own
 * light parchment ground (nested inside the page's one outer `.theme-obsidian` wrapper) can't use
 * the theme-relative `text-foreground`/`text-muted`/`text-primary` classes.
 */
/** Zero-padded index — "01", "02"... — the same editorial-numeral device the pricing/menu
 *  sections already use, rather than an icon badge. Typography carries this section, per the
 *  brief's "make this a brand statement... typography and composition over iconography." */
function ordinal(i: number): string {
  return String(i + 1).padStart(2, "0");
}

export function WhyGarnishTable() {
  return (
    <div className="mx-auto max-w-5xl">
      <Reveal className="max-w-2xl">
        <span className="text-sm font-semibold uppercase tracking-wide text-[var(--gt-brand-fixed)]">Why GarnishTable</span>
        <h2 className="mt-3 font-heading text-3xl font-semibold text-[var(--gt-text-fixed)] sm:text-4xl">
          Not a generic ordering system, and not a marketplace
        </h2>
      </Reveal>

      <div className="mt-12">
        {PILLARS.map((pillar, i) => (
          <Reveal
            key={pillar.title}
            index={i}
            className="flex flex-col gap-2 border-t py-7 sm:flex-row sm:items-baseline sm:gap-10 lg:gap-16"
            style={{ borderColor: "var(--gt-border-fixed)" }}
          >
            <span
              className="font-heading text-2xl italic sm:w-16 sm:flex-shrink-0"
              style={{ color: "var(--gt-brand-fixed)" }}
              aria-hidden
            >
              {ordinal(i)}
            </span>
            <div className="flex-1">
              <p className="font-heading text-xl font-semibold text-[var(--gt-text-fixed)] sm:text-2xl">{pillar.title}</p>
              <p className="mt-2 max-w-2xl text-[var(--gt-text-muted-fixed)]">
                {pillar.title === "Flexible integrations" ? (
                  <>
                    {pillar.copy} See{" "}
                    <a href="#integrations" className="underline underline-offset-2 hover:text-[var(--gt-text-fixed)]">
                      integrations
                    </a>{" "}
                    below for exactly what's available today.
                  </>
                ) : (
                  pillar.copy
                )}
              </p>
            </div>
          </Reveal>
        ))}
        <div className="border-t" style={{ borderColor: "var(--gt-border-fixed)" }} aria-hidden />
      </div>
    </div>
  );
}
