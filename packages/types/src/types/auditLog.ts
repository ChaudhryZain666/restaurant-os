/**
 * Single source of truth for both the Mongoose schema enum (apps/api/src/models/AuditLog.ts) and
 * every place that needs to validate/render an action or target type (Phase 12's audit log query
 * schema, the admin audit log page). Previously the API model defined its own copy of this list
 * and it drifted — "restaurant.status_changed"/"user.status_changed" and the "restaurant"/"user"
 * target types existed in the model but never made it here. One list now.
 */
export const AUDIT_ACTIONS = [
  "order.status_changed",
  "order.cancelled",
  "order.note_updated",
  "payment.refunded",
  "restaurant.status_changed",
  "user.status_changed",
  "restaurant.created",
  "restaurant.published",
  "restaurant.unpublished",
  "restaurant.owner_invite_resent",
  "domain.added",
  "domain.verified",
  "domain.activated",
  "domain.deactivated",
  "domain.removed",
  "promotion.created",
  "promotion.updated",
  "promotion.activated",
  "promotion.deactivated",
  "promotion.deleted",
  "subscription.created",
  "subscription.plan_changed",
  "subscription.cancellation_requested",
  "subscription.reactivated",
  "subscription.cancelled",
  // Phase 27 — webhook-driven state changes, distinct from the owner-initiated actions above, so a
  // payment failure/recovery is auditable too, not just direct user actions.
  "subscription.payment_succeeded",
  "subscription.payment_failed",
  "subscription.past_due",
  // Phase 30 — one entry per completed menu import (never per row); targetId is a generated
  // import id (see menuImport.controller.ts), not any single Category/MenuItem, since one import
  // touches many of both. Doubles as import history — see docs/menu-import-architecture.md.
  "menu.imported",
  // Phase 31 — fired only on an actual publish (draft -> live), never on every autosaved draft
  // edit; the audit log stays a record of real, customer-visible changes, not a live edit log.
  "restaurant.theme_published",
  // Phase 41 — fired on the new one-click rollback action (POST .../theme/rollback), which swaps
  // the published theme back to whatever it was immediately before the last publish.
  "restaurant.theme_rolled_back",
  // Restaurant-owned payment accounts (BYOC — see RestaurantPaymentAccount.ts). Metadata carries
  // only {provider, fingerprint}, never anything that could reconstruct the credential — same rule
  // AuditLog.ts already holds every other action to.
  "payment_account.connected",
  "payment_account.disconnected",
] as const;

export const AUDIT_TARGET_TYPES = [
  "order",
  "payment",
  "restaurant",
  "user",
  "domain",
  "promotion",
  "subscription",
  "menu_import",
  "payment_account",
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];
export type AuditTargetType = (typeof AUDIT_TARGET_TYPES)[number];

export interface AuditLogEntry {
  id: string;
  restaurantId: string;
  actorUserId: string;
  actorRole: string;
  /** The actor's current name, resolved server-side at read time (not stored on the log entry
   *  itself) — best-effort; falls back to undefined if that user account no longer exists. */
  actorName?: string;
  action: AuditAction;
  targetType: AuditTargetType;
  targetId: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
}
