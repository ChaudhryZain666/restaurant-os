/**
 * A quiet chapter marker for the cinematic page's four acts — one small monospace corner label
 * (matching the Hero's own "Best for / Best at / Replaces" strip and Operations Board's "STN.0X"
 * labels), meant to sit absolutely-positioned inside whichever section opens each act. Deliberately
 * NOT a full-width inserted block between sections: every section-to-section transition in
 * HomePage.tsx already has a hand-tuned gradient assuming its neighbor is adjacent — inserting a new
 * block would break those. A corner label changes nothing about layout or backgrounds.
 */
export function ActDivider({ roman, title, dark = true }: { roman: string; title: string; dark?: boolean }) {
  return (
    <span
      className="pointer-events-none absolute left-5 top-6 z-10 whitespace-nowrap font-mono text-[10px] uppercase tracking-[0.28em] sm:left-8 lg:left-14"
      style={{ color: dark ? "rgba(245,239,230,0.35)" : "rgba(43,33,22,0.35)" }}
      aria-hidden
    >
      Act {roman} — {title}
    </span>
  );
}
