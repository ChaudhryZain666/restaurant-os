import { Reveal } from "@restaurant/ui";
import { IconCart, IconPalette, IconPercentBadge, IconPlug, IconStore, IconUsers } from "./icons";

const PILLARS = [
  {
    icon: IconPalette,
    title: "Your brand",
    copy: "The ordering experience looks and feels like your restaurant — your colors, your storefront theme, your domain.",
  },
  {
    icon: IconCart,
    title: "Direct ordering",
    copy: "Customers order straight from your restaurant. That relationship, and the data behind it, stays yours.",
  },
  {
    icon: IconPercentBadge,
    title: "No GarnishTable commission",
    copy: "0% platform commission on direct orders — a flat subscription instead. Payment processing and any delivery-provider fees are separate, real costs, never hidden as \"free.\"",
  },
  {
    icon: IconStore,
    title: "Built for restaurants",
    copy: "Menus, modifiers, availability, pickup and delivery — the product is shaped around how a restaurant actually operates.",
  },
  {
    icon: IconUsers,
    title: "Restaurant + agency workflows",
    copy: "An owner runs their restaurant directly. An agency manages many client restaurants from one account. Neither is bolted onto the other.",
  },
  {
    icon: IconPlug,
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
export function WhyGarnishTable() {
  return (
    <div className="mx-auto max-w-6xl">
      <Reveal className="max-w-2xl">
        <span className="text-sm font-semibold uppercase tracking-wide text-[var(--gt-brand-fixed)]">Why GarnishTable</span>
        <h2 className="mt-3 font-heading text-3xl font-semibold text-[var(--gt-text-fixed)] sm:text-4xl">
          Not a generic ordering system, and not a marketplace
        </h2>
      </Reveal>

      <div className="mt-10 grid grid-cols-1 gap-x-8 gap-y-8 sm:grid-cols-2 lg:grid-cols-3">
        {PILLARS.map((pillar, i) => (
          <Reveal key={pillar.title} index={i}>
            <span
              className="flex h-10 w-10 items-center justify-center rounded-full text-[var(--gt-brand-fixed)]"
              style={{ backgroundColor: "color-mix(in srgb, var(--gt-brand-fixed) 10%, transparent)" }}
            >
              <pillar.icon className="h-5 w-5" />
            </span>
            <p className="mt-3 font-medium text-[var(--gt-text-fixed)]">{pillar.title}</p>
            <p className="mt-1.5 text-sm text-[var(--gt-text-muted-fixed)]">
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
          </Reveal>
        ))}
      </div>
    </div>
  );
}
