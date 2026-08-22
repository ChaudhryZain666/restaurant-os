import { Navigate, Route, Routes, useParams } from "react-router-dom";
import { Layout } from "./components/Layout";
import { RequireAuth } from "./components/RequireAuth";
import { legacyDefaultSlug, useRestaurant } from "./context/RestaurantContext";
import { MenuPage } from "./pages/MenuPage";
import { CartPage } from "./pages/CartPage";
import { LoginPage } from "./pages/LoginPage";
import { RegisterPage } from "./pages/RegisterPage";
import { ForgotPasswordPage } from "./pages/ForgotPasswordPage";
import { ResetPasswordPage } from "./pages/ResetPasswordPage";
import { ConfirmEmailChangePage } from "./pages/ConfirmEmailChangePage";
import { OrdersPage } from "./pages/OrdersPage";
import { OrderDetailPage } from "./pages/OrderDetailPage";
import { AccountPage } from "./pages/AccountPage";
import { LoyaltyPage } from "./pages/LoyaltyPage";
import { SupportCenterPage } from "./pages/SupportCenterPage";
import { ArticleDetailPage } from "./pages/ArticleDetailPage";
import { MyTicketsPage } from "./pages/MyTicketsPage";
import { CreateTicketPage } from "./pages/CreateTicketPage";
import { TicketDetailPage } from "./pages/TicketDetailPage";
import { PrintReceiptPage } from "./pages/PrintReceiptPage";

/**
 * Handles every bare storefront-shaped route (`/`, `/cart`, `/t/:tableToken`, `/loyalty`) — which
 * today means one of two things, decided by RestaurantContext:
 *
 * 1. **Phase 22 — an active custom domain**: `window.location.hostname` resolved to a real
 *    Location via `GET /restaurants/by-domain/:hostname`. Renders the real target page (MenuPage/
 *    CartPage/LoyaltyPage) directly — no redirect, no `/r/:slug` ever shown to the customer. This
 *    is the whole point of white-labeling: the URL bar shows the restaurant's own domain, nothing
 *    platform-shaped.
 * 2. **Phase 8 (unchanged) — a pre-Phase-8 bare link** (bookmarked, or a physically printed Phase 7
 *    QR code) on a deployment with no active custom domain for this hostname: forwards to the
 *    canonical `/r/:restaurantSlug/...` equivalent via VITE_RESTAURANT_SLUG, so nothing already
 *    handed to a real customer becomes a dead link. A client-side redirect (not a second route
 *    rendering the same page) — see docs/multi-tenant-storefront-architecture.md's SEO section for
 *    why duplicate indexable URLs are avoided.
 *
 * `suffix` is appended as-is for case 2 (e.g. "/cart"); the special "t" case additionally forwards
 * the :tableToken param.
 */
function LegacyRedirect({ suffix }: { suffix: string }) {
  const { tableToken } = useParams<{ tableToken?: string }>();
  const { restaurant, loading, resolvedVia } = useRestaurant();

  // Domain resolution (or its definitive failure) hasn't finished yet — render nothing rather than
  // redirecting prematurely into a guess.
  if (loading) return null;

  if (resolvedVia === "domain" && restaurant) {
    if (suffix === "/cart") return <CartPage />;
    if (suffix === "/loyalty") {
      return (
        <RequireAuth>
          <LoyaltyPage />
        </RequireAuth>
      );
    }
    // suffix === "" (root) or "/t" (QR table landing) — both render MenuPage, exactly like their
    // /r/:slug and /r/:slug/t/:tableToken equivalents; TableContext resolves :tableToken from the
    // URL independently of restaurant identity.
    return <MenuPage />;
  }

  const defaultSlug = legacyDefaultSlug();
  if (!defaultSlug) {
    // No VITE_RESTAURANT_SLUG configured for this deployment, and no active custom domain matched
    // this hostname either — silently redirecting into a guessed restaurant slug that likely
    // doesn't exist would be worse than this honest message (Phase 13 audit finding: this used to
    // fall back to "demo-restaurant" unconditionally).
    return (
      <div className="flex min-h-svh items-center justify-center px-4 text-center text-muted">
        <p>This link doesn't specify a restaurant. Please use the restaurant's own storefront link.</p>
      </div>
    );
  }
  const target = `/r/${defaultSlug}${suffix}${tableToken ? `/${tableToken}` : ""}`;
  return <Navigate to={target} replace />;
}

export function App() {
  return (
    <Routes>
      {/* No <Layout> wrapper — this route IS the printable content (Phase 14), opened in a new
          tab from the order tracking page's Print action. */}
      <Route
        path="/orders/:id/receipt"
        element={
          <RequireAuth>
            <PrintReceiptPage />
          </RequireAuth>
        }
      />
      <Route element={<Layout />}>
        {/* Restaurant-scoped storefront — canonical URLs. */}
        <Route path="/r/:restaurantSlug" element={<MenuPage />} />
        {/* Reuses MenuPage — the QR just adds table context (see TableContext), the menu itself
            is identical to the regular storefront. */}
        <Route path="/r/:restaurantSlug/t/:tableToken" element={<MenuPage />} />
        {/* Authenticated owner/platform_admin preview (Phase 14) — reuses MenuPage too. Works even
            while the restaurant is still "pending"; RestaurantContext detects this route and
            fetches from the preview endpoint instead of the public one. */}
        <Route path="/r/:restaurantSlug/preview" element={<MenuPage />} />
        <Route path="/r/:restaurantSlug/cart" element={<CartPage />} />
        <Route
          path="/r/:restaurantSlug/loyalty"
          element={
            <RequireAuth>
              <LoyaltyPage />
            </RequireAuth>
          }
        />

        {/* Legacy bare URLs — forward to the env-configured default restaurant's canonical URL. */}
        <Route path="/" element={<LegacyRedirect suffix="" />} />
        <Route path="/cart" element={<LegacyRedirect suffix="/cart" />} />
        <Route path="/t/:tableToken" element={<LegacyRedirect suffix="/t" />} />
        <Route path="/loyalty" element={<LegacyRedirect suffix="/loyalty" />} />

        {/* Account/platform-level — not tied to any one restaurant. */}
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        {/* Public, like /reset-password — the token in the link IS the credential (see
            auth.controller.ts's confirmEmailChange). The link is sent to the NEW inbox, which
            isn't necessarily the same device/browser the user is currently logged in on. */}
        <Route path="/confirm-email-change" element={<ConfirmEmailChangePage />} />
        <Route
          path="/orders"
          element={
            <RequireAuth>
              <OrdersPage />
            </RequireAuth>
          }
        />
        <Route
          path="/orders/:id"
          element={
            <RequireAuth>
              <OrderDetailPage />
            </RequireAuth>
          }
        />
        <Route
          path="/account"
          element={
            <RequireAuth>
              <AccountPage />
            </RequireAuth>
          }
        />
        <Route path="/support" element={<SupportCenterPage />} />
        <Route path="/support/articles/:slug" element={<ArticleDetailPage />} />
        <Route
          path="/support/tickets"
          element={
            <RequireAuth>
              <MyTicketsPage />
            </RequireAuth>
          }
        />
        <Route
          path="/support/tickets/new"
          element={
            <RequireAuth>
              <CreateTicketPage />
            </RequireAuth>
          }
        />
        <Route
          path="/support/tickets/:id"
          element={
            <RequireAuth>
              <TicketDetailPage />
            </RequireAuth>
          }
        />
      </Route>
    </Routes>
  );
}
