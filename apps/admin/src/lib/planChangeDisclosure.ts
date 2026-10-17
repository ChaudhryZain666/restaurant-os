import type { Subscription } from "@restaurant/types";

/**
 * Phase 89 — what the change-plan confirmation says about money, matching what the API actually does
 * (subscription.service.ts's changeSubscriptionPlanCore → PaddleBillingProvider.changePlan):
 *  - a Paddle-backed subscription is changed with proration_billing_mode "prorated_next_billing_period":
 *    Paddle calculates the prorated difference now and bills it on the next renewal, so nothing is
 *    charged today. The amount isn't known here, so it is never shown.
 *  - a no-card trial has no provider subscription: the change is local only, nothing is charged.
 *  - anything else (mock/internal providers) gets no billing claim.
 * `nextBillDate` is the subscription's current period end, already formatted for display.
 */
export function planChangeBillingNote(
  subscription: Pick<Subscription, "status" | "provider" | "providerSubscriptionId">,
  newPlanName: string,
  newPlanPrice: string | null,
  nextBillDate: string
): string | null {
  if (subscription.provider === "paddle" && subscription.providerSubscriptionId) {
    const plan = newPlanPrice ? `${newPlanName} (${newPlanPrice})` : newPlanName;
    return `Your plan changes to ${plan} now. Nothing is charged today: the prorated difference for the rest of this billing period is added to your next bill on ${nextBillDate}.`;
  }
  if (subscription.status === "trialing" && !subscription.providerSubscriptionId) {
    return "You're on a free trial, so nothing is charged now.";
  }
  return null;
}
