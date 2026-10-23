import type { Plan, Subscription } from "@restaurant/types";

export interface CheckoutTarget {
  planCode: string;
  billingInterval: Subscription["billingInterval"];
}

/**
 * Phase 89 — what a trialing owner's "Add payment method" / "Subscribe now" checkout is for.
 *
 * A no-card trial (createSubscriptionCore) has no providerSubscriptionId until checkout, and the
 * server allows exactly that trial to proceed to checkout (createCheckoutSessionCore). The checkout
 * must be for the trial's OWN plan and interval: the page's plan picker defaults to the first owner
 * plan by code (owner_growth), so using it here would have charged a Starter trial for Growth.
 *
 * Returns null when there is nothing to check out: no subscription, not trialing, already backed by
 * a provider subscription, or the current plan is unknown.
 */
export function trialCheckoutTarget(
  subscription: Pick<Subscription, "status" | "billingInterval" | "providerSubscriptionId"> | null,
  currentPlanCode: string | undefined
): CheckoutTarget | null {
  if (!subscription || subscription.status !== "trialing" || subscription.providerSubscriptionId || !currentPlanCode) return null;
  return { planCode: currentPlanCode, billingInterval: subscription.billingInterval };
}

/**
 * Phase 89 — converting a no-card trial early is an immediate payment: the provider prices carry no
 * trial, so the free trial ends and the plan price is charged today (unused trial days are not
 * carried over). The amount shown is the trial plan's real price for the trial's interval, e.g.
 * "$59.00"; null when that price isn't configured. `locale` is for tests; the page uses the
 * browser's, like the rest of the billing page.
 */
export function immediateChargeAmount(
  pricing: Plan["pricing"],
  billingInterval: Subscription["billingInterval"],
  locale?: string
): string | null {
  const entry = pricing.find((p) => p.interval === billingInterval);
  if (!entry?.amountCents || !entry.currency) return null;
  return (entry.amountCents / 100).toLocaleString(locale, { style: "currency", currency: entry.currency });
}

/** "Subscribe now — $59.00 charged today" (or without the amount when it isn't known). */
export function subscribeNowLabel(amount: string | null): string {
  return amount ? `Subscribe now — ${amount} charged today` : "Subscribe now — billed today";
}

export interface EarlyTrialCheckout {
  target: CheckoutTarget;
  /** The amount charged today, e.g. "$59.00". */
  amount: string;
}

/**
 * Phase 89 — whether to offer a trial's early checkout at all: only with a valid target (the trial's
 * own plan and interval) AND a configured price for that interval. Without the price the server
 * refuses the checkout ("no checkout price configured"), so offering it would be a dead action, and
 * the immediate-charge disclosure couldn't name the amount.
 */
export function earlyTrialCheckout(
  subscription: Pick<Subscription, "status" | "billingInterval" | "providerSubscriptionId"> | null,
  plan: Pick<Plan, "code" | "pricing"> | null,
  locale?: string
): EarlyTrialCheckout | null {
  const target = trialCheckoutTarget(subscription, plan?.code);
  if (!target || !plan) return null;
  const amount = immediateChargeAmount(plan.pricing, target.billingInterval, locale);
  return amount ? { target, amount } : null;
}
