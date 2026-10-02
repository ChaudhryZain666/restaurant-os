import { Reveal, useReducedMotion } from "@restaurant/ui";
import { useScrollProgress } from "../../lib/useScrollProgress";
import { Chapter, ChapterHeading } from "./Chapter";

/* ─── 02 — The Problem ─────────────────────────────────────────────────────────────────────── */

const COMPARISON = [
  {
    row: "Who owns the customer",
    market: "The marketplace",
    direct: "You — names, history, repeat visits",
  },
  {
    row: "What each order costs",
    market: "A percentage of every order",
    direct: "0% platform commission, one subscription",
  },
  {
    row: "Whose brand they see",
    market: "Theirs, beside your competitors",
    direct: "Yours, on your own domain",
  },
  {
    row: "What you learn",
    market: "What they choose to share",
    direct: "Every order, customer and top seller",
  },
];

/**
 * A plain side-by-side rather than an illustration: the argument is simple and specific, and a
 * table makes it in five seconds. No figures about any named marketplace — "a percentage of every
 * order" is true of the category without claiming a specific competitor's rate.
 */
export function ProblemChapter() {
  return (
    <Chapter dark={false}>
      <ChapterHeading
        n="02"
        label="The problem"
        dark={false}
        title="A marketplace order is a customer you don't get to keep."
        intro="Marketplaces bring orders. They also take a share of each one, keep the customer's details, and present your restaurant inside their brand. Direct ordering only works when it is genuinely yours."
      />

      <div
        className="mt-16 overflow-hidden rounded-sm border"
        style={{ borderColor: "var(--gt-border-fixed)" }}
      >
        <div
          className="hidden grid-cols-[1fr_1fr_1.2fr] border-b font-mono text-[11px] uppercase tracking-[0.18em] sm:grid"
          style={{ borderColor: "var(--gt-border-fixed)", color: "var(--gt-text-muted-fixed)" }}
        >
          <span className="px-6 py-4" />
          <span className="px-6 py-4">Through a marketplace</span>
          <span
            className="px-6 py-4"
            style={{ color: "var(--gt-brand-fixed)", background: "rgba(78,29,37,0.06)" }}
          >
            Direct, with GarnishTable
          </span>
        </div>
        {COMPARISON.map((c, i) => (
          <Reveal
            key={c.row}
            index={i}
            className="grid grid-cols-1 border-b last:border-b-0 sm:grid-cols-[1fr_1fr_1.2fr]"
            style={{ borderColor: "var(--gt-border-fixed)" }}
          >
            <span
              className="px-6 pt-5 font-heading text-lg sm:py-6"
              style={{ color: "var(--gt-text-fixed)" }}
            >
              {c.row}
            </span>
            <span
              className="px-6 py-1 text-[15px] sm:py-6"
              style={{ color: "var(--gt-text-muted-fixed)" }}
            >
              <span className="mr-2 font-mono text-[10px] uppercase tracking-wider sm:hidden">
                Marketplace —
              </span>
              {c.market}
            </span>
            <span
              className="px-6 pb-5 pt-1 text-[15px] font-medium sm:py-6"
              style={{ color: "var(--gt-text-fixed)", background: "rgba(78,29,37,0.06)" }}
            >
              <span
                className="mr-2 font-mono text-[10px] uppercase tracking-wider sm:hidden"
                style={{ color: "var(--gt-brand-fixed)" }}
              >
                Direct —
              </span>
              {c.direct}
            </span>
          </Reveal>
        ))}
      </div>
    </Chapter>
  );
}

/* ─── 03 — The System ──────────────────────────────────────────────────────────────────────── */

const STAGES = [
  {
    name: "Customer",
    items: ["Your branded storefront", "QR ordering at the table", "Customer accounts"],
  },
  {
    name: "Order",
    items: ["Checkout on Stripe, your account", "Promo codes", "Pickup or delivery"],
  },
  {
    name: "Kitchen",
    items: ["One live order queue", "Kitchen view with prep timers", "Accept, prepare, ready"],
  },
  {
    name: "POS",
    items: [
      "Staff terminal for counter sales",
      "Recover interrupted sales",
      "Every sale attributed",
    ],
  },
  {
    name: "Delivery",
    items: ["Your delivery areas and fees", "Marketplaces, as approved", "Alongside pickup"],
  },
];

/**
 * The same five-stage loop as the hero ring, now unfolded and explained: what GarnishTable
 * actually does at each stage. The connecting rule fills as the section scrolls through — the one
 * motion here, and it means something (the order moving through the system). Every capability
 * listed is a shipped feature (QR dine-in, kitchen view, POS terminal with pending-sale recovery
 * and staff attribution), not roadmap — marketplace connections are described as switching on per provider approval.
 */
export function SystemChapter() {
  const { ref, progress } = useScrollProgress<HTMLDivElement>();
  const reducedMotion = useReducedMotion();
  const fill = reducedMotion ? 1 : Math.min(1, Math.max(0, (progress - 0.15) * 1.8));

  return (
    <Chapter id="system" dark>
      <ChapterHeading
        n="03"
        label="The system"
        dark
        title="One system, from the first tap to the front door."
        intro="Every order moves through the same five stages. GarnishTable runs all of them — so the order a customer places is the same order your kitchen, your counter and your drivers see."
      />

      <div ref={ref} className="relative mt-20">
        <div
          aria-hidden
          className="absolute left-0 right-0 top-[7px] hidden h-px bg-white/10 lg:block"
        />
        <div
          aria-hidden
          className="absolute left-0 top-[7px] hidden h-px lg:block"
          style={{
            width: `${fill * 100}%`,
            background: "linear-gradient(90deg, #611b28, #c9838d)",
            transition: reducedMotion ? "none" : "width 140ms linear",
          }}
        />
        <ol className="m-0 grid list-none grid-cols-1 gap-10 p-0 sm:grid-cols-2 lg:grid-cols-5 lg:gap-6">
          {STAGES.map((stage, i) => {
            const reached = fill >= i / (STAGES.length - 1) - 0.001;
            return (
              <Reveal as="li" key={stage.name} index={i} className="relative">
                <span
                  aria-hidden
                  className="relative hidden h-[15px] w-[15px] rounded-full border lg:block"
                  style={{
                    borderColor: reached ? "#c9838d" : "rgba(245,239,230,0.25)",
                    background: reached ? "#611b28" : "var(--gt-ink-fixed)",
                    transition: "background-color 300ms ease, border-color 300ms ease",
                  }}
                />
                <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-white/40 lg:mt-6">
                  {String(i + 1).padStart(2, "0")}
                </p>
                <h3 className="mt-2 font-heading text-2xl text-[#f6f0e2]">{stage.name}</h3>
                <ul className="mt-4 flex list-none flex-col gap-2 p-0 text-sm text-white/60">
                  {stage.items.map((item) => (
                    <li key={item} className="border-t border-white/10 pt-2">
                      {item}
                    </li>
                  ))}
                </ul>
              </Reveal>
            );
          })}
        </ol>
      </div>
    </Chapter>
  );
}
