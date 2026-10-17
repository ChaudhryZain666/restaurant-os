import type { BillingHistoryEvent } from "@restaurant/types";

/**
 * Phase 89 — how a billing-history row's amount is shown on the owner and agency billing pages.
 * Stored amounts are always positive (BillingHistoryEvent.amountCents, min 0); a refund or a
 * chargeback is money going back to the customer, so it is DISPLAYED as negative — the stored
 * record is never changed. A chargeback reversal returns that money, so it stays positive.
 */
const MONEY_RETURNED_TO_CUSTOMER: ReadonlySet<BillingHistoryEvent["type"]> = new Set(["refunded", "chargeback"]);

export function isMoneyReturnedToCustomer(type: BillingHistoryEvent["type"]): boolean {
  return MONEY_RETURNED_TO_CUSTOMER.has(type);
}

/**
 * Phase 89 — rows that record a plan event rather than money moving never show an amount, because
 * the amount stored on them is a plan's list price, not a charge:
 *  - a no-card trial's legacy "subscription_created" row stored the plan price although nothing was
 *    charged, and a checkout's "subscription_created" row would only repeat the amount its own
 *    "payment_succeeded" row shows;
 *  - "plan_changed" stores the NEW plan's price, but a plan change charges nothing at that moment
 *    (Paddle: prorated_next_billing_period — the difference is billed on the next renewal, which
 *    then appears as its own payment row).
 * Payments, failed payments, refunds, chargebacks and reversals display as before. Stored records
 * are unchanged.
 */
const NO_AMOUNT_SHOWN: ReadonlySet<BillingHistoryEvent["type"]> = new Set(["trial_started", "subscription_created", "plan_changed"]);

/** The row's amount as display text, or null when the row has no amount or records a plan event. */
export function formatHistoryAmount(
  event: Pick<BillingHistoryEvent, "type" | "amountCents" | "currency">,
  locale?: string
): string | null {
  if (NO_AMOUNT_SHOWN.has(event.type)) return null;
  if (event.amountCents == null || !event.currency) return null;
  const major = Math.abs(event.amountCents) / 100;
  return (isMoneyReturnedToCustomer(event.type) ? -major : major).toLocaleString(locale, { style: "currency", currency: event.currency });
}
