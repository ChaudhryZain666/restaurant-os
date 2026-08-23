/**
 * Phase 25 — a new, small, parallel collection to the existing `AuditLog`, not a schema change to
 * it. `AuditLog.restaurantId` is required (every entry is restaurant-scoped) and cannot represent
 * agency-only events (agency created, member invited — before any business/restaurant exists in
 * scope). Mirrors the exact reasoning Phase 24 used to keep `BillingWebhookEvent` separate from
 * `PaymentWebhookEvent` despite an identical shape: different domains, unmixed. Business-scoped
 * actions taken by an agency member (e.g. business creation) still ALSO write the normal
 * per-restaurant `AuditLog` entry — both trails populated, no duplication of concern.
 */
export const AGENCY_AUDIT_ACTIONS = [
  "agency.created",
  "agency.member_invited",
  "agency.member_accepted",
  "agency.member_role_changed",
  "agency.member_removed",
  "agency.business_created",
  "agency.business_owner_invite_resent",
  "agency.subscription_created",
  "agency.subscription_plan_changed",
  "agency.subscription_cancellation_requested",
  "agency.subscription_reactivated",
] as const;

export const AGENCY_AUDIT_TARGET_TYPES = ["agency", "agency_membership", "business", "subscription"] as const;

export type AgencyAuditAction = (typeof AGENCY_AUDIT_ACTIONS)[number];
export type AgencyAuditTargetType = (typeof AGENCY_AUDIT_TARGET_TYPES)[number];

export interface AgencyAuditLogEntry {
  id: string;
  agencyId: string;
  actorUserId: string;
  actorRole: string;
  /** The actor's current name, resolved server-side at read time — best-effort, same convention as
   *  AuditLogEntry.actorName. */
  actorName?: string;
  action: AgencyAuditAction;
  targetType: AgencyAuditTargetType;
  targetId: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
}
