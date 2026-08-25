import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { agencyRoleGrantsPermission, roleHasPermission, type Permission, type UserRole } from "@restaurant/types";
import { useAuth } from "../context/AuthContext";
import { useBusiness } from "../context/BusinessContext";
import { roleHomePath } from "../lib/roleHome";

interface RequireAuthProps {
  children: ReactNode;
  /**
   * Preferred: gate on the SAME permission the route's own API calls require, via the one
   * ROLE_PERMISSIONS source of truth in @restaurant/types (also what the backend's
   * requirePermission()/requireTenantPermission() middleware reads). This is what keeps "can this
   * role see the route" and "can this role actually use what's on it" from drifting apart again —
   * a restaurant_staff seeing a nav link/route that 403s on click the moment they try to use it was
   * a real Phase 11 finding (see /delivery, /loyalty), caused by hand-maintained role arrays that
   * happened to go stale relative to the real permission grants.
   *
   * Phase 26 — an agency_member acting inside a managed business (BusinessContext.activeBusinessId
   * set via an explicit "enter business" action) passes this check too, exactly when their agency
   * role for that business grants the permission — the SAME agencyRoleGrantsPermission/
   * AGENCY_ROLE_GRANTS the server's requireBusinessPermission/requireTenantPermission check, so
   * client and server can never drift apart on what an agency role can reach.
   */
  permission?: Permission;
  /** Only for routes with no single natural backend permission to check, or a platform-only page
   *  with no implemented backend endpoint yet (PlaceholderPage stubs). Prefer `permission` whenever
   *  the route's actual data comes from a permission-gated endpoint — NOT agency-aware, since every
   *  route still using `roles` today is either platform_admin-only or agency's own `/agency/*`
   *  section (AGENCY_ROLES, a plain role check, correctly independent of any entered business). */
  roles?: UserRole[];
  /** Only for the one route (Print) that legitimately needs both a permission check for
   *  restaurant/agency accounts AND an unconditional platform_admin allowance. */
  allowPlatformAdmin?: boolean;
}

export function RequireAuth({ permission, roles, allowPlatformAdmin, children }: RequireAuthProps) {
  const { user, loading } = useAuth();
  const { activeBusinessId, agencyRoleForActiveBusiness } = useBusiness();
  const location = useLocation();
  if (loading) return <p>Loading...</p>;
  if (!user) return <Navigate to="/login" replace />;

  // Phase 28 — an agency-provisioned "direct access" account can reach nothing but the forced
  // change-password screen until it sets a real password (server enforces this independently too,
  // see middleware/auth.ts). Checked before any permission/role logic below, and before the
  // destination itself so this can't loop.
  if (user.mustChangePassword && location.pathname !== "/force-password-change") {
    return <Navigate to="/force-password-change" replace />;
  }

  const allowed =
    (allowPlatformAdmin && user.role === "platform_admin") ||
    (permission
      ? roleHasPermission(user.role, permission) ||
        (Boolean(activeBusinessId) && agencyRoleForActiveBusiness !== null && agencyRoleGrantsPermission(agencyRoleForActiveBusiness, permission))
      : roles
        ? roles.includes(user.role)
        : true);
  if (!allowed) {
    // Route to THIS user's own default landing page, not unconditionally "/" — "/" itself is
    // permission-gated (see App.tsx), so a platform_admin (or, as of Phase 25, an
    // agency_member/customer) landing here would otherwise be bounced back to "/", fail the same
    // check, and loop forever. roleHomePath is the one shared "role -> home" mapping (also used by
    // LoginPage's post-login redirect) so the two can never drift apart into a loop again.
    return <Navigate to={roleHomePath(user.role)} replace />;
  }
  return <>{children}</>;
}
