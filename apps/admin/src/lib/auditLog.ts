import type { AuditAction } from "@restaurant/types";

export const AUDIT_ACTION_LABELS: Record<AuditAction, string> = {
  "order.status_changed": "Order status changed",
  "order.cancelled": "Order cancelled",
  "order.note_updated": "Internal note updated",
  "payment.refunded": "Refund issued",
  "restaurant.status_changed": "Restaurant status changed",
  "user.status_changed": "User status changed",
  "restaurant.created": "Restaurant created",
  "restaurant.published": "Restaurant published",
  "restaurant.unpublished": "Restaurant unpublished",
  "restaurant.owner_invite_resent": "Owner invitation resent",
  "domain.added": "Custom domain added",
  "domain.verified": "Custom domain verified",
  "domain.activated": "Custom domain activated",
  "domain.deactivated": "Custom domain deactivated",
  "domain.removed": "Custom domain removed",
};
