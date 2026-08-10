import { Link, Outlet } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

const RESTAURANT_NAV = [
  { to: "/", label: "Dashboard" },
  { to: "/orders", label: "Orders" },
  { to: "/menu", label: "Menu" },
  { to: "/customers", label: "Customers" },
  { to: "/delivery", label: "Delivery" },
  { to: "/promotions", label: "Promotions" },
  { to: "/analytics", label: "Analytics" },
  { to: "/staff", label: "Staff" },
  { to: "/settings", label: "Settings" },
];

const PLATFORM_NAV = [
  { to: "/platform/restaurants", label: "Restaurants" },
  { to: "/platform/users", label: "Users" },
  { to: "/platform/subscriptions", label: "Subscriptions" },
  { to: "/platform/analytics", label: "Platform analytics" },
  { to: "/platform/support", label: "Support" },
  { to: "/platform/settings", label: "System configuration" },
];

export function Layout() {
  const { user, logout } = useAuth();
  const isPlatformAdmin = user?.role === "platform_admin";
  const isRestaurantScoped = user && !isPlatformAdmin;

  return (
    <div className="flex min-h-screen">
      <aside className="w-56 shrink-0 border-r bg-slate-50 p-4">
        <div className="mb-6 font-semibold">Restaurant Admin</div>
        {isRestaurantScoped && (
          <nav className="flex flex-col gap-1 text-sm">
            {RESTAURANT_NAV.map((item) => (
              <Link key={item.to} to={item.to} className="rounded px-2 py-1 hover:bg-slate-200">
                {item.label}
              </Link>
            ))}
          </nav>
        )}
        {isPlatformAdmin && (
          <nav className="flex flex-col gap-1 text-sm">
            <div className="mt-2 px-2 text-xs uppercase tracking-wide text-slate-400">Platform</div>
            {PLATFORM_NAV.map((item) => (
              <Link key={item.to} to={item.to} className="rounded px-2 py-1 hover:bg-slate-200">
                {item.label}
              </Link>
            ))}
          </nav>
        )}
      </aside>
      <div className="flex-1">
        <header className="flex items-center justify-end gap-3 border-b p-4 text-sm">
          {user && (
            <>
              <span>
                {user.name} · {user.role}
              </span>
              <button onClick={() => logout()} className="rounded border px-3 py-1 hover:bg-slate-100">
                Log out
              </button>
            </>
          )}
        </header>
        <main className="p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
