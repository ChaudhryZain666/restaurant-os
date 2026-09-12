import { randomBytes } from "node:crypto";
import type {
  CreateTerminalPaymentInput,
  PaymentTerminalProvider,
  TerminalPaymentIntent,
  TerminalPaymentSnapshot,
  TerminalPaymentStatus,
} from "./PaymentTerminalProvider.js";

interface MockTerminalRecord {
  status: TerminalPaymentStatus;
  amount: number;
  currency: string;
  orderId: string;
  restaurantId: string;
}

/**
 * A deterministic, clearly-fake POS card-terminal provider — exists ONLY to make the terminal
 * state machine (pending -> requires_action -> processing -> paid/failed/cancelled) genuinely
 * exercisable in development and automated tests, without real terminal hardware or provider
 * credentials. Mirrors ../MockPaymentProvider.ts's own honesty discipline exactly.
 *
 * What's fake: no physical device is ever contacted, no money ever moves, and "approved" here
 * means nothing beyond this process's own in-memory bookkeeping (does not survive a restart — a
 * real terminal's state lives with the provider/device, not the app process).
 *
 * Never reachable unless env.POS_TERMINAL_PROVIDER is explicitly set to "mock" (see
 * apps/api/src/payments/terminal/index.ts) — every default/production configuration has NO
 * terminal provider at all, and the POS UI falls back to Phase 73's honest staff-confirmation flow
 * in that case. The dev-only mock-complete route this drives
 * (posTerminalPayment.controller.ts's mockCompleteTerminalPayment) is itself only registered when
 * this same env var is "mock" — see routes/pos.routes.ts.
 */
export class MockTerminalProvider implements PaymentTerminalProvider {
  readonly name = "mock";
  private readonly records = new Map<string, MockTerminalRecord>();

  async createPayment(input: CreateTerminalPaymentInput): Promise<TerminalPaymentIntent> {
    const providerRef = `mock_term_${randomBytes(12).toString("hex")}`;
    // Starts "requires_action" (not "pending") — a real terminal is immediately prompting the
    // customer to tap/insert/enter a PIN the instant the request reaches it, unlike an online
    // hosted-checkout intent, which starts genuinely idle until the customer navigates to it.
    this.records.set(providerRef, {
      status: "requires_action",
      amount: input.amount,
      currency: input.currency,
      orderId: input.orderId,
      restaurantId: input.restaurantId,
    });
    return { providerRef, status: "requires_action" };
  }

  async retrieve(providerRef: string): Promise<TerminalPaymentSnapshot> {
    const record = this.records.get(providerRef);
    if (!record) throw new Error(`Unknown mock terminal payment reference: ${providerRef}`);
    return { providerRef, status: record.status, amount: record.amount, currency: record.currency, raw: record };
  }

  async cancel(providerRef: string): Promise<void> {
    const record = this.records.get(providerRef);
    if (!record) throw new Error(`Unknown mock terminal payment reference: ${providerRef}`);
    // Cancelling only makes sense while still in flight — mirrors a real terminal SDK silently
    // no-oping a cancel against an already-settled transaction rather than erroring.
    if (record.status === "pending" || record.status === "requires_action" || record.status === "authorized") {
      record.status = "cancelled";
    }
  }

  // --- Mock-only driver surface below: not part of PaymentTerminalProvider, only ever called from
  // the dev-only mock-complete controller, which itself only registers its route when
  // env.POS_TERMINAL_PROVIDER === "mock". ---

  /** Flips the in-memory record to the requested outcome — simulating what a real terminal would
   *  report after the customer finishes (or the transaction otherwise resolves). The next poll
   *  (GET .../terminal-payment/:id) picks this up via retrieve() and applies it through the exact
   *  same transition path a real provider's answer would. */
  simulateOutcome(providerRef: string, outcome: "paid" | "failed" | "cancelled"): void {
    const record = this.records.get(providerRef);
    if (!record) throw new Error(`Unknown mock terminal payment reference: ${providerRef}`);
    record.status = outcome;
  }
}
