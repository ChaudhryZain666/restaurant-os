import type { HTMLAttributes } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "./cn.js";

const alertVariants = cva("flex items-start gap-2 rounded-lg border px-4 py-3 text-sm", {
  variants: {
    tone: {
      neutral: "border-border bg-surface text-foreground",
      info: "border-blue-200 bg-blue-50 text-blue-800",
      success: "border-green-200 bg-green-50 text-green-800",
      warning: "border-amber-200 bg-amber-50 text-amber-800",
      danger: "border-red-200 bg-red-50 text-red-800",
    },
  },
  defaultVariants: { tone: "neutral" },
});

export interface AlertProps extends HTMLAttributes<HTMLDivElement>, VariantProps<typeof alertVariants> {}

/** role defaults to "status" (polite); pass role="alert" for errors that need assertive announcement. */
export function Alert({ className, tone, role = "status", ...props }: AlertProps) {
  return <div role={role} className={cn(alertVariants({ tone }), className)} {...props} />;
}
