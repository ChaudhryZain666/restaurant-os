import { Route, Routes } from "react-router-dom";
import { Layout } from "./components/Layout";
import { RequireAuth } from "./components/RequireAuth";
import { LoginPage } from "./pages/LoginPage";
import { ForgotPasswordPage } from "./pages/ForgotPasswordPage";
import { ResetPasswordPage } from "./pages/ResetPasswordPage";
import { AcceptInvitePage } from "./pages/AcceptInvitePage";
import { DashboardPage } from "./pages/DashboardPage";
import { PlaceholderPage } from "./pages/PlaceholderPage";
import { MenuManagementPage } from "./pages/MenuManagementPage";
import { DeliveryPage } from "./pages/DeliveryPage";
import { CustomersPage } from "./pages/CustomersPage";
import { LoyaltyPage } from "./pages/LoyaltyPage";
import { StaffPage } from "./pages/StaffPage";
import { PromotionsPage } from "./pages/PromotionsPage";
import { OrdersManagementPage } from "./pages/OrdersManagementPage";
import { KitchenPage } from "./pages/KitchenPage";
import { TablesPage } from "./pages/TablesPage";
import { AnalyticsPage } from "./pages/AnalyticsPage";
import { SettingsPage } from "./pages/SettingsPage";
import { RestaurantSupportPage } from "./pages/RestaurantSupportPage";
import { RestaurantTicketDetailPage } from "./pages/RestaurantTicketDetailPage";
import { SupportDashboardPage } from "./pages/SupportDashboardPage";
import { SupportTicketDetailPage } from "./pages/SupportTicketDetailPage";
import { KnowledgeBaseAdminPage } from "./pages/KnowledgeBaseAdminPage";
import { AuditLogPage } from "./pages/AuditLogPage";
import { PlatformDashboardPage } from "./pages/PlatformDashboardPage";
import { PlatformRestaurantsPage } from "./pages/PlatformRestaurantsPage";
import { PlatformRestaurantDetailPage } from "./pages/PlatformRestaurantDetailPage";
import { CreateRestaurantPage } from "./pages/CreateRestaurantPage";
import { PlatformUsersPage } from "./pages/PlatformUsersPage";
import { SetupPage } from "./pages/SetupPage";
import { PrintOrderPage } from "./pages/PrintOrderPage";

const RESTAURANT_ROLES = [
  "restaurant_owner",
  "restaurant_manager",
  "restaurant_staff",
  "kitchen_staff",
] as const;

// Every route below either gates on `permission` — matching the exact backend permission its
// page's own API calls require, read from the single ROLE_PERMISSIONS source of truth in
// @restaurant/types — or, where a route has no single natural backend permission (Dashboard,
// Kitchen: visible to every restaurant-scoped role; the still-unbuilt platform PlaceholderPage
// stubs: no backend endpoint exists yet to derive a permission from), falls back to `roles`. See
// RequireAuth.tsx and Layout.tsx's NavGroupList for the matching nav-visibility half of this.
export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      <Route path="/accept-invite" element={<AcceptInvitePage />} />
      {/* No <Layout> wrapper — this route IS the printable content (Phase 14), opened in a new
          tab via window.open from an order card's Print action. */}
      <Route
        path="/print/:mode/:id"
        element={
          <RequireAuth roles={[...RESTAURANT_ROLES, "platform_admin"]}>
            <PrintOrderPage />
          </RequireAuth>
        }
      />
      <Route element={<Layout />}>
        <Route
          path="/"
          element={
            <RequireAuth roles={[...RESTAURANT_ROLES]}>
              <DashboardPage />
            </RequireAuth>
          }
        />
        <Route
          path="/orders"
          element={
            <RequireAuth permission="restaurant.orders.read">
              <OrdersManagementPage />
            </RequireAuth>
          }
        />
        <Route
          path="/kitchen"
          element={
            <RequireAuth roles={[...RESTAURANT_ROLES]}>
              <KitchenPage />
            </RequireAuth>
          }
        />
        <Route
          path="/menu"
          element={
            <RequireAuth permission="restaurant.menu.read">
              <MenuManagementPage />
            </RequireAuth>
          }
        />
        <Route
          path="/customers"
          element={
            <RequireAuth permission="restaurant.orders.read">
              <CustomersPage />
            </RequireAuth>
          }
        />
        <Route
          path="/delivery"
          element={
            <RequireAuth permission="restaurant.settings.manage">
              <DeliveryPage />
            </RequireAuth>
          }
        />
        <Route
          path="/tables"
          element={
            <RequireAuth permission="restaurant.tables.manage">
              <TablesPage />
            </RequireAuth>
          }
        />
        <Route
          path="/promotions"
          element={
            <RequireAuth permission="restaurant.promotions.manage">
              <PromotionsPage />
            </RequireAuth>
          }
        />
        <Route
          path="/loyalty"
          element={
            <RequireAuth permission="restaurant.analytics.read">
              <LoyaltyPage />
            </RequireAuth>
          }
        />
        <Route
          path="/analytics"
          element={
            <RequireAuth permission="restaurant.analytics.read">
              <AnalyticsPage />
            </RequireAuth>
          }
        />
        <Route
          path="/staff"
          element={
            <RequireAuth permission="restaurant.staff.manage">
              <StaffPage />
            </RequireAuth>
          }
        />
        <Route
          path="/support"
          element={
            <RequireAuth permission="support.tickets.read">
              <RestaurantSupportPage />
            </RequireAuth>
          }
        />
        <Route
          path="/support/:id"
          element={
            <RequireAuth permission="support.tickets.read">
              <RestaurantTicketDetailPage />
            </RequireAuth>
          }
        />
        <Route
          path="/settings"
          element={
            <RequireAuth permission="restaurant.settings.manage">
              <SettingsPage />
            </RequireAuth>
          }
        />
        <Route
          path="/audit-log"
          element={
            <RequireAuth permission="restaurant.audit.read">
              <AuditLogPage />
            </RequireAuth>
          }
        />

        <Route
          path="/platform"
          element={
            <RequireAuth permission="platform.restaurants.manage">
              <PlatformDashboardPage />
            </RequireAuth>
          }
        />
        <Route
          path="/platform/restaurants"
          element={
            <RequireAuth permission="platform.restaurants.manage">
              <PlatformRestaurantsPage />
            </RequireAuth>
          }
        />
        <Route
          path="/platform/restaurants/new"
          element={
            <RequireAuth permission="platform.restaurants.manage">
              <CreateRestaurantPage />
            </RequireAuth>
          }
        />
        <Route
          path="/platform/restaurants/:id"
          element={
            <RequireAuth permission="platform.restaurants.manage">
              <PlatformRestaurantDetailPage />
            </RequireAuth>
          }
        />
        <Route
          path="/setup"
          element={
            <RequireAuth permission="restaurant.settings.manage">
              <SetupPage />
            </RequireAuth>
          }
        />
        <Route
          path="/platform/users"
          element={
            <RequireAuth permission="platform.users.manage">
              <PlatformUsersPage />
            </RequireAuth>
          }
        />
        <Route
          path="/platform/subscriptions"
          element={
            <RequireAuth roles={["platform_admin"]}>
              <PlaceholderPage
                title="Subscriptions"
                description="Billing plans, subscription status and payment history per restaurant."
                whyItMatters="No billing or payment-processing integration exists yet anywhere on the platform — this depends on that being built first."
              />
            </RequireAuth>
          }
        />
        <Route
          path="/platform/analytics"
          element={
            <RequireAuth roles={["platform_admin"]}>
              <PlaceholderPage
                title="Platform analytics"
                description="Cross-restaurant totals and trends — total orders, revenue and growth across every tenant."
                whyItMatters="Today's analytics endpoint only returns numbers scoped to one restaurant at a time; a platform-wide view needs a new aggregation endpoint."
              />
            </RequireAuth>
          }
        />
        <Route
          path="/platform/support"
          element={
            <RequireAuth permission="support.tickets.read">
              <SupportDashboardPage />
            </RequireAuth>
          }
        />
        <Route
          path="/platform/support/tickets/:id"
          element={
            <RequireAuth permission="support.tickets.read">
              <SupportTicketDetailPage />
            </RequireAuth>
          }
        />
        <Route
          path="/platform/support/kb"
          element={
            <RequireAuth permission="support.knowledgebase.write">
              <KnowledgeBaseAdminPage />
            </RequireAuth>
          }
        />
        <Route
          path="/platform/settings"
          element={
            <RequireAuth roles={["platform_admin"]}>
              <PlaceholderPage
                title="System configuration"
                description="Platform-wide defaults and toggles — not a single restaurant's settings, but the rules the whole platform runs on."
                whyItMatters="Each restaurant already configures its own ordering rules; this would be for platform-level defaults and feature flags across all of them."
              />
            </RequireAuth>
          }
        />
      </Route>
    </Routes>
  );
}
