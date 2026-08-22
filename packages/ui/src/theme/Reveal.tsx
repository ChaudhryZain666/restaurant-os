import { createElement, type ElementType, type HTMLAttributes } from "react";
import { cn } from "../cn.js";
import { useScrollReveal } from "./useScrollReveal.js";

export interface RevealProps extends HTMLAttributes<HTMLElement> {
  /** Position in a list — staggers the reveal slightly per item. Capped so long lists don't get a long tail. */
  index?: number;
  /** The DOM tag to render — e.g. "li" when Reveal wraps a list item, so markup stays valid
   * (a plain always-a-div wrapper would break `<ul><li>` semantics and CSS grid item placement). */
  as?: ElementType;
}

/** Fades/slides an element up into place the first time it enters the viewport. See index.css's .reveal. */
export function Reveal({ className, index = 0, style, as = "div", ...props }: RevealProps) {
  const { ref, visible } = useScrollReveal<HTMLElement>();
  return createElement(as, {
    ref,
    className: cn("reveal", visible && "reveal-visible", className),
    style: { transitionDelay: visible ? `${Math.min(index, 6) * 60}ms` : "0ms", ...style },
    ...props,
  });
}
