import { agencyRoleGrantsPermission, roleHasPermission, type Permission } from "@restaurant/types";
import { useAuth } from "../context/AuthContext";
import { useBusiness } from "../context/BusinessContext";

/**
 * Portal UX safety phase — the one client-side "can this account actually use this control"
 * check, mirroring RequireAuth.tsx's own allowed-permission logic exactly (same
 * roleHasPermission/agencyRoleGrantsPermission precedence) so a role that can VIEW a page (e.g.
 * restaurant_manager on Billing, who has billing.read) but not act on it (billing.manage is
 * owner-only) sees its mutation controls hidden/disabled instead of a live button that just 403s.
 * This is UX protection only — the server's own requirePermission/requireBusinessPermission
 * middleware remains the real, unweakened authorization boundary regardless of what this returns.
 */
export function useCan(permission: Permission): boolean {
  const { user } = useAuth();
  const { activeBusinessId, agencyRoleForActiveBusiness } = useBusiness();
  if (!user) return false;
  return (
    roleHasPermission(user.role, permission) ||
    (Boolean(activeBusinessId) && agencyRoleForActiveBusiness !== null && agencyRoleGrantsPermission(agencyRoleForActiveBusiness, permission))
  );
}
