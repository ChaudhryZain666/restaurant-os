/**
 * The decorative blueprint-grid + radial brand-glow layer from HomePage.tsx's Final CTA, extracted
 * verbatim so `MarketingPageHero`/`MarketingClosingCta` can reuse the exact same "arrival" motif on
 * the other 9 routes — WebGL-free, cheap, intentionally lighter-weight than Home's own R3F hero
 * (which stays Home-only). Two plain absolutely-positioned divs, `aria-hidden`, no props: every
 * usage renders identically, matching Home's own center-top placement.
 */
export function ObsidianGlowBackground() {
  return (
    <>
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.08]"
        style={{
          backgroundImage:
            "linear-gradient(rgba(255,255,255,0.7) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.7) 1px, transparent 1px)",
          backgroundSize: "88px 88px",
        }}
        aria-hidden
      />
      <div
        className="pointer-events-none absolute inset-0"
        style={{ background: "radial-gradient(ellipse 55% 60% at 50% 40%, rgba(201,131,141,0.14), transparent 65%)" }}
        aria-hidden
      />
    </>
  );
}
