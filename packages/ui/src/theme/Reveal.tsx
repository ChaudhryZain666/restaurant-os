import { createElement, type ElementType, type HTMLAttributes, type ReactNode } from "react";
import { cn } from "../cn.js";
import { useScrollReveal } from "./useScrollReveal.js";

export interface RevealProps extends HTMLAttributes<HTMLElement> {
  /** Position in a list — staggers the reveal slightly per item. Capped so long lists don't get a long tail. */
  index?: number;
  /** The DOM tag to render — e.g. "li" when Reveal wraps a list item, so markup stays valid
   * (a plain always-a-div wrapper would break `<ul><li>` semantics and CSS grid item placement). */
  as?: ElementType;
  /** Phase 33 — which reveal style to use, each backed by its own `.reveal-*`/`.reveal-*-visible`
   *  CSS pair (see the consuming app's index.css): "fade-up" (default, Phase 31's original
   *  translate+fade), "fade" (opacity only — for restrained themes like Luxury/Minimal), "mask" (a
   *  clip-path wipe — for image reveals), "scale" (a subtle scale+fade — for Contemporary). All are
   *  transform/opacity/clip-path only and neutralized under prefers-reduced-motion. */
  variant?: "fade-up" | "fade" | "mask" | "scale";
  children?: ReactNode;
}

/** Reveals an element the first time it enters the viewport, in the style its `variant` selects.
 *  See index.css's .reveal/.reveal-fade/.reveal-mask/.reveal-scale.
 *
 *  `variant="mask"` is structurally different from the others: it renders an extra inner wrapper
 *  that carries the clip-path animation, rather than putting clip-path on the OBSERVED element
 *  itself. This works around a real, confirmed Chromium behavior — an element clipped to zero
 *  visible area via `clip-path` is reported as having 0% intersection ratio to IntersectionObserver
 *  even though its layout geometry (getBoundingClientRect) is unaffected, which deadlocks a
 *  clip-path-driven reveal (it can never observe itself as "intersecting" while still clipped to
 *  nothing). Observing a plain, never-clipped outer element and animating the clip on an inner div
 *  sidesteps this entirely. */
export function Reveal({ className, index = 0, style, as = "div", variant = "fade-up", children, ...props }: RevealProps) {
  const { ref, visible } = useScrollReveal<HTMLElement>();

  if (variant === "mask") {
    return createElement(
      as,
      { ref, className, style, ...props },
      createElement(
        "div",
        {
          className: cn("reveal-mask", visible && "reveal-mask-visible"),
          style: { height: "100%", width: "100%", transitionDelay: visible ? `${Math.min(index, 6) * 60}ms` : "0ms" },
        },
        children
      )
    );
  }

  const base = variant === "fade-up" ? "reveal" : `reveal-${variant}`;
  return createElement(
    as,
    {
      ref,
      className: cn(base, visible && `${base}-visible`, className),
      style: { transitionDelay: visible ? `${Math.min(index, 6) * 60}ms` : "0ms", ...style },
      ...props,
    },
    children
  );
}
