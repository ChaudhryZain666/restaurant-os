import { agencyRoleHasPermission, type AgencyPermission } from "@restaurant/types";
import { useAgency } from "../context/AgencyContext";

/**
 * Portal UX safety phase — the agency-section analog of useCan.ts, extracted from the exact
 * myRole-lookup pattern AgencyBusinessDetailPage.tsx already used correctly (see its
 * canManageBusiness/canReadBilling locals) so AgencyBusinessesPage/AgencyMembersPage/
 * AgencyBillingPage can gate their own mutation controls the same way instead of showing them to
 * every agency role regardless of AGENCY_ROLE_PERMISSIONS. Read-only GET routes under
 * /agencies/:agencyId/... never required this — only mutations do (see agencyRbac.ts's own doc
 * comment) — so this is checked once per action, not once for the whole page.
 */
export function useAgencyPermission(permission: AgencyPermission): boolean {
  const { activeAgencyId, agencies } = useAgency();
  const myRole = agencies.find((a) => a.id === activeAgencyId)?.myRole;
  return myRole ? agencyRoleHasPermission(myRole, permission) : false;
}
