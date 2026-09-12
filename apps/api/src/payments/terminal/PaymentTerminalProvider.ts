/**
 * Phase 74 — the physical POS card-terminal provider boundary. Deliberately mirrors
 * ../PaymentProvider.ts's shape (same status vocabulary, same "the app never infers success itself"
 * discipline) rather than inventing a second one — the two are siblings (both "get an external
 * payment system to confirm a charge"), not variants of the same thing, since a terminal has no
 * hosted-checkout redirect/clientSecret and is driven by polling rather than (necessarily) a
 * webhook. See docs/pos-architecture.md's Phase 74 section for the full state-machine writeup and
 * docs/payment-provider-decision.md's Phase 74 section for real-provider research.
 *
 * No implementation of this interface is reachable in production today — see
 * apps/api/src/payments/terminal/index.ts. MockTerminalProvider is the only concrete adapter, and
 * it is test/dev-only by construction (env.POS_TERMINAL_PROVIDER must be explicitly set to "mock").
 */

/** Reuses the exact same vocabulary as PaymentProvider.ts's ProviderPaymentStatus — one payment
 *  status language across both online and in-person providers, not two. "timeout" is deliberately
 *  NOT a status here: it's a client-side polling concept (the frontend gives up waiting after a
 *  threshold while the payment is still "pending"/"requires_action"), not something a terminal
 *  provider reports as a discrete outcome — see TerminalCardPayment.tsx. */
export type TerminalPaymentStatus = "pending" | "requires_action" | "authorized" | "paid" | "failed" | "cancelled";

export interface CreateTerminalPaymentInput {
  amount: number;
  currency: string;
  orderId: string;
  restaurantId: string;
  metadata?: Record<string, string>;
}

export interface TerminalPaymentIntent {
  providerRef: string;
  status: TerminalPaymentStatus;
}

export interface TerminalPaymentSnapshot {
  providerRef: string;
  status: TerminalPaymentStatus;
  amount: number;
  currency: string;
  raw: unknown;
}

/**
 * Provider-agnostic capability surface for a physical card terminal. POS code talks only to this
 * interface, never to a concrete device SDK.
 */
export interface PaymentTerminalProvider {
  readonly name: string;
  /** Sends a payment request to the terminal/device assigned to this restaurant/location. Returns
   *  immediately with the attempt's initial status — a real terminal SDK call is asynchronous from
   *  here (customer taps/inserts/enters PIN over the following seconds), never fully resolved by
   *  the time this returns. */
  createPayment(input: CreateTerminalPaymentInput): Promise<TerminalPaymentIntent>;
  /** Polled on-demand (see posTerminalPayment.service.ts) rather than only via a background job —
   *  the frontend is actively waiting on this exact answer while showing a live waiting state. */
  retrieve(providerRef: string): Promise<TerminalPaymentSnapshot>;
  /** Staff-initiated cancellation of a still-in-flight request — a real terminal SDK's own "cancel
   *  the current transaction" call, telling the physical device to stop prompting the customer.
   *  Always available regardless of provider (unlike a webhook/reconciliation path, every real
   *  terminal SDK supports cancelling a pending request). */
  cancel(providerRef: string): Promise<void>;
}
