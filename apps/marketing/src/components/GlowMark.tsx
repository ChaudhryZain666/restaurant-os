import { logoMarkAsset } from "@restaurant/ui";

interface GlowMarkProps {
  /** Logo mark size in px. */
  size?: number;
  /** Glow box size in px — the radial bloom's bounding box, always larger than `size`. */
  glowSize?: number;
  /** Set false for a static glow (e.g. a payoff moment already driven by its own scroll progress,
   *  like Why We Exist's convergence) rather than the Hero/CTA's ambient continuous breathing. */
  pulse?: boolean;
}

/**
 * The one wine-glow-lit mark treatment used at every "arrival" moment on the cinematic page (Hero
 * open, Final CTA close, Why We Exist's convergence) — extracted so the three don't drift apart
 * into slightly different glow radii/colors over time. `--gt-glow` is the oxblood token added
 * specifically for this; the mark itself is the raw asset (not the small nav-sized `<Logo>`)
 * because every use of this needs it larger than that component's size scale allows.
 */
export function GlowMark({ size = 76, glowSize = 148, pulse = true }: GlowMarkProps) {
  return (
    <div className="relative flex items-center justify-center" style={{ width: glowSize, height: glowSize }}>
      <div
        aria-hidden
        className={pulse ? "gt-glow-pulse absolute rounded-full" : "absolute rounded-full"}
        style={{
          inset: 0,
          background: "radial-gradient(circle, var(--gt-glow) 0%, rgba(97,27,40,0.35) 45%, transparent 75%)",
          filter: "blur(12px)",
        }}
      />
      <img
        src={logoMarkAsset}
        alt="GarnishTable"
        className="relative"
        style={{ width: size, height: size, objectFit: "contain", filter: "brightness(0) invert(1)" }}
      />
    </div>
  );
}
