import type { AgencyMembershipRole } from "@restaurant/types";
import { AgencyMembership } from "../models/AgencyMembership.js";

/**
 * The single query every session-issuing path (register/login/refresh/acceptInvite/
 * acceptAgencyInvite/changePassword) uses to populate the JWT's `agencyMemberships` claim and the
 * matching field on the PublicUser response — kept in one place so both always agree, and so a
 * membership status other than "active" (invited/revoked/deactivated) never leaks into either.
 */
export async function getActiveAgencyMemberships(userId: string): Promise<Array<{ agencyId: string; role: AgencyMembershipRole }>> {
  const memberships = await AgencyMembership.find({ userId, status: "active" }).select("agencyId role");
  return memberships.map((m) => ({ agencyId: m.agencyId.toString(), role: m.role as AgencyMembershipRole }));
}
