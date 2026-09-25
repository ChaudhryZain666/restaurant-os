import { Link } from "react-router-dom";
import { Reveal } from "@restaurant/ui";
import { IconArrowRight } from "./icons";

// Phase 80 note: same shared-Button trap as WhoIsItFor.tsx — see that file's comment.
const fixedOutlineButtonClass =
  "inline-flex items-center justify-center gap-2 rounded-pill border px-3.5 py-2 text-sm font-medium transition-colors duration-150";

// Phase 80 (content add-on) — the 5 storefront themes actually promoted to restaurants today
// (apps/web/src/theme/registry.tsx + docs/theme-architecture.md's own comparison table). Classic/
// Modern/Editorial also exist in the registry but are kept only for zero-regression/legacy
// reasons — not part of the sold collection, so not shown here as a current offering. Descriptions
// are the real ones each theme's own registry entry uses, not paraphrased marketing copy.
const THEMES = [
  {
    name: "Cinematic",
    tagline: "A restaurant-film website, not an app",
    copy: "A viewport-height photographic hero, typography sitting directly on the image, a transparent nav that solidifies on scroll.",
    swatch: "linear-gradient(135deg, #6d1f2a, #1c1417)",
  },
  {
    name: "Luxury",
    tagline: "Quality communicated through restraint",
    copy: "Sophisticated serif typography, thin hairline rules instead of cards, generous whitespace, understated text-only CTAs.",
    swatch: "linear-gradient(135deg, #2b2116, #f6f0e2)",
  },
  {
    name: "Contemporary",
    tagline: "Designed by a digital art director",
    copy: "An asymmetric split-viewport hero, oversized display typography, off-grid alignment, floating price/index numbers.",
    swatch: "linear-gradient(135deg, #171416, #7a4550)",
  },
  {
    name: "Urban",
    tagline: "Built for premium street-food and modern-casual",
    copy: "Bold condensed type, solid color blocks, dense numbered menu rows, a mobile-first sticky order bar.",
    swatch: "linear-gradient(135deg, #b45309, #171416)",
  },
  {
    name: "Minimal",
    tagline: "The absence of visual noise is the design",
    copy: "Enormous whitespace, a text-first dotted-leader menu, near-silent motion, no shadows, no cards.",
    swatch: "linear-gradient(135deg, #fcfaf5, #d9cdb0)",
  },
];

/**
 * Phase 80 (content add-on) — real theme output, not invented mockups: each swatch/description
 * comes straight from that theme's own registry entry. No per-theme deep link exists in the real
 * playground today (confirmed directly — apps/web's /experience route has no `?theme=` param), so
 * every card routes to the same real destination, `/demo`, where a visitor can actually switch
 * between them live — rather than fabricate a URL structure that doesn't exist.
 */
export function ThemeShowcase() {
  return (
    <div className="mx-auto max-w-6xl">
      <Reveal className="mx-auto max-w-2xl text-center">
        <span className="text-sm font-semibold uppercase tracking-wide text-[var(--gt-brand-fixed)]">Storefront themes</span>
        <h2 className="mt-3 font-heading text-3xl font-semibold text-[var(--gt-text-fixed)] sm:text-4xl">
          Your restaurant doesn't have to look like everyone else's
        </h2>
        <p className="mt-4 text-[var(--gt-text-muted-fixed)]">
          Five distinct storefront themes, each a genuinely different layout and register — not the same template
          recolored. Pick the one that matches how your restaurant actually feels.
        </p>
      </Reveal>

      <div className="mt-10 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {THEMES.map((theme, i) => (
          <Reveal
            key={theme.name}
            index={i}
            className="group overflow-hidden rounded-2xl border"
            style={{ borderColor: "var(--gt-border-fixed)", background: "var(--gt-surface-fixed)" }}
          >
            <div className="h-28" style={{ background: theme.swatch }} aria-hidden />
            <div className="p-5">
              <h3 className="font-heading text-lg font-semibold text-[var(--gt-text-fixed)]">{theme.name}</h3>
              <p className="mt-1 text-xs font-medium uppercase tracking-wide text-[var(--gt-brand-fixed)]">{theme.tagline}</p>
              <p className="mt-2 text-sm text-[var(--gt-text-muted-fixed)]">{theme.copy}</p>
            </div>
          </Reveal>
        ))}
        <Reveal
          index={THEMES.length}
          className="flex flex-col items-start justify-center gap-3 rounded-2xl border border-dashed p-5"
          style={{ borderColor: "var(--gt-border-fixed)" }}
        >
          <p className="font-medium text-[var(--gt-text-fixed)]">Try them live</p>
          <p className="text-sm text-[var(--gt-text-muted-fixed)]">
            Switch between every theme on the real demo restaurant, right in your browser.
          </p>
          <Link to="/demo" className={fixedOutlineButtonClass} style={{ borderColor: "var(--gt-border-fixed)", color: "var(--gt-text-fixed)" }}>
            Open the playground <IconArrowRight className="h-4 w-4" />
          </Link>
        </Reveal>
      </div>
    </div>
  );
}
