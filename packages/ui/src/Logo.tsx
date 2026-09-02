import type { HTMLAttributes } from "react";
import { cn } from "./cn.js";

const SIZES = {
  sm: { badge: "h-8 w-8 text-sm", text: "text-base" },
  md: { badge: "h-9 w-9 text-base", text: "text-lg" },
} as const;

export interface LogoProps extends HTMLAttributes<HTMLSpanElement> {
  size?: keyof typeof SIZES;
  /** Renders only the letter badge — for call sites (e.g. the admin sidebar) that pair it with
   *  their own custom text block, such as a subtitle beneath the brand name. */
  hideText?: boolean;
}

/**
 * The single source of the platform's wordmark — a rounded-square letter badge plus the brand
 * name. Previously duplicated independently across the admin sidebar and the marketing nav/footer;
 * extracted so a future rename or real logo mark only needs to change here.
 */
export function Logo({ size = "md", hideText, className, ...props }: LogoProps) {
  const s = SIZES[size];
  const badge = (
    <span
      className={cn(
        "flex shrink-0 items-center justify-center rounded-lg bg-primary font-heading font-bold text-primary-foreground",
        s.badge,
      )}
    >
      T
    </span>
  );
  if (hideText) return badge;
  return (
    <span className={cn("flex items-center gap-2.5", className)} {...props}>
      {badge}
      <span className={cn("font-heading font-semibold text-foreground", s.text)}>Tablecloth</span>
    </span>
  );
}
