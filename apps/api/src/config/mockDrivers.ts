/**
 * Phase 85A — the one rule for every simulated-provider driver in this API: mock payment
 * completion, mock payment/billing/marketplace webhooks, mock subscription checkout/advance, and
 * mock card-terminal completion exist for development and automated tests only.
 *
 * Their webhook secrets ship as public, dev-only defaults in env.ts, and their "complete" routes
 * exist precisely to mark something paid without money moving. So in production they are refused
 * outright, whatever PAYMENT_PROVIDER/BILLING_PROVIDER/MARKETPLACE_PROVIDER_MODE say — a cash-only
 * or pre-Paddle production deployment still runs with the mock providers selected, and must fail
 * closed rather than accept simulated money.
 *
 * Every call site checks this at request time (not only when registering routes), so the rule
 * holds even for a route that was registered before NODE_ENV was known to be production.
 */
export function mockDriversAllowed(nodeEnv: string): boolean {
  return nodeEnv !== "production";
}
