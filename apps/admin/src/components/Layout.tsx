import { useState, type ComponentType, type SVGProps } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { agencyRoleGrantsPermission, roleHasPermission, type AgencyMembershipRole, type Permission, type UserRole } from "@restaurant/types";
import { Logo, useToast } from "@restaurant/ui";
import { describeAvailability } from "@restaurant/utils";
import { useAuth } from "../context/AuthContext";
import { useLocation as useActiveLocation } from "../context/LocationContext";
import { useAgency } from "../context/AgencyContext";
import { useBusiness } from "../context/BusinessContext";
import { useRestaurantOrderEvents } from "../hooks/useRestaurantOrderEvents";
import { RestaurantSettingsProvider, useRestaurantSettings } from "../context/RestaurantSettingsContext";
import { LocationSwitcher } from "./LocationSwitcher";
import {
  IconArrowLeft,
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
  IconPin,
  IconPrinter,
  IconRegister,
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
  settingsFlag?: "kitchenEnabled" | "staffEnabled" | "posEnabled";
  /** Phase 23 — hidden entirely at a single location, matching Locations/domain-switcher's own
   *  established gating: a single-location owner's one location already IS the business, so
   *  business-wide analytics/promotions would just be a confusing duplicate of the page they
   *  already have. */
  multiLocationOnly?: boolean;
}

interface NavGroup {
  label: string;
  /** Portal UX phase — a short, muted subtitle rendered under the group label, so the grouping
   *  itself teaches what it's for at a glance (not just a category name). Optional: KITCHEN_GROUPS/
   *  PLATFORM_GROUPS/AGENCY_GROUPS below don't need the same explanatory weight as the main
   *  restaurant-owner nav, so they're left without one rather than forcing filler text. */
  description?: string;
  items: NavItem[];
}

// Portal UX phase — regrouped from the previous feature-taxonomy layout (Overview/Orders/Menu/
// Customers/Operations/Marketing/Insights/Support/Settings) into task-oriented groups matching how
// an owner actually thinks about running a restaurant, not how the codebase's own domains are
// organized. Every item below is the exact same route/permission/settingsFlag/multiLocationOnly
// gate as before — only which group an already-gated item appears under, its order, and its label
// changed. Setup stays its own top-level group (not nested under Business/Settings) since it's the
// deliberate entry point for a not-yet-ready restaurant and needs to stay one click from Home.
const RESTAURANT_GROUPS: NavGroup[] = [
  {
    label: "Home",
    items: [{ to: "/", label: "Dashboard", icon: IconGrid, end: true }],
  },
  {
    label: "Get ready",
    description: "Set up your restaurant to start taking orders",
    items: [
      { to: "/setup", label: "Setup", icon: IconSliders, permission: "restaurant.settings.manage" },
    ],
  },
  {
    label: "Sell",
    description: "What customers see and order",
    items: [
      { to: "/menu", label: "Menu", icon: IconMenuBook, permission: "restaurant.menu.read" },
      { to: "/orders", label: "Orders", icon: IconClipboard, permission: "restaurant.orders.read" },
      { to: "/customers", label: "Customers", icon: IconUsers, permission: "restaurant.orders.read" },
    ],
  },
  {
    label: "Run",
    description: "Day-to-day service",
    items: [
      { to: "/pos", label: "POS", icon: IconRegister, permission: "restaurant.pos.operate", settingsFlag: "posEnabled" },
      // Phase 26 — explicitly permission-gated now (mirrors the route itself, converted the same
      // phase): previously ungated here since every real restaurant role happened to have
      // restaurant.orders.manage, but an agency_staff acting inside a business does NOT (read-only
      // by design), and an ungated nav item would otherwise show a link that 403s on click — the
      // exact Phase 11 drift class itemVisible/RequireAuth deriving from one shared source exists
      // to prevent.
      { to: "/kitchen", label: "Kitchen", icon: IconKitchen, permission: "restaurant.orders.manage", settingsFlag: "kitchenEnabled" },
      { to: "/tables", label: "Tables", icon: IconTable, permission: "restaurant.tables.manage" },
      { to: "/delivery", label: "Delivery", icon: IconTruck, permission: "restaurant.settings.manage" },
      { to: "/marketplace", label: "Marketplace", icon: IconStore, permission: "restaurant.marketplace.read" },
      { to: "/staff", label: "Staff", icon: IconIdBadge, permission: "restaurant.staff.manage", settingsFlag: "staffEnabled" },
    ],
  },
  {
    label: "Grow",
    description: "Bring customers back and track results",
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
      { to: "/analytics", label: "Analytics", icon: IconChart, permission: "restaurant.analytics.read" },
      {
        to: "/business-analytics",
        label: "Business Analytics",
        icon: IconChart,
        permission: "restaurant.analytics.read",
        multiLocationOnly: true,
      },
    ],
  },
  {
    label: "Business",
    description: "Locations, billing and account-wide settings",
    items: [
      // Phase 19 — same gating as Settings/Delivery (restaurant.settings.manage is owner-only,
      // not manager). Always shown to an owner even with just one location today, so there's a
      // discoverable way to ever reach a second one — the page itself stays minimal at 1 location
      // rather than presenting management complexity by default (see LocationsPage.tsx).
      { to: "/locations", label: "Locations", icon: IconStore, permission: "restaurant.settings.manage" },
      // Phase 24 — business-level regardless of location count (unlike Business Analytics/
      // Promotions above), so this is never multiLocationOnly: every business has exactly one
      // subscription whether it has one location or several.
      { to: "/billing", label: "Billing", icon: IconWallet, permission: "billing.read" },
      { to: "/settings", label: "Settings", icon: IconSettings, permission: "restaurant.settings.manage" },
      // Phase 57 — deliberately its own permission (restaurant.printers.manage), not
      // restaurant.settings.manage: both owner AND manager configure printers (Section 20), but
      // Settings itself stays owner-only, so this can't live inside that page/tab.
      { to: "/printers", label: "Printers", icon: IconPrinter, permission: "restaurant.printers.manage" },
      { to: "/theme-studio", label: "Theme Studio", icon: IconPalette, permission: "restaurant.settings.manage" },
      { to: "/audit-log", label: "Audit log", icon: IconClipboard, permission: "restaurant.audit.read" },
    ],
  },
  {
    label: "Help",
    items: [{ to: "/support", label: "Support", icon: IconHeadset, permission: "support.tickets.read" }],
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
//
// Portal UX phase — regrouped so an agency reads this as "I manage my clients," not "I'm a
// restaurant owner with an Agency label": Businesses relabeled Clients (route/API unchanged — a
// cosmetic label only), and Locations/Activity added as their own items (previously nonexistent —
// Locations is a new small read endpoint, Activity just fronts an already-existing one). Every item
// keeps the same `roles` gate as before.
const AGENCY_GROUPS: NavGroup[] = [
  {
    label: "Home",
    description: "Your client portfolio at a glance",
    items: [{ to: "/agency", label: "Dashboard", icon: IconGrid, end: true, roles: ["agency_member", "customer"] }],
  },
  {
    label: "Clients",
    description: "The restaurants you provision and support",
    items: [
      { to: "/agency/businesses", label: "Clients", icon: IconStore, roles: ["agency_member", "customer"] },
      { to: "/agency/locations", label: "Locations", icon: IconPin, roles: ["agency_member", "customer"] },
    ],
  },
  {
    label: "Agency",
    description: "Your own account, team, and subscription",
    items: [
      { to: "/agency/members", label: "Team", icon: IconUsers, roles: ["agency_member", "customer"] },
      { to: "/agency/billing", label: "Billing", icon: IconWallet, roles: ["agency_member", "customer"] },
      { to: "/agency/activity", label: "Activity", icon: IconClipboard, roles: ["agency_member", "customer"] },
      { to: "/agency/settings", label: "Settings", icon: IconSettings, roles: ["agency_member", "customer"] },
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

// Phase 68 — the active state is a solid GT Wine pill with GT Ivory text/icon (the brand's own
// established "wine = selected" convention, reused rather than inventing a second signal); hover on
// an inactive item is a quiet plum wash, never the active color itself, so the two states stay
// unambiguous at a glance. Both colors come from the sidebar's own token set (see index.css) —
// never a raw hex literal here.
function navLinkClass(collapsed: boolean) {
  return ({ isActive }: { isActive: boolean }) =>
    [
      "group relative flex items-center gap-2.5 rounded-lg py-2 text-sm font-medium transition-colors duration-fast ease-premium",
      collapsed ? "justify-center px-2" : "px-3",
      isActive ? "bg-primary text-primary-foreground shadow-sm" : "text-sidebar-foreground-dim hover:bg-sidebar-hover hover:text-sidebar-foreground",
    ].join(" ");
}

function itemVisible(
  item: NavItem,
  role: UserRole,
  isMultiLocation: boolean,
  agencyRole: AgencyMembershipRole | null,
  restaurantSettings?: { kitchenEnabled?: boolean; staffEnabled?: boolean; posEnabled?: boolean }
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
  collapsed = false,
}: {
  groups: NavGroup[];
  role: UserRole;
  isMultiLocation: boolean;
  /** Phase 26 — set only while an agency_member is acting inside a managed business, so nav
   *  visibility for RESTAURANT_GROUPS matches exactly what that agency role can reach there (the
   *  same AGENCY_ROLE_GRANTS the server's requireBusinessPermission/requireTenantPermission check). */
  agencyRole?: AgencyMembershipRole | null;
  /** Phase 28 — the active location's settings, for kitchenEnabled/staffEnabled-gated items.
   *  posEnabled added for the POS nav item, same pattern. */
  restaurantSettings?: { kitchenEnabled?: boolean; staffEnabled?: boolean; posEnabled?: boolean };
  onNavigate?: () => void;
  /** Phase 71 — icon-only mode (desktop sidebar collapse). Group labels disappear (a divider still
   *  separates groups) and each item grows a small CSS-only tooltip, shown on hover AND keyboard
   *  focus (a real accessibility requirement a hover-only tooltip would fail), so the item's label is
   *  never actually lost, just not permanently on screen. Never applied to the mobile drawer, which
   *  always renders expanded regardless of this flag (see LayoutContent). */
  collapsed?: boolean;
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

  const linkClass = navLinkClass(collapsed);

  return (
    <nav className="flex flex-col gap-5">
      {visibleGroups.map((group, i) => (
        <div key={group.label} className={i > 0 ? "flex flex-col gap-0.5 border-t border-sidebar-border pt-4" : "flex flex-col gap-0.5"}>
          {!collapsed && (
            <div className="px-3 pb-1.5">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-sidebar-muted">{group.label}</p>
              {group.description && <p className="mt-0.5 text-[11px] leading-snug text-sidebar-muted-soft">{group.description}</p>}
            </div>
          )}
          {group.items.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.end} className={linkClass} onClick={onNavigate}>
              <item.icon className="h-[18px] w-[18px] shrink-0" />
              {collapsed ? (
                <span
                  role="tooltip"
                  className="pointer-events-none absolute left-full top-1/2 z-50 ml-2 -translate-y-1/2 whitespace-nowrap rounded-md bg-sidebar px-2.5 py-1.5 text-xs font-medium text-sidebar-foreground opacity-0 shadow-elevated ring-1 ring-sidebar-border transition-opacity duration-fast group-hover:opacity-100 group-focus-visible:opacity-100"
                >
                  {item.label}
                </span>
              ) : (
                item.label
              )}
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
  const { activeLocationId, locations } = useActiveLocation();
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
  const { restaurant: activeRestaurant, availability: activeAvailability } = useRestaurantSettings();
  const [mobileOpen, setMobileOpen] = useState(false);
  // Phase 71 — desktop-only sidebar collapse (icon-only, with tooltips — see NavGroupList). Read
  // once on mount, matching every other "remembered UI preference" in this app (activeLocationId,
  // entered-business) — never an authorization input, purely a display choice. effectiveCollapsed
  // additionally forces expanded whenever the MOBILE drawer is open: the desktop <aside> and the
  // mobile drawer are the exact same DOM subtree (only repositioned by breakpoint, see the JSX
  // below), so without this a collapsed desktop preference would otherwise also collapse the mobile
  // drawer, which must always show full labels — mobileOpen is only ever true from the hamburger
  // button, itself hidden at the desktop widths where collapse applies.
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem("sidebarCollapsed") === "1";
    } catch {
      return false;
    }
  });
  const effectiveCollapsed = collapsed && !mobileOpen;
  function toggleCollapsed() {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem("sidebarCollapsed", next ? "1" : "0");
      } catch {
        /* best-effort only */
      }
      return next;
    });
  }
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

  // Phase 68 — a small "what am I looking at" readout in the main workspace's own header, so the
  // dark sidebar isn't the only place that answers "who/what am I currently managing" (Section 9's
  // principle). Restaurant name only, for a restaurant-scoped session — confirmed against every
  // restaurant-scoped page this phase touched that nothing else on screen already shows that name
  // as its own heading. Deliberately NOT extended to the agency-scoped case: AgencyDashboardPage
  // (and others) already render the active agency's own name as their page h1, so a second copy
  // here would duplicate visible text and break `getByText(agencyName)` across several existing
  // e2e specs (agency-management.spec.ts) that assert on it as a single match.
  const headerContext = isRestaurantScoped ? activeRestaurant?.name : null;

  const sidebarContent = (
    <>
      <div className="flex items-center gap-2.5 border-b border-sidebar-border px-5 py-4">
        <Logo hideText variant="light" size="sm" />
        {!effectiveCollapsed && (
          <div className="min-w-0">
            <p className="truncate font-heading text-sm font-semibold text-sidebar-foreground">GarnishTable</p>
            <p className="truncate text-xs text-sidebar-muted">
              {isPlatformAdmin
                ? "Platform admin"
                : isActingAsAgency
                  ? "Managing via agency"
                  : isAgencyScoped
                    ? "Agency admin"
                    : "Restaurant admin"}
            </p>
          </div>
        )}
        <button
          onClick={() => setMobileOpen(false)}
          aria-label="Close menu"
          className="ml-auto flex h-8 w-8 items-center justify-center rounded-lg text-sidebar-foreground-dim transition-colors duration-fast hover:bg-sidebar-hover hover:text-sidebar-foreground lg:hidden"
        >
          <IconClose className="h-5 w-5" />
        </button>
        {/* Phase 71 — desktop-only sidebar collapse toggle. Occupies the same visual slot the
            mobile close button does (ml-auto), but the two are complementary breakpoint-gated
            (lg:hidden vs hidden lg:flex) so exactly one is ever rendered at a given viewport. */}
        <button
          onClick={toggleCollapsed}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className="ml-auto hidden h-8 w-8 items-center justify-center rounded-lg text-sidebar-foreground-dim transition-colors duration-fast hover:bg-sidebar-hover hover:text-sidebar-foreground lg:flex"
        >
          <IconArrowLeft className={`h-4 w-4 transition-transform duration-normal ease-premium ${collapsed ? "rotate-180" : ""}`} />
        </button>
      </div>
      {/* Phase 71 — "which restaurant am I managing" answered right at the top of the sidebar, not
          just in the main workspace's own header (headerContext below) — the brief's own worked
          example. Real, already-fetched data only: RestaurantSettingsContext's own availability
          (Phase 71 addition to that context, same GET /restaurants/:id call it already made).
          Hidden when collapsed (no room, and the main header's own readout already covers it) and
          for non-restaurant-scoped sessions (platform admin / agency not yet inside a business). */}
      {isRestaurantScoped && !effectiveCollapsed && activeRestaurant && (
        <div className="border-b border-sidebar-border px-5 py-3">
          <p className="truncate text-sm font-semibold text-sidebar-foreground">{activeRestaurant.name}</p>
          <p className="mt-0.5 flex items-center gap-1.5 text-xs text-sidebar-muted">
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                !activeAvailability || activeAvailability.status === "open"
                  ? "bg-success"
                  : activeAvailability.status === "paused"
                    ? "bg-warning"
                    : "bg-sidebar-muted"
              }`}
            />
            {describeAvailability(activeAvailability, activeRestaurant.settings.timezone)}
          </p>
        </div>
      )}
      <div className="flex-1 overflow-y-auto overflow-x-visible px-3 py-4">
        {/* Portal UX phase — the location/agency switchers used to only exist in the desktop
            header (sm:flex-gated, Layout.tsx's header block below), so a multi-location owner or
            multi-agency user on a phone had no way at all to switch. Mirrored here, lg:hidden since
            the header's own copies already cover desktop/tablet. Phase 71 — the location half is
            now the same LocationSwitcher component the header uses, not a second bespoke select. */}
        {isRestaurantScoped && (
          <div className="mb-3 lg:hidden">
            <LocationSwitcher theme="dark" />
          </div>
        )}
        {isAgencyScoped && agencies.length > 1 && (
          <label className="mb-3 flex flex-col gap-1 text-sm lg:hidden">
            <span className="text-xs font-medium text-sidebar-muted">Agency</span>
            <select
              value={activeAgencyId ?? ""}
              onChange={(e) => switchAgency(e.target.value)}
              aria-label="Active agency"
              className="rounded-lg border border-sidebar-border bg-white/[0.04] px-2.5 py-1.5 text-sm text-sidebar-foreground"
            >
              {agencies.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>
        )}
        {isActingAsAgency && !effectiveCollapsed && (
          <div className="mb-4 rounded-lg border border-sidebar-border bg-white/[0.05] px-3 py-2.5 text-xs">
            <p className="font-medium text-sidebar-foreground">Managing {activeBusinessName}</p>
            <p className="text-sidebar-muted">via {activeAgencyName}</p>
            <button
              onClick={() => {
                exitBusiness();
                navigate("/agency/businesses");
              }}
              className="mt-1.5 font-medium text-sidebar-foreground underline decoration-sidebar-border underline-offset-2 transition-colors duration-fast hover:decoration-sidebar-foreground"
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
            collapsed={effectiveCollapsed}
          />
        )}
        {isPlatformAdmin && user && (
          <NavGroupList
            groups={PLATFORM_GROUPS}
            role={user.role}
            isMultiLocation={false}
            onNavigate={() => setMobileOpen(false)}
            collapsed={effectiveCollapsed}
          />
        )}
        {isAgencyScoped && user && (
          <NavGroupList
            groups={AGENCY_GROUPS}
            role={user.role}
            isMultiLocation={false}
            onNavigate={() => setMobileOpen(false)}
            collapsed={effectiveCollapsed}
          />
        )}
      </div>
      {/* Phase 68 — identity + logout live at the sidebar's own foot (the "premium app" convention
          Section 9 asks for), not the top header, which now carries page/location context instead.
          A plain flex sibling after the flex-1 scroll region above, so it's always pinned to the
          bottom without needing its own mt-auto. */}
      {user && (
        <div className="border-t border-sidebar-border px-3 py-3">
          <div className={`flex items-center gap-2.5 rounded-lg px-2 py-1.5 ${effectiveCollapsed ? "flex-col" : ""}`}>
            <span
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary font-heading text-xs font-semibold text-primary-foreground"
              title={effectiveCollapsed ? `${user.name} — ${ROLE_LABELS[user.role] ?? user.role}` : undefined}
            >
              {user.name?.[0]?.toUpperCase() ?? "?"}
            </span>
            {!effectiveCollapsed && (
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-sidebar-foreground">{user.name}</p>
                <p className="truncate text-xs text-sidebar-muted">{ROLE_LABELS[user.role] ?? user.role}</p>
              </div>
            )}
            <button
              onClick={() => logout()}
              aria-label="Log out"
              title="Log out"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-sidebar-foreground-dim transition-colors duration-fast hover:bg-sidebar-hover hover:text-sidebar-foreground"
            >
              <IconLogout className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}
    </>
  );

  return (
    <div className="flex min-h-screen bg-background">
      {mobileOpen && (
        <button
          aria-label="Close menu overlay"
          onClick={() => setMobileOpen(false)}
          className="fixed inset-0 z-30 bg-black/40 transition-opacity duration-normal ease-premium lg:hidden"
        />
      )}

      <aside
        // lg:sticky + lg:h-screen (not lg:static) — without its own height/positioning, the
        // sidebar was just a normal flex child that grew to match the main content's height and
        // scrolled away with it on any long page, taking the whole nav out of view. Sticky pins it
        // to the viewport on desktop while the main content scrolls independently underneath it.
        className={`fixed inset-y-0 left-0 z-40 flex w-64 shrink-0 flex-col bg-sidebar transition-[transform,width] duration-normal ease-premium lg:sticky lg:top-0 lg:h-screen lg:translate-x-0 ${
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        } ${effectiveCollapsed ? "lg:w-[4.5rem]" : "lg:w-64"}`}
      >
        {sidebarContent}
      </aside>

      {/* Phase 58 — min-w-0 is required here: a flex item's default min-width is `auto` (its
          content's intrinsic width), so without this a page whose content includes a wide table
          (even one correctly wrapped in its own overflow-x-auto) pushes THIS column wider than the
          viewport instead of scrolling internally — <main>'s own overflow-x-hidden below can't
          compensate for that on its own. Found on 3 real Agency Portal pages at 390px during this
          phase's own responsive audit; the underlying cause is layout-wide (every page renders
          through this same wrapper), so this fixes it for all of them, not just the Agency ones. */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between gap-3 border-b border-border bg-surface px-4 py-3.5 sm:px-6">
          <button
            onClick={() => setMobileOpen(true)}
            aria-label="Open menu"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border text-foreground transition-colors duration-fast hover:bg-black/[0.03] lg:hidden"
          >
            <IconMenuHamburger className="h-5 w-5" />
          </button>
          {headerContext && (
            <p className="min-w-0 truncate font-heading text-sm font-semibold text-foreground sm:text-base">{headerContext}</p>
          )}
          {user && (
            <div className="ml-auto flex items-center gap-3">
              {/* Phase 19 — only ever rendered when there's an actual choice to make
                  (locations.length > 1, checked inside LocationSwitcher itself): a single-location
                  business must never see this, matching Section 5's "don't complicate the
                  single-location product" requirement. Phase 71 — now the same refined disclosure
                  the sidebar's mobile copy uses, instead of a bare native <select>. */}
              {isRestaurantScoped && (
                <div className="hidden sm:block">
                  <LocationSwitcher theme="light" />
                </div>
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
            </div>
          )}
        </header>
        <main className="min-w-0 flex-1 overflow-x-hidden p-4 sm:p-6 lg:p-8">
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
