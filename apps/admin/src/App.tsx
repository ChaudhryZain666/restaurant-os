import { Route, Routes } from "react-router-dom";
import { Layout } from "./components/Layout";
import { RequireAuth } from "./components/RequireAuth";
import { LoginPage } from "./pages/LoginPage";
import { ForgotPasswordPage } from "./pages/ForgotPasswordPage";
import { ResetPasswordPage } from "./pages/ResetPasswordPage";
import { AcceptInvitePage } from "./pages/AcceptInvitePage";
import { DashboardPage } from "./pages/DashboardPage";
import { MenuManagementPage } from "./pages/MenuManagementPage";
import { MenuImportPage } from "./pages/MenuImportPage";
import { DeliveryPage } from "./pages/DeliveryPage";
import { CustomersPage } from "./pages/CustomersPage";
import { LoyaltyPage } from "./pages/LoyaltyPage";
import { StaffPage } from "./pages/StaffPage";
import { PromotionsPage } from "./pages/PromotionsPage";
import { BusinessPromotionsPage } from "./pages/BusinessPromotionsPage";
import { OrdersManagementPage } from "./pages/OrdersManagementPage";
import { KitchenPage } from "./pages/KitchenPage";
import { TablesPage } from "./pages/TablesPage";
import { AnalyticsPage } from "./pages/AnalyticsPage";
import { BusinessAnalyticsPage } from "./pages/BusinessAnalyticsPage";
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
import { LocationsPage } from "./pages/LocationsPage";
import { PrintOrderPage } from "./pages/PrintOrderPage";
import { BillingPage } from "./pages/BillingPage";
import { PlatformSubscriptionsPage } from "./pages/PlatformSubscriptionsPage";
import { PlatformAnalyticsPage } from "./pages/PlatformAnalyticsPage";
import { SystemConfigPage } from "./pages/SystemConfigPage";
import { RegisterPage } from "./pages/RegisterPage";
import { AgencySignupWizardPage } from "./pages/AgencySignupWizardPage";
import { AcceptAgencyInvitePage } from "./pages/AcceptAgencyInvitePage";
import { AgencyDashboardPage } from "./pages/AgencyDashboardPage";
import { AgencyBusinessesPage } from "./pages/AgencyBusinessesPage";
import { AgencyMembersPage } from "./pages/AgencyMembersPage";
import { AgencyBillingPage } from "./pages/AgencyBillingPage";
import { AgencyBusinessDetailPage } from "./pages/AgencyBusinessDetailPage";
import { MockCheckoutPage } from "./pages/MockCheckoutPage";
import { ForcePasswordChangePage } from "./pages/ForcePasswordChangePage";

const AGENCY_ROLES = ["agency_member", "customer"] as const;

// Every route below either gates on `permission` — matching the exact backend permission its
// page's own API calls require, read from the single ROLE_PERMISSIONS source of truth in
// @restaurant/types — or, where a route has no single natural backend permission (the still-unbuilt
// platform PlaceholderPage stubs: no backend endpoint exists yet to derive a permission from), falls
// back to `roles`. See RequireAuth.tsx and Layout.tsx's NavGroupList for the matching nav-visibility
// half of this.
//
// Phase 26 — Dashboard/Kitchen/Print used to gate on a bare `roles: RESTAURANT_ROLES` array. That
// meant an agency_member acting inside a managed business (whose own site-wide `role` never becomes
// "restaurant_owner" etc.) could never pass them no matter what their agency role granted. Converted
// to `permission` (a permission every previously-guarded role already holds, so zero behavior change
// for existing accounts) so RequireAuth's single agency-aware permission check covers all three —
// see RequireAuth.tsx's doc comment for exactly how an agency member's effective permission set is
// computed while acting inside a business.
export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      <Route path="/accept-invite" element={<AcceptInvitePage />} />
      <Route path="/register" element={<RegisterPage />} />
      {/* Phase 28 — the plan-first agency signup wizard, additive to /register (unchanged, still
          exercised directly by e2e/agency-management.spec.ts). */}
      <Route path="/start" element={<AgencySignupWizardPage />} />
      <Route path="/accept-agency-invite" element={<AcceptAgencyInvitePage />} />
      {/* Phase 27 — public, keyed by the opaque checkout token alone; only ever reachable when
          BILLING_PROVIDER=mock (the API returns this path only from the mock provider). */}
      <Route path="/mock-checkout/:token" element={<MockCheckoutPage />} />
      {/* Phase 28 — no permission/roles gate (any authenticated identity can land here); RequireAuth
          itself is what forces every OTHER route to redirect here while mustChangePassword is true.
          No <Layout> wrapper, same reasoning as /print/:mode/:id — this is a standalone interstitial,
          not a page with nav. */}
      <Route
        path="/force-password-change"
        element={
          <RequireAuth>
            <ForcePasswordChangePage />
          </RequireAuth>
        }
      />
      {/* No <Layout> wrapper — this route IS the printable content (Phase 14), opened in a new
          tab via window.open from an order card's Print action. */}
      <Route
        path="/print/:mode/:id"
        element={
          <RequireAuth permission="restaurant.orders.read" allowPlatformAdmin>
            <PrintOrderPage />
          </RequireAuth>
        }
      />
      <Route element={<Layout />}>
        <Route
          path="/"
          element={
            <RequireAuth permission="restaurant.orders.read">
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
            <RequireAuth permission="restaurant.orders.manage">
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
          path="/menu/import"
          element={
            <RequireAuth permission="restaurant.menu.write">
              <MenuImportPage />
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
          path="/business-promotions"
          element={
            <RequireAuth permission="restaurant.promotions.manage">
              <BusinessPromotionsPage />
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
          path="/business-analytics"
          element={
            <RequireAuth permission="restaurant.analytics.read">
              <BusinessAnalyticsPage />
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
          path="/billing"
          element={
            <RequireAuth permission="billing.read">
              <BillingPage />
            </RequireAuth>
          }
        />
        <Route
          path="/agency"
          element={
            <RequireAuth roles={[...AGENCY_ROLES]}>
              <AgencyDashboardPage />
            </RequireAuth>
          }
        />
        <Route
          path="/agency/businesses"
          element={
            <RequireAuth roles={[...AGENCY_ROLES]}>
              <AgencyBusinessesPage />
            </RequireAuth>
          }
        />
        <Route
          path="/agency/businesses/:businessId"
          element={
            <RequireAuth roles={[...AGENCY_ROLES]}>
              <AgencyBusinessDetailPage />
            </RequireAuth>
          }
        />
        <Route
          path="/agency/members"
          element={
            <RequireAuth roles={[...AGENCY_ROLES]}>
              <AgencyMembersPage />
            </RequireAuth>
          }
        />
        <Route
          path="/agency/billing"
          element={
            <RequireAuth roles={[...AGENCY_ROLES]}>
              <AgencyBillingPage />
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
          path="/locations"
          element={
            <RequireAuth permission="restaurant.settings.manage">
              <LocationsPage />
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
              <PlatformSubscriptionsPage />
            </RequireAuth>
          }
        />
        <Route
          path="/platform/analytics"
          element={
            <RequireAuth roles={["platform_admin"]}>
              <PlatformAnalyticsPage />
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
              <SystemConfigPage />
            </RequireAuth>
          }
        />
      </Route>
    </Routes>
  );
}
