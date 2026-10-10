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

/** The row's amount as display text, or null when the row has no amount. */
export function formatHistoryAmount(
  event: Pick<BillingHistoryEvent, "type" | "amountCents" | "currency">,
  locale?: string
): string | null {
  if (event.amountCents == null || !event.currency) return null;
  const major = Math.abs(event.amountCents) / 100;
  return (isMoneyReturnedToCustomer(event.type) ? -major : major).toLocaleString(locale, { style: "currency", currency: event.currency });
}
