import { useId } from "react";

/**
 * A barely-there noise texture for dark cinematic chapters — the brief's own "subtle grain /
 * atmosphere where appropriate," not built anywhere yet. Pure SVG (no image asset, no animation —
 * a static texture reads as film grain; an animated one reads as static/glitch, which isn't the
 * effect wanted here), so it costs nothing to lazy-load or fail gracefully. `useId` keeps the
 * filter id collision-free if this is mounted more than once on the same page (Hero + Final CTA
 * both use it).
 */
export function FilmGrain({ opacity = 0.05 }: { opacity?: number }) {
  const filterId = `gt-grain-${useId()}`;
  return (
    <svg
      className="pointer-events-none absolute inset-0 h-full w-full"
      style={{ opacity, mixBlendMode: "overlay" }}
      aria-hidden
    >
      <filter id={filterId}>
        <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" stitchTiles="stitch" />
      </filter>
      <rect width="100%" height="100%" filter={`url(#${filterId})`} />
    </svg>
  );
}
