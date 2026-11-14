import { useEffect } from "react";
import { Link } from "react-router-dom";
import { Button } from "@restaurant/ui";
import { useAuth } from "../context/AuthContext";
import { useNoIndex } from "../hooks/useNoIndex";
import { PLATFORM_BRAND_NAME, isPlatformStorefrontHost } from "../lib/platformHost";

const MARKETING_URL = import.meta.env.VITE_MARKETING_URL;

/** QA-009 — a storefront address with no restaurant in it (e.g. the bare order.garnishtable.com/).
 *  Used to be one line of muted text under a "R / Restaurant" placeholder header. Customers who
 *  land here usually want their order or a restaurant's link; restaurant owners want the product. */
export function NoRestaurantPage() {
  useNoIndex();
  const { user } = useAuth();
  const onPlatformHost = isPlatformStorefrontHost(window.location.hostname, import.meta.env.VITE_SITE_URL);

  useEffect(() => {
    const previousTitle = document.title;
    document.title = onPlatformHost ? `${PLATFORM_BRAND_NAME} online ordering` : "Choose a restaurant";
    return () => {
      document.title = previousTitle;
    };
  }, [onPlatformHost]);

  return (
    <div className="mx-auto flex max-w-xl flex-col items-center gap-4 py-16 text-center">
      <h1 className="font-heading text-3xl font-semibold text-foreground text-balance">Open your restaurant's ordering link</h1>
      <p className="text-muted">
        This address doesn't point to a restaurant. Use the link or QR code the restaurant shared with you
        {user ? ", or find a past order below." : ", or sign in to see your past orders."}
      </p>
      <div className="flex flex-wrap justify-center gap-2">
        <Link to={user ? "/orders" : "/login"}>
          <Button>{user ? "My orders" : "Sign in"}</Button>
        </Link>
        {onPlatformHost && MARKETING_URL && (
          <a href={MARKETING_URL}>
            <Button variant="outline">I run a restaurant</Button>
          </a>
        )}
      </div>
    </div>
  );
}
