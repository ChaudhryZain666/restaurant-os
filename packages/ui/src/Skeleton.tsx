import type { HTMLAttributes } from "react";
import { cn } from "./cn.js";

export function Skeleton({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      role="status"
      aria-label="Loading"
      className={cn("skeleton-shimmer rounded-md", className)}
      {...props}
    />
  );
}
