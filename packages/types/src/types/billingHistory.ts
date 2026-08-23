import type { SubscriptionOwnerType, SubscriptionProvider } from "./subscription.js";

/**
 * Phase 27 — the data source for both "Billing History" (a chronological list an owner/agency can
 * read) and "Invoices" (the payment_succeeded/payment_failed rows, each carrying a receiptUrl to
 * the provider's own hosted invoice page). Deliberately separate from AuditLog/AgencyAuditLog,
 * which stay the security/investigative trail: this is a product-facing read model, polymorphic
 * like Subscription itself ({ownerType, ownerId}) so it works identically for a business or an
 * agency, which AuditLog (restaurantId-required) structurally cannot.
 */
export const BILLING_HISTORY_EVENT_TYPES = [
  "subscription_created",
  "plan_changed",
  "payment_succeeded",
  "payment_failed",
  "past_due",
  "cancellation_requested",
  "cancelled",
  "reactivated",
  "expired",
] as const;

export type BillingHistoryEventType = (typeof BILLING_HISTORY_EVENT_TYPES)[number];

export interface BillingHistoryEvent {
  id: string;
  ownerType: SubscriptionOwnerType;
  ownerId: string;
  subscriptionId: string;
  type: BillingHistoryEventType;
  amountCents?: number;
  currency?: string;
  provider: SubscriptionProvider;
  /** The provider's own reference for this specific event (e.g. a transaction/invoice id). */
  providerReference?: string;
  /** The provider's own hosted invoice/receipt page — see docs/commercial-decisions.md's "Invoice
   *  policy" section for why this platform doesn't generate its own PDF invoices. */
  receiptUrl?: string;
  occurredAt: string;
  metadata?: Record<string, unknown>;
}
