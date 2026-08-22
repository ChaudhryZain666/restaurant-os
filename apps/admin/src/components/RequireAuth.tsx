import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { roleHasPermission, type Permission, type UserRole } from "@restaurant/types";
import { useAuth } from "../context/AuthContext";

interface RequireAuthProps {
  children: ReactNode;
  /**
   * Preferred: gate on the SAME permission the route's own API calls require, via the one
   * ROLE_PERMISSIONS source of truth in @restaurant/types (also what the backend's
   * requirePermission() middleware reads). This is what keeps "can this role see the route" and
   * "can this role actually use what's on it" from drifting apart again — a restaurant_staff
   * seeing a nav link/route that 403s on click the moment they try to use it was a real Phase 11
   * finding (see /delivery, /loyalty), caused by hand-maintained role arrays that happened to go
   * stale relative to the real permission grants.
   */
  permission?: Permission;
  /** Only for routes with no single natural backend permission to check (Dashboard, Kitchen —
   *  visible to every restaurant-scoped role regardless of what they can do once there) or a
   *  platform-only page with no implemented backend endpoint yet (PlaceholderPage stubs). Prefer
   *  `permission` whenever the route's actual data comes from a permission-gated endpoint. */
  roles?: UserRole[];
}

export function RequireAuth({ permission, roles, children }: RequireAuthProps) {
  const { user, loading } = useAuth();
  if (loading) return <p>Loading...</p>;
  if (!user) return <Navigate to="/login" replace />;

  const allowed = permission ? roleHasPermission(user.role, permission) : roles ? roles.includes(user.role) : true;
  if (!allowed) {
    // Route to THIS user's own default landing page, not unconditionally "/" — "/" itself is
    // restaurant-role-gated (see App.tsx), so a platform_admin landing here (an old bookmark, a
    // stray link — anything other than a fresh login, which already lands them correctly via
    // LoginPage) would otherwise be bounced back to "/", fail the same check, and loop forever.
    // Mirrors LoginPage's own post-login redirect so there's exactly one "role -> home" mapping.
    return <Navigate to={user.role === "platform_admin" ? "/platform" : "/"} replace />;
  }
  return <>{children}</>;
}
