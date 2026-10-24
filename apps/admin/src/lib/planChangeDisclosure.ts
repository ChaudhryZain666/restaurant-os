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
 * `direction` compares the two plans' prices at the subscription's interval: Paddle adds the prorated
 * difference to the next bill on an upgrade but CREDITS it on a downgrade (sandbox T6, 2026-10-17 —
 * the old note said "added" for both). Unknown → neutral wording, never a guess.
 */
export type PlanChangeDirection = "upgrade" | "downgrade" | "unknown";

/** Upgrade or downgrade, from the two plans' prices at one billing interval (amounts in cents). */
export function planChangeDirection(currentCents: number | null | undefined, newCents: number | null | undefined): PlanChangeDirection {
  if (typeof currentCents !== "number" || typeof newCents !== "number" || currentCents === newCents) return "unknown";
  return newCents > currentCents ? "upgrade" : "downgrade";
}

export function planChangeBillingNote(
  subscription: Pick<Subscription, "status" | "provider" | "providerSubscriptionId">,
  newPlanName: string,
  newPlanPrice: string | null,
  nextBillDate: string,
  direction: PlanChangeDirection = "unknown"
): string | null {
  if (subscription.provider === "paddle" && subscription.providerSubscriptionId) {
    const plan = newPlanPrice ? `${newPlanName} (${newPlanPrice})` : newPlanName;
    const proration =
      direction === "upgrade"
        ? `the prorated difference for the rest of this billing period is added to your next bill on ${nextBillDate}`
        : direction === "downgrade"
          ? `the unused part of your current plan for the rest of this billing period is credited against your next bill on ${nextBillDate}`
          : `the prorated difference for the rest of this billing period shows on your next bill on ${nextBillDate}`;
    return `Your plan changes to ${plan} now. Nothing is charged today: ${proration}.`;
  }
  if (subscription.status === "trialing" && !subscription.providerSubscriptionId) {
    return "You're on a free trial, so nothing is charged now.";
  }
  return null;
}
