import type { HTMLAttributes } from "react";
import { cn } from "./cn.js";
import logoMarkAsset from "./assets/logo-mark.png";

const SIZES = {
  sm: { mark: "h-8 w-8", text: "text-base" },
  md: { mark: "h-9 w-9", text: "text-lg" },
  lg: { mark: "h-11 w-11", text: "text-2xl" },
} as const;

export interface LogoProps extends HTMLAttributes<HTMLSpanElement> {
  size?: keyof typeof SIZES;
  /** Renders only the mark — for call sites (e.g. a favicon-adjacent app icon, or a nav that pairs
   *  it with its own custom text block) that don't want the wordmark. */
  hideText?: boolean;
  /**
   * Phase 78 — GarnishTable's real mark is now a fixed-color raster asset (see ./assets/logo-mark.png),
   * not a themeable token-colored SVG, so recoloring works via CSS filters instead of swapping fill
   * colors:
   * - "default" — the mark and wordmark in their real, natural oxblood tone. Correct on the brand's
   *   own light surfaces (nav bars, footers, cream/parchment panels).
   * - "light" — the mark recolored to flat white/ivory via a CSS filter, wordmark in warm ivory —
   *   for a dark surface (the admin sidebar) where the natural oxblood mark wouldn't read.
   * - "dark" — the mark recolored to flat near-black via a CSS filter, wordmark in the same ink —
   *   for a light/neutral non-brand surface (e.g. a plain-white printed or email context).
   */
  variant?: "default" | "light" | "dark";
}

const MONOCHROME: Record<"light" | "dark", { filter: string; text: string }> = {
  // brightness(0) crushes every opaque pixel to black regardless of its original hue; invert(1)
  // then flips that to white — a clean way to flatten a raster mark to one solid color without a
  // second image asset.
  light: { filter: "brightness(0) invert(1)", text: "#f8f4ea" },
  dark: { filter: "brightness(0)", text: "#2b2116" },
};

/**
 * GarnishTable's mark — the real logo asset (see ./assets/logo-mark.png), a "G" built from two
 * composed solid pieces. Previously an abstract SVG approximation; replaced with the actual brand
 * artwork so every surface shows the real mark, not a geometric stand-in.
 */
function Mark({ className, variant }: { className?: string; variant?: "light" | "dark" }) {
  const style = variant ? { filter: MONOCHROME[variant].filter } : undefined;
  return <img src={logoMarkAsset} alt="" className={cn("object-contain", className)} style={style} />;
}

/**
 * The single source of the GarnishTable wordmark — a geometric mark plus the brand name.
 * Previously duplicated independently across the admin sidebar and the marketing nav/footer;
 * extracted so a future refinement only needs to change here.
 */
export function Logo({ size = "md", hideText, variant = "default", className, ...props }: LogoProps) {
  const s = SIZES[size];
  const mono = variant !== "default" ? MONOCHROME[variant] : undefined;
  const mark = <Mark className={cn("shrink-0", s.mark)} variant={variant !== "default" ? variant : undefined} />;
  if (hideText) return mark;
  return (
    <span className={cn("flex items-center gap-2.5", className)} {...props}>
      {mark}
      <span
        className={cn("font-heading font-semibold tracking-tight", s.text)}
        style={{ color: mono ? mono.text : "var(--color-primary)" }}
      >
        GarnishTable
      </span>
    </span>
  );
}
