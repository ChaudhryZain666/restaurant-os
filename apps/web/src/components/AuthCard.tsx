import type { CSSProperties, ReactNode } from "react";
import { Card, hexToRgbTriplet, isDarkColor } from "@restaurant/ui";
import { useRestaurant } from "../context/RestaurantContext";
import { authBrandingFor } from "../lib/authBranding";

/**
 * White-label `branded_login` — the card every customer sign-in page (log in, create account,
 * forgot/reset password) renders in. Branded only per authBrandingFor: the restaurant's own
 * verified custom domain, with branded sign-in in force there. The page's own heading always
 * stays, so a brand name never replaces what the screen is for. Branding is recomputed from the
 * restaurant context on every render, so leaving the tenant's context clears it.
 */
export function AuthCard({ title, children }: { title: string; children: ReactNode }) {
  const { whiteLabelBrand, resolvedVia } = useRestaurant();
  const brand = authBrandingFor(whiteLabelBrand, resolvedVia);
  const style = brand?.primaryColor
    ? ({
        "--color-primary": brand.primaryColor,
        "--color-primary-rgb": hexToRgbTriplet(brand.primaryColor),
        // Contrast-safe text on the brand color, whichever way the color goes.
        "--color-primary-foreground": isDarkColor(brand.primaryColor) ? "#fffaf5" : "#1c1917",
      } as CSSProperties)
    : undefined;

  return (
    <Card className="animate-scale-in flex flex-col gap-4" style={style}>
      {brand && (
        <div className="flex items-center gap-3">
          {brand.logo && <img src={brand.logo} alt="" className="h-10 max-w-36 object-contain" />}
          <span className="font-heading text-lg font-semibold text-foreground">{brand.name}</span>
        </div>
      )}
      <h1 className="font-heading text-2xl font-semibold text-foreground">{title}</h1>
      {children}
    </Card>
  );
}
