import type { HTMLAttributes } from "react";
import { cn } from "./cn.js";

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
   * Phase 66 — GarnishTable's brand system:
   * - "default" — the mark in the current theme's brand token (`--color-primary`/`--color-accent`),
   *   wordmark in `--color-foreground`. Correct on ordinary light OR dark surfaces that already set
   *   those tokens sensibly (nav bars, footers, the admin sidebar, `.theme-obsidian` sections).
   * - "light" — a fixed monochrome mark + wordmark in warm ivory, regardless of the active theme
   *   tokens. For a surface whose own background isn't one of GarnishTable's own light/dark tokens
   *   (an arbitrary photo, a non-brand dark panel) where "default" can't be trusted to have enough
   *   contrast.
   * - "dark" — the monochrome-ink counterpart of "light", for the same situation on a light/neutral
   *   surface (e.g. a printed or plain-white email context).
   */
  variant?: "default" | "light" | "dark";
}

const MONOCHROME: Record<"light" | "dark", { mark: string; text: string }> = {
  light: { mark: "#f8f4ea", text: "#f8f4ea" },
  dark: { mark: "#2b2116", text: "#2b2116" },
};

/**
 * GarnishTable's mark — an abstract "G" monogram built from two composed pieces (never a literal
 * fork/plate/flame/cloche): a true ring open on one side (real letterform stroke-width, not a
 * pie-slice cut to the center — the difference between reading as "G" and reading as a mouth), and
 * a smaller solid piece tucked into its opening (the same "elements deliberately composed
 * together" idea the two-tile version of this mark used, now doing double duty as the G's own
 * spur). Pure geometry, no illustration, so it holds up from a favicon to a hero lockup.
 */
function Mark({ className, mono }: { className?: string; mono?: string }) {
  // Two-tone by default (brand + accent tokens). Monochrome mode can't use a second hue, so the
  // same distinction is carried by opacity instead — full-strength ring, a lighter spur — so the
  // two pieces still read as composed rather than one flat silhouette.
  const ringColor = mono ?? "var(--color-primary)";
  const spurColor = mono ?? "var(--color-accent)";
  const spurOpacity = mono ? 0.65 : 1;
  return (
    <svg viewBox="0 0 36 36" className={className} aria-hidden focusable="false">
      {/* r=12, stroke-width=7 -> circumference ≈75.4. dasharray leaves a rounded-cap gap on the
          ring's upper-right, rotated so the gap sits where a real "G" opens. */}
      <circle
        cx="17"
        cy="17"
        r="12"
        fill="none"
        stroke={ringColor}
        strokeWidth="7"
        strokeLinecap="round"
        strokeDasharray="58 17.4"
        transform="rotate(70 17 17)"
      />
      {/* The spur — the second composed piece, tucked into the G's own opening. */}
      <circle cx="24.5" cy="15.5" r="5.5" fill={spurColor} fillOpacity={spurOpacity} />
    </svg>
  );
}

/**
 * The single source of the GarnishTable wordmark — a geometric mark plus the brand name.
 * Previously duplicated independently across the admin sidebar and the marketing nav/footer;
 * extracted so a future refinement only needs to change here.
 */
export function Logo({ size = "md", hideText, variant = "default", className, ...props }: LogoProps) {
  const s = SIZES[size];
  const mono = variant !== "default" ? MONOCHROME[variant] : undefined;
  const mark = <Mark className={cn("shrink-0", s.mark)} mono={mono?.mark} />;
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
