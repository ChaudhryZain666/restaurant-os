import { useReducedMotion } from "@restaurant/ui";
import { useScrollProgress } from "../lib/useScrollProgress";
import { usePublicPlans, formatPlanPrice } from "../lib/plans";
import { IconCheck } from "./icons";

/**
 * "What we replace" — a different device from Why We Exist's abstract chip-convergence (per the
 * "different compositions, same brand" instruction): concrete paper "invoices" for the pile of
 * separate tools/subscriptions a restaurant typically pays for, stacked and slightly fanned,
 * collapsing flat into a single real GarnishTable plan summary as the section scrolls — real pricing
 * (GET /public/plans, same source as ScaleSelector/PricingPage), not invented numbers. The
 * fragmented cost is a representative illustration of common category pricing, clearly framed as
 * such, not a claim about any specific competitor.
 */

const FRAGMENTS = [
  { label: "Website builder", cost: "$29/mo", rotate: -7, x: -70 },
  { label: "Ordering app", cost: "$79/mo + ~15% per order", rotate: 4, x: -30 },
  { label: "Delivery dispatch tool", cost: "$59/mo", rotate: -3, x: 10 },
  { label: "Loyalty punch cards", cost: "$0 — but no data", rotate: 6, x: 48 },
  { label: "Spreadsheet for the numbers", cost: "$0 — but hours of it", rotate: -9, x: 80 },
];

export function WhatWeReplace() {
  const { ref, progress } = useScrollProgress<HTMLDivElement>();
  const reducedMotion = useReducedMotion();
  const { plans } = usePublicPlans();
  const p = reducedMotion ? 1 : Math.min(1, progress * 1.35);
  // Phase 80 (revised) — an opacity-based fade (WhyWeExist's fix) doesn't work here: these are
  // wide, opaque invoice cards with real cost text, not faint translucent chips, so fading their
  // opacity while they still overlap in position just makes several legible-but-see-through cards
  // blend into an illegible smear (confirmed via a scroll sweep screenshot — "$29/mo79/mo...hours
  // of it" stacked directly on the summary card). Fully opaque cards overlapping is fine on its
  // own — it just reads as a normal fanned stack. So instead of fading opacity, collapse position,
  // rotation and scale together toward a single vanishing point, staying at opacity 1 the whole
  // time — the cards shrink to nothing rather than turning translucent, so there's no scroll
  // position where partially-see-through overlapping text can occur.
  const collapse = Math.min(1, p / 0.45);
  const spread = 1 - collapse;

  const cheapest = [...(plans ?? [])].sort((a, b) => {
    const ca = a.pricing.find((x) => x.interval === "monthly")?.amountCents ?? Infinity;
    const cb = b.pricing.find((x) => x.interval === "monthly")?.amountCents ?? Infinity;
    return ca - cb;
  })[0];

  return (
    <div ref={ref}>
      <div className="mx-auto max-w-2xl text-center">
        <span className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[var(--gt-accent-fixed)]">What we replace</span>
        <h2 className="mt-3 font-heading text-4xl italic text-[var(--gt-text-fixed)] sm:text-5xl">You don't need a pile of separate tools.</h2>
        <p className="mt-4 text-[#5c4f3d]">A representative stack, not any one competitor — the kind most independent restaurants end up assembling.</p>
      </div>

      {/* overflow-hidden: same guard as WhyWeExist — the fanned fragment cards use fixed widths
          with percentage/px transforms that can extend past this container on narrow viewports. */}
      <div className="relative mx-auto mt-16 h-[320px] max-w-md overflow-hidden sm:h-[280px]">
        {FRAGMENTS.map((f, i) => (
          <div
            key={f.label}
            className="absolute left-1/2 top-1/2 w-56 rounded-sm border p-4 shadow-sm"
            style={{
              // "-fixed" tokens, not the theme-relative --color-* ones: this section always renders
              // on its own light parchment card regardless of the Home page's dark .theme-obsidian
              // ancestor, but --color-surface/--color-border/--color-foreground resolve through
              // whichever theme wraps the element — inside .theme-obsidian that's the dark-canvas
              // values, so these cards were rendering with a near-black background (rgb(36,23,27),
              // confirmed live), not cream. Exactly the bug this file's own comment already documents
              // and fixes for this component's summary card just below — these fragments were missed.
              borderColor: "var(--gt-border-fixed)",
              background: "var(--gt-surface-fixed)",
              transform: `translate(-50%,-50%) translate(${f.x * spread}%, ${i * 6 * spread}%) rotate(${f.rotate * spread}deg) scale(${spread})`,
              opacity: 1,
              zIndex: FRAGMENTS.length - i,
              transition: reducedMotion ? "none" : "transform 150ms linear, opacity 150ms linear",
            }}
          >
            <p className="font-mono text-[9px] uppercase tracking-wide text-[#8f8570]">{f.label}</p>
            <p className="mt-1 font-heading text-base text-[var(--gt-text-fixed)]">{f.cost}</p>
          </div>
        ))}

        {cheapest && (
          <div
            className="absolute left-1/2 top-1/2 w-64 -translate-x-1/2 -translate-y-1/2 rounded-sm border p-5"
            style={{
              borderColor: "var(--gt-brand-fixed)",
              background: "var(--gt-brand-foreground-fixed)",
              boxShadow: "0 20px 40px -20px rgba(61,15,22,0.25)",
              opacity: p,
              transform: `translate(-50%,-50%) scale(${0.9 + p * 0.1})`,
              transition: reducedMotion ? "none" : "opacity 200ms linear, transform 200ms linear",
            }}
          >
            <p className="font-mono text-[10px] uppercase tracking-wide text-[var(--gt-accent-fixed)]">{cheapest.name}</p>
            <p className="mt-1 font-heading text-2xl text-[var(--gt-text-fixed)]">
              {formatPlanPrice(cheapest.pricing, "monthly") ?? "Contact us"}
              <span className="text-sm text-[#8f8570]">/mo</span>
            </p>
            <ul className="mt-3 flex flex-col gap-1.5">
              {["Ordering, menu, delivery", "Customers & loyalty", "Analytics", "$0 commission"].map((f) => (
                <li key={f} className="flex items-center gap-1.5 text-xs text-[var(--gt-text-fixed)]">
                  <IconCheck className="h-3 w-3 text-[var(--gt-brand-fixed)]" />
                  {f}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
