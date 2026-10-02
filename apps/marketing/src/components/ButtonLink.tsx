import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { buttonVariants, cn } from "@restaurant/ui";

type Variant = "primary" | "secondary" | "outline" | "ghost";
type Size = "sm" | "md" | "lg";

/**
 * A link that looks like the shared Button — one interactive element, not a <button> nested in
 * an <a> (invalid HTML, and two tab stops for keyboard users). `to` for in-app routes, `href` for
 * the admin/storefront apps.
 */
export function ButtonLink({
  to,
  href,
  variant,
  size,
  className,
  onClick,
  children,
}: {
  to?: string;
  href?: string;
  variant?: Variant;
  size?: Size;
  className?: string;
  onClick?: () => void;
  children: ReactNode;
}) {
  const classes = cn(buttonVariants({ variant, size }), className);
  if (href) {
    return (
      <a href={href} className={classes} onClick={onClick}>
        {children}
      </a>
    );
  }
  return (
    <Link to={to ?? "/"} className={classes} onClick={onClick}>
      {children}
    </Link>
  );
}
