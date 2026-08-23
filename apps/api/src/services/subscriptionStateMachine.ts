import type { SubscriptionStatus } from "@restaurant/types";

/**
 * Every transition in this system — owner-initiated actions and inbound provider webhooks alike —
 * goes through isValidSubscriptionTransition; nothing else in the codebase sets `status` directly.
 * `cancelled`/`expired` are terminal: resubscribing creates a new Subscription document rather than
 * resurrecting an old one (see Subscription.ts's partial unique index). Mirrors
 * services/paymentStateMachine.ts's shape exactly.
 */
const TRANSITIONS: Record<SubscriptionStatus, readonly SubscriptionStatus[]> = {
  trialing: ["active", "cancelled", "expired"],
  active: ["cancelling", "past_due", "cancelled"],
  past_due: ["active", "cancelled"],
  cancelling: ["cancelled", "active"], // "active" = un-cancel before period end
  cancelled: [],
  expired: [],
};

export function isValidSubscriptionTransition(from: SubscriptionStatus, to: SubscriptionStatus): boolean {
  return TRANSITIONS[from].includes(to);
}
