import type { UserRole } from "@restaurant/types";

/**
 * The one "role -> default landing page" mapping, shared by LoginPage's post-login redirect and
 * RequireAuth's post-rejection redirect (Phase 19's original doc comment on RequireAuth already
 * called out the risk of these two drifting apart into a redirect loop — kept in one place instead
 * of duplicated inline). Phase 25 — agency_member and customer (an agency not yet created) both
 * land on /agency, which is intentionally NOT under the RESTAURANT_ROLES-gated "/" route.
 */
export function roleHomePath(role: UserRole): string {
  if (role === "platform_admin") return "/platform";
  if (role === "agency_member" || role === "customer") return "/agency";
  return "/";
}

/** QA-006 — the restaurant Support pages (/support, /support/:id) are scoped to a location. A
 *  platform admin with no location open has nothing to show there (the page used to request
 *  /restaurants/null/support/tickets), so they go to the platform-wide support queue instead. A
 *  platform admin running a restaurant of its own (a location is open) keeps the restaurant page. */
export function restaurantSupportRedirect(role: UserRole | undefined, activeLocationId: string | null, ticketId?: string): string | null {
  if (role !== "platform_admin" || activeLocationId) return null;
  return ticketId ? `/platform/support/tickets/${encodeURIComponent(ticketId)}` : "/platform/support";
}
