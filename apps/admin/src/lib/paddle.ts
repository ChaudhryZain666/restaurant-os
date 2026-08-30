/**
 * Phase 40.1 — a thin, typed wrapper around the real Paddle.js global (loaded via the script tag in
 * index.html), exposing only the three calls BillingPage.tsx actually needs. No client-side token
 * lives here — it's always the one the backend's own checkout API response returns
 * (ProviderCheckoutSession.clientToken), never a separate frontend-side config value, since a
 * client-side token is per-checkout-session data from the app's own perspective, not build-time
 * config. Paddle.Initialize is only ever called once per page load (guarded below) — calling it
 * repeatedly is not part of Paddle's documented contract.
 */
interface PaddleCheckoutCompletedEvent {
  name: "checkout.completed";
  data?: { transaction_id?: string };
}

interface PaddleGlobal {
  Environment: { set: (env: "sandbox" | "production") => void };
  Initialize: (options: { token: string; eventCallback?: (event: PaddleCheckoutCompletedEvent) => void }) => void;
  Checkout: {
    open: (options: { items: Array<{ priceId: string; quantity: number }>; customer: { id: string } }) => void;
  };
}

declare global {
  interface Window {
    Paddle?: PaddleGlobal;
  }
}

let initialized = false;

/** Real Paddle.js availability check — the script tag can fail to load (network, ad-blocker), and
 *  this must fail loudly rather than silently no-op a checkout attempt. */
export function isPaddleJsLoaded(): boolean {
  return typeof window !== "undefined" && Boolean(window.Paddle);
}

export function openPaddleCheckout(
  clientToken: string,
  providerPriceId: string,
  providerCustomerId: string,
  onCompleted: () => void
): void {
  if (!window.Paddle) throw new Error("Paddle.js did not load — check your network connection and try again.");

  if (!initialized) {
    // Real, documented order: Environment.set must run before Initialize.
    window.Paddle.Environment.set("sandbox");
    window.Paddle.Initialize({
      token: clientToken,
      eventCallback: (event) => {
        if (event.name === "checkout.completed") onCompleted();
      },
    });
    initialized = true;
  }

  window.Paddle.Checkout.open({
    items: [{ priceId: providerPriceId, quantity: 1 }],
    customer: { id: providerCustomerId },
  });
}
