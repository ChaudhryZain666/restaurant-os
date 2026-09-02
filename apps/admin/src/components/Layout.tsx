import { useState, type ComponentType, type SVGProps } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { agencyRoleGrantsPermission, roleHasPermission, type AgencyMembershipRole, type Permission, type UserRole } from "@restaurant/types";
import { Logo, useToast } from "@restaurant/ui";
import { useAuth } from "../context/AuthContext";
import { useLocation as useActiveLocation } from "../context/LocationContext";
import { useAgency } from "../context/AgencyContext";
import { useBusiness } from "../context/BusinessContext";
import { useRestaurantOrderEvents } from "../hooks/useRestaurantOrderEvents";
import { RestaurantSettingsProvider, useRestaurantSettings } from "../context/RestaurantSettingsContext";
import {
  IconBook,
  IconChart,
  IconClipboard,
  IconGrid,
  IconHeadset,
  IconIdBadge,
  IconKitchen,
  IconLogout,
  IconMenuBook,
  IconPalette,
  IconSettings,
  IconSliders,
  IconStar,
  IconStore,
  IconTable,
  IconTag,
  IconTruck,
  IconUsers,
  IconWallet,
} from "./icons";

interface NavItem {
  to: string;
  label: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  end?: boolean;
  /** The SAME permission App.tsx's RequireAuth checks for this route — read from the one
   *  ROLE_PERMISSIONS source of truth in @restaurant/types, not a hand-maintained role list. A
   *  restaurant_staff seeing a "Delivery" or "Loyalty" link that 403s the moment they click it was
   *  a real Phase 11 finding, caused by exactly this kind of list going stale relative to the
   *  actual permission grants — deriving both from the same source is what prevents it recurring. */
  permission?: Permission;
  /** Only for the rare item with no single natural backend permission (Dashboard, Kitchen). */
  roles?: readonly UserRole[];
  /** Phase 28 — hidden when the active location's restaurant.settings[flag] is explicitly false.
   *  Undefined (not yet loaded, or the field predates this phase) is treated as visible — this only
   *  ever HIDES something a permission check already allowed, never grants extra access. */
  settingsFlag?: "kitchenEnabled" | "staffEnabled";
  /** Phase 23 — hidden entirely at a single location, matching Locations/domain-switcher's own
   *  established gating: a single-location owner's one location already IS the business, so
   *  business-wide analytics/promotions would just be a confusing duplicate of the page they
   *  already have. */
  multiLocationOnly?: boolean;
}

interface NavGroup {
  label: string;
  items: NavItem[];
}

const RESTAURANT_GROUPS: NavGroup[] = [
  {
    label: "Overview",
    items: [
      { to: "/", label: "Dashboard", icon: IconGrid, end: true },
      { to: "/setup", label: "Setup", icon: IconSliders, permission: "restaurant.settings.manage" },
      // Phase 19 — same gating as Settings/Delivery (restaurant.settings.manage is owner-only,
      // not manager). Always shown to an owner even with just one location today, so there's a
      // discoverable way to ever reach a second one — the page itself stays minimal at 1 location
      // rather than presenting management complexity by default (see LocationsPage.tsx).
      { to: "/locations", label: "Locations", icon: IconStore, permission: "restaurant.settings.manage" },
    ],
  },
  {
    label: "Orders",
    items: [
      { to: "/orders", label: "Orders", icon: IconClipboard, permission: "restaurant.orders.read" },
      // Phase 26 — explicitly permission-gated now (mirrors the route itself, converted the same
      // phase): previously ungated here since every real restaurant role happened to have
      // restaurant.orders.manage, but an agency_staff acting inside a business does NOT (read-only
      // by design), and an ungated nav item would otherwise show a link that 403s on click — the
      // exact Phase 11 drift class itemVisible/RequireAuth deriving from one shared source exists
      // to prevent.
      { to: "/kitchen", label: "Kitchen", icon: IconKitchen, permission: "restaurant.orders.manage", settingsFlag: "kitchenEnabled" },
      { to: "/tables", label: "Tables", icon: IconTable, permission: "restaurant.tables.manage" },
    ],
  },
  { label: "Menu", items: [{ to: "/menu", label: "Menu", icon: IconMenuBook, permission: "restaurant.menu.read" }] },
  {
    label: "Customers",
    items: [{ to: "/customers", label: "Customers", icon: IconUsers, permission: "restaurant.orders.read" }],
  },
  {
    label: "Operations",
    items: [
      { to: "/delivery", label: "Delivery", icon: IconTruck, permission: "restaurant.settings.manage" },
      { to: "/staff", label: "Staff", icon: IconIdBadge, permission: "restaurant.staff.manage", settingsFlag: "staffEnabled" },
    ],
  },
  {
    label: "Marketing",
    items: [
      { to: "/promotions", label: "Promotions", icon: IconTag, permission: "restaurant.promotions.manage" },
      {
        to: "/business-promotions",
        label: "Business Promotions",
        icon: IconTag,
        permission: "restaurant.promotions.manage",
        multiLocationOnly: true,
      },
      { to: "/loyalty", label: "Loyalty", icon: IconStar, permission: "restaurant.analytics.read" },
    ],
  },
  {
    label: "Insights",
    items: [
      { to: "/analytics", label: "Analytics", icon: IconChart, permission: "restaurant.analytics.read" },
      {
        to: "/business-analytics",
        label: "Business Analytics",
        icon: IconChart,
        permission: "restaurant.analytics.read",
        multiLocationOnly: true,
      },
      { to: "/audit-log", label: "Audit log", icon: IconClipboard, permission: "restaurant.audit.read" },
    ],
  },
  {
    label: "Support",
    items: [{ to: "/support", label: "Support", icon: IconHeadset, permission: "support.tickets.read" }],
  },
  {
    label: "Settings",
    items: [
      { to: "/settings", label: "Settings", icon: IconSettings, permission: "restaurant.settings.manage" },
      { to: "/theme-studio", label: "Theme Studio", icon: IconPalette, permission: "restaurant.settings.manage" },
      // Phase 24 — business-level regardless of location count (unlike Business Analytics/
      // Promotions above), so this is never multiLocationOnly: every business has exactly one
      // subscription whether it has one location or several.
      { to: "/billing", label: "Billing", icon: IconWallet, permission: "billing.read" },
    ],
  },
];

// Kitchen staff get a deliberately narrow nav — just what a kitchen screen needs, not the full
// restaurant admin surface (promotions, staff, settings, ...) that role has no permission to act
// on anyway. Route-level RBAC (App.tsx's RequireAuth) is still the real boundary; this is UI
// focus, not the security control.
const KITCHEN_GROUPS: NavGroup[] = [
  { label: "Overview", items: [{ to: "/", label: "Dashboard", icon: IconGrid, end: true }] },
  {
    label: "Orders",
    items: [
      { to: "/kitchen", label: "Kitchen", icon: IconKitchen },
      { to: "/orders", label: "Orders", icon: IconClipboard },
    ],
  },
];

const PLATFORM_GROUPS: NavGroup[] = [
  {
    label: "Overview",
    items: [{ to: "/platform", label: "Dashboard", icon: IconGrid, end: true, permission: "platform.restaurants.manage" }],
  },
  {
    label: "Platform",
    items: [
      { to: "/platform/restaurants", label: "Restaurants", icon: IconStore, permission: "platform.restaurants.manage" },
      { to: "/platform/users", label: "Users", icon: IconUsers, permission: "platform.users.manage" },
      { to: "/platform/subscriptions", label: "Subscriptions", icon: IconWallet, roles: ["platform_admin"] },
      { to: "/platform/analytics", label: "Platform analytics", icon: IconChart, roles: ["platform_admin"] },
    ],
  },
  {
    label: "Support",
    items: [
      { to: "/platform/support", label: "Support", icon: IconHeadset, permission: "support.tickets.read" },
      { to: "/platform/support/kb", label: "Knowledge base", icon: IconBook, permission: "support.knowledgebase.write" },
    ],
  },
  { label: "Settings", items: [{ to: "/platform/settings", label: "System configuration", icon: IconSliders, roles: ["platform_admin"] }] },
];

// Phase 25 — an agency_member (or a fresh "customer" account that hasn't created/joined an agency
// yet) sees this instead of RESTAURANT_GROUPS: business-level oversight (create businesses, invite
// their owners, manage the team, agency billing), never the day-to-day operational surface
// (Orders/Kitchen/Menu/etc.) — see docs/multi-tenant-storefront-architecture.md's Phase 25
// "business-level, not location-operational" boundary. `roles` here (not `permission`) since these
// routes gate on AgencyPermission/agency membership, a different vocabulary than the site-wide
// Permission type NavItem.permission checks.
const AGENCY_GROUPS: NavGroup[] = [
  { label: "Overview", items: [{ to: "/agency", label: "Dashboard", icon: IconGrid, end: true, roles: ["agency_member", "customer"] }] },
  {
    label: "Agency",
    items: [
      { to: "/agency/businesses", label: "Businesses", icon: IconStore, roles: ["agency_member", "customer"] },
      { to: "/agency/members", label: "Team", icon: IconUsers, roles: ["agency_member", "customer"] },
      { to: "/agency/billing", label: "Billing", icon: IconWallet, roles: ["agency_member", "customer"] },
    ],
  },
];

const ROLE_LABELS: Record<string, string> = {
  platform_admin: "Platform admin",
  restaurant_owner: "Owner",
  restaurant_manager: "Manager",
  restaurant_staff: "Staff",
  kitchen_staff: "Kitchen staff",
  customer: "Customer",
  agency_member: "Agency",
};

function navLinkClass({ isActive }: { isActive: boolean }) {
  return [
    "flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors duration-fast",
    isActive ? "bg-primary/10 text-primary" : "text-foreground/75 hover:bg-black/[0.04] hover:text-foreground",
  ].join(" ");
}

function itemVisible(
  item: NavItem,
  role: UserRole,
  isMultiLocation: boolean,
  agencyRole: AgencyMembershipRole | null,
  restaurantSettings?: { kitchenEnabled?: boolean; staffEnabled?: boolean }
): boolean {
  if (item.multiLocationOnly && !isMultiLocation) return false;
  if (item.settingsFlag && restaurantSettings?.[item.settingsFlag] === false) return false;
  if (item.permission) {
    return roleHasPermission(role, item.permission) || (agencyRole !== null && agencyRoleGrantsPermission(agencyRole, item.permission));
  }
  if (item.roles) return item.roles.includes(role);
  return true;
}

function NavGroupList({
  groups,
  role,
  isMultiLocation,
  agencyRole = null,
  restaurantSettings,
  onNavigate,
}: {
  groups: NavGroup[];
  role: UserRole;
  isMultiLocation: boolean;
  /** Phase 26 — set only while an agency_member is acting inside a managed business, so nav
   *  visibility for RESTAURANT_GROUPS matches exactly what that agency role can reach there (the
   *  same AGENCY_ROLE_GRANTS the server's requireBusinessPermission/requireTenantPermission check). */
  agencyRole?: AgencyMembershipRole | null;
  /** Phase 28 — the active location's settings, for kitchenEnabled/staffEnabled-gated items. */
  restaurantSettings?: { kitchenEnabled?: boolean; staffEnabled?: boolean };
  onNavigate?: () => void;
}) {
  // Filtering here (rather than trusting each NavGroup array to already be role-correct) is what
  // keeps "what's shown in nav" and "what the route/API actually allows" from drifting apart again
  // — a restaurant_staff seeing a "Delivery" or "Analytics" link that 403s the moment they click it
  // was a real Phase 11 finding, for exactly this class of silent mismatch. Checking the same
  // `permission` App.tsx's RequireAuth checks (rather than a second hand-maintained role list) is
  // what makes that class of drift structurally impossible now, not just fixed once.
  const visibleGroups = groups
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => itemVisible(item, role, isMultiLocation, agencyRole, restaurantSettings)),
    }))
    .filter((group) => group.items.length > 0);

  return (
    <nav className="flex flex-col gap-4">
      {visibleGroups.map((group) => (
        <div key={group.label} className="flex flex-col gap-0.5">
          <p className="px-3 pb-1 text-xs font-semibold uppercase tracking-wide text-muted">{group.label}</p>
          {group.items.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.end} className={navLinkClass} onClick={onNavigate}>
              <item.icon className="h-[18px] w-[18px] shrink-0" />
              {item.label}
            </NavLink>
          ))}
        </div>
      ))}
    </nav>
  );
}

function IconMenuHamburger({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={className} aria-hidden>
      <path d="M4 7h16M4 12h16M4 17h16" strokeLinecap="round" />
    </svg>
  );
}

function IconClose({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={className} aria-hidden>
      <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
    </svg>
  );
}

export function Layout() {
  return (
    <RestaurantSettingsProvider>
      <LayoutContent />
    </RestaurantSettingsProvider>
  );
}

function LayoutContent() {
  const { user, logout } = useAuth();
  const { activeLocationId, locations, switchLocation } = useActiveLocation();
  const { activeAgencyId, agencies, switchAgency } = useAgency();
  const { activeBusinessId, isActingAsAgency, agencyRoleForActiveBusiness, activeBusinessName, activeAgencyName, exitBusiness } = useBusiness();
  const isPlatformAdmin = user?.role === "platform_admin";
  const isKitchenStaff = user?.role === "kitchen_staff" && !isActingAsAgency;
  // Phase 26 — an agency_member who has entered a managed business is restaurant-scoped for nav
  // purposes (sees RESTAURANT_GROUPS, filtered by their agency role's grants), not agency-scoped —
  // the "Agency" section (create/list businesses, team, agency billing) only makes sense OUTSIDE an
  // entered business. isRestaurantScoped now keys off activeBusinessId (BusinessContext), which for
  // a real restaurant-role account is always their own user.businessId — zero behavior change there.
  const isAgencyScoped = (user?.role === "agency_member" || user?.role === "customer") && !isActingAsAgency;
  const isRestaurantScoped = Boolean(user) && !isPlatformAdmin && Boolean(activeBusinessId);
  // Phase 28 — only fetched when actually restaurant-scoped (the hook itself no-ops without a
  // resolved activeLocationId, but there's no reason to even attempt it for a platform_admin or an
  // agency member who hasn't entered a business yet).
  const { restaurant: activeRestaurant } = useRestaurantSettings();
  const [mobileOpen, setMobileOpen] = useState(false);
  const { showToast } = useToast();
  const navigate = useNavigate();

  // Global (not page-scoped) so an owner sitting on Menu/Settings/Analytics — not just
  // Orders/Kitchen — still finds out a new order came in. Server only ever emits into this user's
  // own restaurant:{id} room (see apps/api/src/realtime/socket.ts), so no tenant-filtering needed here.
  useRestaurantOrderEvents((event) => {
    if (event.type !== "order.created") return;
    showToast({
      title: "New order received",
      description: `Order #${event.orderNumber}`,
      action: { label: "View order", onClick: () => navigate("/orders") },
    });
  });

  const sidebarContent = (
    <>
      <div className="flex items-center gap-2.5 border-b border-border px-5 py-4">
        <Logo hideText />
        <div className="min-w-0">
          <p className="truncate font-heading text-sm font-semibold text-foreground">Tablecloth</p>
          <p className="truncate text-xs text-muted">
            {isPlatformAdmin
              ? "Platform admin"
              : isActingAsAgency
                ? "Managing via agency"
                : isAgencyScoped
                  ? "Agency admin"
                  : "Restaurant admin"}
          </p>
        </div>
        <button
          onClick={() => setMobileOpen(false)}
          aria-label="Close menu"
          className="ml-auto flex h-8 w-8 items-center justify-center rounded-lg text-foreground/70 hover:bg-black/[0.04] lg:hidden"
        >
          <IconClose className="h-5 w-5" />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto px-3 py-4">
        {isActingAsAgency && (
          <div className="mb-4 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2.5 text-xs">
            <p className="font-medium text-foreground">Managing {activeBusinessName}</p>
            <p className="text-muted">via {activeAgencyName}</p>
            <button
              onClick={() => {
                exitBusiness();
                navigate("/agency/businesses");
              }}
              className="mt-1.5 font-medium text-primary hover:underline"
            >
              ← Back to Agency
            </button>
          </div>
        )}
        {isRestaurantScoped && user && (
          <NavGroupList
            groups={isKitchenStaff ? KITCHEN_GROUPS : RESTAURANT_GROUPS}
            role={user.role}
            isMultiLocation={locations.length > 1}
            agencyRole={agencyRoleForActiveBusiness}
            restaurantSettings={activeRestaurant?.settings}
            onNavigate={() => setMobileOpen(false)}
          />
        )}
        {isPlatformAdmin && user && (
          <NavGroupList groups={PLATFORM_GROUPS} role={user.role} isMultiLocation={false} onNavigate={() => setMobileOpen(false)} />
        )}
        {isAgencyScoped && user && (
          <NavGroupList groups={AGENCY_GROUPS} role={user.role} isMultiLocation={false} onNavigate={() => setMobileOpen(false)} />
        )}
      </div>
    </>
  );

  return (
    <div className="flex min-h-screen bg-background">
      {mobileOpen && (
        <button
          aria-label="Close menu overlay"
          onClick={() => setMobileOpen(false)}
          className="fixed inset-0 z-30 bg-black/30 lg:hidden"
        />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-64 shrink-0 flex-col border-r border-border bg-surface transition-transform duration-normal lg:static lg:translate-x-0 ${
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        {sidebarContent}
      </aside>

      <div className="flex flex-1 flex-col">
        <header className="flex items-center justify-between gap-3 border-b border-border bg-surface px-4 py-3.5 sm:px-6">
          <button
            onClick={() => setMobileOpen(true)}
            aria-label="Open menu"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border text-foreground lg:hidden"
          >
            <IconMenuHamburger className="h-5 w-5" />
          </button>
          <span className="lg:hidden" />
          {user && (
            <div className="ml-auto flex items-center gap-3">
              {/* Phase 19 — only ever rendered when there's an actual choice to make
                  (locations.length > 1): a single-location business must never see this, matching
                  Section 5's "don't complicate the single-location product" requirement. A native
                  <select>, matching the only existing picker precedent in this app (SettingsPage's
                  timezone field) — no dropdown component exists in packages/ui and this phase
                  doesn't justify building one. */}
              {isRestaurantScoped && locations.length > 1 && (
                <label className="hidden items-center gap-1.5 text-sm sm:flex">
                  <span className="text-muted">Location:</span>
                  <select
                    value={activeLocationId ?? ""}
                    onChange={(e) => switchLocation(e.target.value)}
                    aria-label="Active location"
                    className="rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm text-foreground"
                  >
                    {locations.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {isAgencyScoped && agencies.length > 1 && (
                <label className="hidden items-center gap-1.5 text-sm sm:flex">
                  <span className="text-muted">Agency:</span>
                  <select
                    value={activeAgencyId ?? ""}
                    onChange={(e) => switchAgency(e.target.value)}
                    aria-label="Active agency"
                    className="rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm text-foreground"
                  >
                    {agencies.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <div className="flex items-center gap-2.5">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-secondary font-heading text-xs font-semibold text-secondary-foreground">
                  {user.name?.[0]?.toUpperCase() ?? "?"}
                </span>
                <div className="hidden text-right sm:block">
                  <p className="text-sm font-medium text-foreground">{user.name}</p>
                  <p className="text-xs text-muted">{ROLE_LABELS[user.role] ?? user.role}</p>
                </div>
              </div>
              <button
                onClick={() => logout()}
                className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm font-medium text-foreground/80 transition-colors duration-fast hover:bg-black/[0.03]"
              >
                <IconLogout className="h-4 w-4" />
                <span className="hidden sm:inline">Log out</span>
              </button>
            </div>
          )}
        </header>
        <main className="flex-1 overflow-x-hidden p-4 sm:p-6 lg:p-8">
          {/* Phase 19 — forces a full remount of whatever page is showing on every location
              switch, so its (mostly mount-only, useEffect(() => {...}, [])) fetch always re-runs
              against the new id. Confirmed necessary, not just a safety margin: several pages
              (Staff, Menu Management, Audit log) fetch with no restaurantId in their effect's
              dependency array at all — without this key, switching locations would leave them
              silently showing the PREVIOUS location's data indefinitely. Only the currently
              displayed page's local state is lost (open modals, in-progress form fields); Layout
              itself (nav, header, socket status) lives outside this keyed subtree and is
              untouched. platform_admin/no-business accounts have a constant (null) key here, so
              they're never affected. Phase 26 — activeBusinessId included too: an agency member
              entering a DIFFERENT managed business can land on the same location-list-relative
              position (e.g. "first location") without activeLocationId itself changing, which
              would otherwise skip the remount and leave the previous business's data on screen. */}
          <Outlet key={`${activeBusinessId ?? ""}:${activeLocationId ?? ""}`} />
        </main>
      </div>
    </div>
  );
}
