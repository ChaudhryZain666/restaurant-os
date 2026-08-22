import type { HTMLAttributes } from "react";
import { cn } from "./cn.js";

export interface SpinnerProps extends HTMLAttributes<HTMLDivElement> {
  size?: "sm" | "md" | "lg";
  label?: string;
}

const SIZES = { sm: "h-4 w-4 border-2", md: "h-6 w-6 border-2", lg: "h-9 w-9 border-[3px]" };

/** Branded loading indicator — a single rotating ring, transform-only (cheap to animate). */
export function Spinner({ className, size = "md", label = "Loading", ...props }: SpinnerProps) {
  return (
    <div role="status" className={cn("inline-flex items-center gap-2", className)} {...props}>
      <span className={cn("animate-spin rounded-full border-current border-t-transparent text-primary", SIZES[size])} />
      <span className="sr-only">{label}</span>
    </div>
  );
}
