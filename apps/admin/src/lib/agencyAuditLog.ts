import type { AgencyAuditAction } from "@restaurant/types";

export const AGENCY_AUDIT_ACTION_LABELS: Record<AgencyAuditAction, string> = {
  "agency.created": "Agency created",
  "agency.member_invited": "Team member invited",
  "agency.member_accepted": "Team member invite accepted",
  "agency.member_role_changed": "Team member role changed",
  "agency.member_removed": "Team member removed",
  "agency.business_created": "Client created",
  "agency.business_owner_invite_resent": "Owner invitation resent",
  "agency.business_owner_access_created": "Owner access created directly",
  "agency.member_invite_resent": "Team invitation resent",
  "agency.subscription_created": "Agency subscription started",
  "agency.subscription_plan_changed": "Agency subscription plan changed",
  "agency.subscription_cancellation_requested": "Agency subscription cancellation requested",
  "agency.subscription_reactivated": "Agency subscription reactivated",
  "agency.subscription_payment_succeeded": "Agency payment succeeded",
  "agency.subscription_payment_failed": "Agency payment failed",
  "agency.subscription_past_due": "Agency subscription marked past due",
  "agency.updated": "Agency profile updated",
  "agency.domain_set": "White-label domain added",
  "agency.domain_verified": "White-label domain verified",
  "agency.client_commercial_terms_updated": "Client commercial terms updated",
};
