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
