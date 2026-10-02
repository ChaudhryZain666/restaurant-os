/**
 * Phase 40.1 — a thin, typed wrapper around the real Paddle.js global (loaded via the script tag in
 * index.html), exposing only the three calls BillingPage.tsx actually needs. No client-side token
 * lives here — it's always the one the backend's own checkout API response returns
 * (ProviderCheckoutSession.clientToken), never a separate frontend-side config value, since a
 * client-side token is per-checkout-session data from the app's own perspective, not build-time
 * config. Paddle.Initialize is only ever called once per page load (guarded below) — calling it
 * repeatedly is not part of Paddle's documented contract.
 *
 * Phase 85A — the environment (sandbox/production) also comes from that same checkout response,
 * validated by resolvePaddleEnvironment; it was previously hardcoded to "sandbox".
 */
import { PaddleConfigurationError, resolvePaddleEnvironment, type PaddleCheckoutSessionConfig, type PaddleEnvironment } from "./paddleEnvironment";

interface PaddleCheckoutCompletedEvent {
  name: "checkout.completed";
  data?: { transaction_id?: string };
}

interface PaddleGlobal {
  Environment: { set: (env: "sandbox" | "production") => void };
  Initialize: (options: { token: string; eventCallback?: (event: PaddleCheckoutCompletedEvent) => void }) => void;
  Checkout: {
    open: (options: {
      items: Array<{ priceId: string; quantity: number }>;
      customer: { id: string };
      customData?: Record<string, string>;
    }) => void;
  };
}

declare global {
  interface Window {
    Paddle?: PaddleGlobal;
  }
}

let initializedEnvironment: PaddleEnvironment | null = null;

/** Real Paddle.js availability check — the script tag can fail to load (network, ad-blocker), and
 *  this must fail loudly rather than silently no-op a checkout attempt. */
export function isPaddleJsLoaded(): boolean {
  return typeof window !== "undefined" && Boolean(window.Paddle);
}

export function openPaddleCheckout(
  session: PaddleCheckoutSessionConfig,
  providerPriceId: string,
  providerCustomerId: string,
  customData: Record<string, string>,
  onCompleted: () => void
): void {
  if (!window.Paddle) throw new Error("Paddle.js did not load — check your network connection and try again.");
  // Throws (never falls back to sandbox) when the session's environment is missing or inconsistent.
  const environment = resolvePaddleEnvironment(session);

  if (initializedEnvironment === null) {
    // Real, documented order: Environment.set must run before Initialize.
    window.Paddle.Environment.set(environment);
    window.Paddle.Initialize({
      token: session.clientToken as string,
      eventCallback: (event) => {
        if (event.name === "checkout.completed") onCompleted();
      },
    });
    initializedEnvironment = environment;
  } else if (initializedEnvironment !== environment) {
    throw new PaddleConfigurationError(`Paddle.js is already running in ${initializedEnvironment}, not ${environment}.`);
  }

  // Paddle copies customData onto the transaction and, for recurring items, onto the subscription
  // it creates — this is the ONLY way the webhook later sees which owner/plan a checkout was for
  // (PaddleBillingProvider.verifyWebhookSignature's checkoutMetadata requires custom_data.ownerType).
  // Without this, a real completed checkout could never be attributed to a local Subscription, in
  // sandbox or production.
  window.Paddle.Checkout.open({
    items: [{ priceId: providerPriceId, quantity: 1 }],
    customer: { id: providerCustomerId },
    customData,
  });
}
