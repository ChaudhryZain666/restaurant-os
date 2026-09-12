import { useEffect, useState } from "react";
import { useNavigate, NavLink, Outlet } from "react-router-dom";
import { useToast } from "@restaurant/ui";
import { useAuth } from "../context/AuthContext";
import { useLocation as useActiveLocation } from "../context/LocationContext";
import { RestaurantSettingsProvider, useRestaurantSettings } from "../context/RestaurantSettingsContext";
import { useRestaurantOrderEvents } from "../hooks/useRestaurantOrderEvents";
import { IconArrowLeft, IconClipboard, IconClock, IconLock, IconRegister, IconTable, IconUsers } from "../components/icons";
import { LockScreen } from "./components/LockScreen";

/** Phase 73 — sessionStorage (not localStorage): a locked terminal should demand re-auth again
 *  after this browser tab is closed and reopened, but shouldn't need a second, independent
 *  "remember to lock it" mechanism from the one the OS/browser session already provides. Keyed
 *  per-tab by design (sessionStorage's own semantics), not per-user — the point is "is THIS
 *  terminal currently locked," not which account locked it. */
const LOCK_KEY = "pos.locked";

/** Phase 75 — a per-device preference (localStorage, like LOCK_KEY's own sessionStorage), not a
 *  server-side/Restaurant.settings field: this is "how long before THIS screen locks itself,"
 *  not a business policy that needs to sync across devices — the same reasoning that kept Phase
 *  74 from inventing a persistent terminal/device entity applies here too. Off (0) by default —
 *  the safest choice for every existing deployment, which had no idle-lock behavior at all before
 *  this phase. */
const IDLE_TIMEOUT_KEY = "pos.idleTimeoutMinutes";
const IDLE_TIMEOUT_OPTIONS = [
  { minutes: 0, label: "Off" },
  { minutes: 5, label: "5 minutes" },
  { minutes: 10, label: "10 minutes" },
  { minutes: 15, label: "15 minutes" },
  { minutes: 30, label: "30 minutes" },
];

/**
 * Dedicated POS application shell — a genuinely separate frontend surface from the admin portal's
 * <Layout> (long sidebar, dashboard chrome), while sharing every bit of the underlying platform:
 * the same AuthProvider/BusinessProvider/LocationProvider (all mounted above <App/> in main.tsx,
 * so they're already available here with zero extra wiring — see main.tsx), the same API client,
 * the same permission (restaurant.pos.operate, checked by RequireAuth in App.tsx exactly like any
 * other route), the same RestaurantSettingsProvider pattern <Layout> itself uses (for posEnabled +
 * currency), and the same Socket.IO order-event stream <Layout> subscribes to (replicated here so
 * "new order received" toasts still fire while a cashier is in the POS, not just in the admin).
 *
 * This is the one seam between "manage the business" (admin <Layout>) and "run the register"
 * (this shell) — Layout.tsx's nav keeps a single "POS" link into here, and this shell's own nav
 * rail keeps a single "Exit to Admin" link back — never a dead end either direction.
 */
export function POSLayout() {
  return (
    <RestaurantSettingsProvider>
      <POSLayoutContent />
    </RestaurantSettingsProvider>
  );
}

const NAV_ITEMS = [
  { to: "/pos", label: "Register", icon: IconRegister, end: true },
  { to: "/pos/tables", label: "Tables", icon: IconTable },
  { to: "/pos/customers", label: "Customers", icon: IconUsers },
  { to: "/pos/orders", label: "Orders", icon: IconClipboard },
  // Phase 75 — deliberately its own nav destination, not folded into "Orders": Orders is a
  // read-only reference list of everything; Pending is the actionable recovery surface (Resume/
  // Cancel) for specifically unpaid POS sales — see PendingSalesPage.tsx.
  { to: "/pos/pending", label: "Pending", icon: IconClock },
];

function navLinkClass({ isActive }: { isActive: boolean }) {
  return [
    "group relative flex flex-col items-center gap-1 rounded-xl px-2 py-2.5 text-[11px] font-medium transition-colors duration-fast",
    isActive ? "bg-white/10 text-primary" : "text-white/55 hover:bg-white/5 hover:text-white/85",
  ].join(" ");
}

function POSLayoutContent() {
  const { user, logout } = useAuth();
  const { locations, activeLocationId, switchLocation } = useActiveLocation();
  const { restaurant } = useRestaurantSettings();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const [locked, setLocked] = useState(() => sessionStorage.getItem(LOCK_KEY) === "1");
  const [idleTimeoutMinutes, setIdleTimeoutMinutes] = useState(() => Number(localStorage.getItem(IDLE_TIMEOUT_KEY) ?? "0") || 0);

  useEffect(() => {
    if (locked) sessionStorage.setItem(LOCK_KEY, "1");
    else sessionStorage.removeItem(LOCK_KEY);
  }, [locked]);

  useEffect(() => {
    localStorage.setItem(IDLE_TIMEOUT_KEY, String(idleTimeoutMinutes));
  }, [idleTimeoutMinutes]);

  // Phase 75 — auto-lock after real mouse/keyboard/touch inactivity. Deliberately disabled while
  // already locked: the register underneath is `inert` (no events reach it), and there is nothing
  // useful for an idle timer to do until it's unlocked again — starting one here would just be
  // dead weight, not a race, since LockScreen's own inputs aren't tracked by this listener anyway.
  // Never touches `pendingPaymentOrder`/in-flight payment state — locking only ever mounts the
  // LockScreen overlay alongside the existing register tree (see the JSX below), so an in-flight
  // terminal-payment poll (TerminalCardPayment.tsx) keeps running underneath exactly as it does
  // during a manual lock.
  useEffect(() => {
    if (locked || idleTimeoutMinutes <= 0) return;
    let timer: ReturnType<typeof setTimeout>;
    function reset() {
      clearTimeout(timer);
      timer = setTimeout(() => setLocked(true), idleTimeoutMinutes * 60_000);
    }
    const events: Array<keyof WindowEventMap> = ["mousemove", "keydown", "touchstart", "click"];
    events.forEach((event) => window.addEventListener(event, reset, { passive: true }));
    reset();
    return () => {
      clearTimeout(timer);
      events.forEach((event) => window.removeEventListener(event, reset));
    };
  }, [locked, idleTimeoutMinutes]);

  useRestaurantOrderEvents((event) => {
    if (event.type !== "order.created") return;
    showToast({
      title: "New order received",
      description: `Order #${event.orderNumber}`,
      action: { label: "View", onClick: () => navigate("/pos/orders") },
    });
  });

  const activeLocation = locations.find((l) => l.id === activeLocationId);
  const locationName = activeLocation?.name ?? restaurant?.name ?? "";

  return (
    <div className="flex h-svh flex-col overflow-hidden bg-background text-foreground">
      {/* Slim top strip — location + staff context. Deliberately not a full admin header (no
          hamburger, no big search, no notification bell): just enough operational awareness. */}
      <header className="flex h-12 shrink-0 items-center justify-between border-b border-border bg-surface px-4">
        <div className="flex min-w-0 items-center gap-2">
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-success" aria-hidden />
          {locations.length > 1 ? (
            <select
              value={activeLocationId ?? ""}
              onChange={(e) => switchLocation(e.target.value)}
              aria-label="Active location"
              className="truncate bg-transparent text-sm font-medium text-foreground focus-visible:outline-none"
            >
              {locations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          ) : (
            <span className="truncate text-sm font-medium text-foreground">{locationName}</span>
          )}
        </div>
        <div className="flex items-center gap-3">
          <span className="hidden text-sm text-muted sm:inline">{user?.name}</span>
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-secondary text-xs font-semibold text-secondary-foreground">
            {user?.name?.[0]?.toUpperCase() ?? "?"}
          </span>
          <label className="hidden items-center gap-1 text-xs text-muted md:flex">
            Auto-lock
            <select
              value={idleTimeoutMinutes}
              onChange={(e) => setIdleTimeoutMinutes(Number(e.target.value))}
              aria-label="Auto-lock after inactivity"
              className="rounded-md border border-border bg-background px-1.5 py-1 text-xs font-medium text-foreground"
            >
              {IDLE_TIMEOUT_OPTIONS.map((opt) => (
                <option key={opt.minutes} value={opt.minutes}>
                  {opt.label}
                </option>
              ))}
            </select>
          </label>
          <button
            onClick={() => setLocked(true)}
            aria-label="Lock POS"
            className="flex items-center gap-1 text-xs font-medium text-muted hover:text-foreground"
          >
            <IconLock className="h-3.5 w-3.5" />
            Lock
          </button>
          <button
            onClick={() => logout()}
            aria-label="Log out"
            className="text-xs font-medium text-muted hover:text-foreground"
          >
            Log out
          </button>
        </div>
      </header>

      {locked && <LockScreen onUnlock={() => setLocked(false)} />}

      <div className="flex min-h-0 flex-1" inert={locked}>
        {/* The nav rail — narrow, dark, operational. Deliberately the opposite of Layout.tsx's
            240px labeled-group sidebar: four destinations, icon-first, no section headers. */}
        <nav
          aria-label="POS navigation"
          className="flex w-[76px] shrink-0 flex-col items-center gap-1 bg-secondary py-4"
        >
          <div className="mb-2 flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-sm font-heading font-semibold text-primary-foreground">
            T
          </div>
          {NAV_ITEMS.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.end} className={navLinkClass}>
              <item.icon className="h-5 w-5" />
              {item.label}
            </NavLink>
          ))}
          <div className="mt-auto flex flex-col items-center gap-1">
            <NavLink
              to="/"
              className="flex flex-col items-center gap-1 rounded-xl px-2 py-2.5 text-[11px] font-medium text-white/55 transition-colors duration-fast hover:bg-white/5 hover:text-white/85"
            >
              <IconArrowLeft className="h-5 w-5" />
              Admin
            </NavLink>
          </div>
        </nav>

        <main className="min-w-0 flex-1 overflow-y-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
