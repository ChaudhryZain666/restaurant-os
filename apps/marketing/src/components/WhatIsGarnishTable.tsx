import { Reveal } from "@restaurant/ui";
import { IconCart, IconClipboard, IconMenuBook, IconPalette, IconStore, IconUsers } from "./icons";

const PILLARS = [
  { icon: IconStore, label: "Your restaurant", copy: "A branded page at your own URL — not a listing on someone else's marketplace." },
  { icon: IconMenuBook, label: "Your menu", copy: "Categories, items, modifiers and photos, managed the way you actually run service." },
  { icon: IconPalette, label: "Your branding", copy: "Your colors, your logo, your storefront theme — it looks like your restaurant, not a template." },
  { icon: IconCart, label: "Your online ordering", copy: "Pickup and delivery, taken directly, with no commission on the order itself." },
  { icon: IconUsers, label: "Your customer relationship", copy: "Order history, accounts and loyalty that belong to you, not a platform you rent from." },
  { icon: IconClipboard, label: "Your operational tools", copy: "A real dashboard for orders, availability, promotions and analytics — one place to run it." },
];

/**
 * Phase 80 (content add-on) — the site's first genuinely calm beat after the Hero: a plain-English
 * answer to "what is this," before anything else asks the visitor to understand a feature list or
 * make a decision. Deliberately light/parchment, not another dark chapter — the Hero, Offer,
 * Showcase and Journey sections that follow are already a sustained dark "product in motion" run;
 * this is the breathing room the brief's own "high movement -> calm -> high movement" principle
 * asks for, positioned as early as possible rather than buried after the energetic sections.
 *
 * Colors use the `-fixed` token set (`var(--gt-*-fixed)`), not the theme-relative `text-foreground`/
 * `text-muted`/`text-primary` Tailwind classes — the whole Home page is wrapped in one outer
 * `.theme-obsidian` div, so those theme-relative tokens resolve to their DARK-canvas meaning even
 * on this section's own light parchment ground. Confirmed directly (near-invisible white-on-cream
 * text before this fix) and matches the exact, already-documented reason `ScaleSelector`/
 * `WhyUseful`/`WhatWeReplace` all do the same thing.
 */
export function WhatIsGarnishTable() {
  return (
    <div className="mx-auto max-w-5xl">
      <Reveal className="max-w-2xl">
        <span className="text-sm font-semibold uppercase tracking-wide text-[var(--gt-brand-fixed)]">What is GarnishTable?</span>
        <h2 className="mt-3 font-heading text-3xl font-semibold text-[var(--gt-text-fixed)] sm:text-4xl">
          Everything your restaurant needs to sell directly online.
        </h2>
        <p className="mt-4 text-lg text-[var(--gt-text-muted-fixed)]">
          GarnishTable gives your restaurant its own branded online ordering experience — the menu, the ordering
          page, the dashboard behind it, and the customer relationship that comes from all of it — instead of a
          listing inside a marketplace app.
        </p>
      </Reveal>

      <div className="mt-10 grid grid-cols-1 gap-x-8 gap-y-6 sm:grid-cols-2 lg:grid-cols-3">
        {PILLARS.map((pillar, i) => (
          <Reveal key={pillar.label} index={i} className="flex gap-3.5">
            <span
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-[var(--gt-brand-fixed)]"
              style={{ backgroundColor: "color-mix(in srgb, var(--gt-brand-fixed) 10%, transparent)" }}
            >
              <pillar.icon className="h-5 w-5" />
            </span>
            <div>
              <p className="font-medium text-[var(--gt-text-fixed)]">{pillar.label}</p>
              <p className="mt-0.5 text-sm text-[var(--gt-text-muted-fixed)]">{pillar.copy}</p>
            </div>
          </Reveal>
        ))}
      </div>
    </div>
  );
}
