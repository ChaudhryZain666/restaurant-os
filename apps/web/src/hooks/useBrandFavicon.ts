import { useEffect } from "react";
import { useRestaurant } from "../context/RestaurantContext";
import { faviconFor } from "../lib/brandFavicon";

/**
 * White-label — swaps the tab icon per faviconFor while a branded tenant is in context, and puts
 * the platform default back as soon as it isn't (another tenant, an unrelated page, unmount).
 */
export function useBrandFavicon(): void {
  const { whiteLabelBrand, restaurant } = useRestaurant();
  const href = faviconFor(whiteLabelBrand, restaurant?.logo);

  useEffect(() => {
    const link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
    if (!link || !href) return;
    const original = { href: link.getAttribute("href"), type: link.getAttribute("type") };
    link.setAttribute("href", href);
    link.removeAttribute("type"); // the brand logo may be PNG/JPEG/SVG; let the browser sniff it
    return () => {
      if (original.href) link.setAttribute("href", original.href);
      if (original.type) link.setAttribute("type", original.type);
    };
  }, [href]);
}
