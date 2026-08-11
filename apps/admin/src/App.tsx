import { Route, Routes } from "react-router-dom";
import { Layout } from "./components/Layout";
import { RequireAuth } from "./components/RequireAuth";
import { LoginPage } from "./pages/LoginPage";
import { PlaceholderPage } from "./pages/PlaceholderPage";
import { MenuManagementPage } from "./pages/MenuManagementPage";
import { OrdersManagementPage } from "./pages/OrdersManagementPage";
import { SettingsPage } from "./pages/SettingsPage";

const RESTAURANT_ROLES = [
  "restaurant_owner",
  "restaurant_manager",
  "restaurant_staff",
  "kitchen_staff",
] as const;

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<Layout />}>
        <Route
          path="/"
          element={
            <RequireAuth roles={[...RESTAURANT_ROLES]}>
              <PlaceholderPage title="Dashboard" description="Restaurant overview — coming in a later phase." />
            </RequireAuth>
          }
        />
        <Route
          path="/orders"
          element={
            <RequireAuth roles={[...RESTAURANT_ROLES]}>
              <OrdersManagementPage />
            </RequireAuth>
          }
        />
        <Route
          path="/menu"
          element={
            <RequireAuth roles={[...RESTAURANT_ROLES]}>
              <MenuManagementPage />
            </RequireAuth>
          }
        />
        <Route
          path="/customers"
          element={
            <RequireAuth roles={[...RESTAURANT_ROLES]}>
              <PlaceholderPage title="Customers" description="Customer CRM — coming in a later phase." />
            </RequireAuth>
          }
        />
        <Route
          path="/delivery"
          element={
            <RequireAuth roles={[...RESTAURANT_ROLES]}>
              <PlaceholderPage title="Delivery" description="Delivery zones and dispatch — coming in a later phase." />
            </RequireAuth>
          }
        />
        <Route
          path="/promotions"
          element={
            <RequireAuth roles={[...RESTAURANT_ROLES]}>
              <PlaceholderPage title="Promotions" description="Promotions and campaigns — coming in a later phase." />
            </RequireAuth>
          }
        />
        <Route
          path="/analytics"
          element={
            <RequireAuth roles={[...RESTAURANT_ROLES]}>
              <PlaceholderPage title="Analytics" description="Restaurant analytics — coming in a later phase." />
            </RequireAuth>
          }
        />
        <Route
          path="/staff"
          element={
            <RequireAuth roles={["restaurant_owner", "restaurant_manager"]}>
              <PlaceholderPage title="Staff" description="Staff management — coming in a later phase." />
            </RequireAuth>
          }
        />
        <Route
          path="/settings"
          element={
            <RequireAuth roles={["restaurant_owner"]}>
              <SettingsPage />
            </RequireAuth>
          }
        />

        <Route
          path="/platform/restaurants"
          element={
            <RequireAuth roles={["platform_admin"]}>
              <PlaceholderPage title="Restaurants" description="All platform restaurants — coming in a later phase." />
            </RequireAuth>
          }
        />
        <Route
          path="/platform/users"
          element={
            <RequireAuth roles={["platform_admin"]}>
              <PlaceholderPage title="Users" description="Platform-wide user management — coming in a later phase." />
            </RequireAuth>
          }
        />
        <Route
          path="/platform/subscriptions"
          element={
            <RequireAuth roles={["platform_admin"]}>
              <PlaceholderPage title="Subscriptions" description="Billing and subscriptions — coming in a later phase." />
            </RequireAuth>
          }
        />
        <Route
          path="/platform/analytics"
          element={
            <RequireAuth roles={["platform_admin"]}>
              <PlaceholderPage title="Platform analytics" description="Cross-restaurant analytics — coming in a later phase." />
            </RequireAuth>
          }
        />
        <Route
          path="/platform/support"
          element={
            <RequireAuth roles={["platform_admin"]}>
              <PlaceholderPage title="Support" description="Platform support tools — coming in a later phase." />
            </RequireAuth>
          }
        />
        <Route
          path="/platform/settings"
          element={
            <RequireAuth roles={["platform_admin"]}>
              <PlaceholderPage title="System configuration" description="Platform-wide configuration — coming in a later phase." />
            </RequireAuth>
          }
        />
      </Route>
    </Routes>
  );
}
