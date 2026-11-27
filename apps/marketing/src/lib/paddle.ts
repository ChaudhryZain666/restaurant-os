/**
 * Launch, 2026-11-21 — Paddle.js for the public pay-now checkout (CheckoutPage.tsx). Loaded only on
 * that page, straight from Paddle's CDN (Paddle's security guidance: never a bundled copy).
 * garnishtable.com is the domain Paddle has approved for checkout, which is why checkout runs here.
 */

export interface PaddleEventData {
  name: string;
  data?: { transaction_id?: string; customer?: { email?: string } };
}

interface PaddleGlobal {
  Environment: { set: (env: "sandbox" | "production") => void };
  Initialize: (options: { token: string; eventCallback?: (event: PaddleEventData) => void }) => void;
  Checkout: {
    open: (options: {
      items: Array<{ priceId: string; quantity: number }>;
      /** In-app Subscribe hand-off: the owner's existing Paddle customer. */
      customer?: { id: string };
      customData?: Record<string, string>;
      settings?: { displayMode?: "overlay"; theme?: "light" | "dark"; allowLogout?: boolean };
    }) => void;
  };
}

declare global {
  interface Window {
    Paddle?: PaddleGlobal;
  }
}

const PADDLE_JS = "https://cdn.paddle.com/paddle/v2/paddle.js";
let loading: Promise<PaddleGlobal> | null = null;
let initialized: { environment: string; token: string } | null = null;
let listener: ((event: PaddleEventData) => void) | null = null;

export function loadPaddle(): Promise<PaddleGlobal> {
  if (window.Paddle) return Promise.resolve(window.Paddle);
  if (loading) return loading;
  loading = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = PADDLE_JS;
    script.async = true;
    script.onload = () => (window.Paddle ? resolve(window.Paddle) : reject(new Error("Paddle.js did not start.")));
    script.onerror = () => {
      loading = null;
      reject(new Error("The payment form couldn't load. Check your connection or disable blockers for this page, then try again."));
    };
    document.head.appendChild(script);
  });
  return loading;
}

/** Initialises once per page load (Paddle's contract). Events go to the latest `onEvent`. Opening
 *  the page with `?_ptxn=` makes Paddle.js open that transaction's checkout by itself. */
export async function initPaddle(config: { clientToken: string; environment: "sandbox" | "production" }, onEvent: (event: PaddleEventData) => void) {
  const paddle = await loadPaddle();
  listener = onEvent;
  if (!initialized) {
    paddle.Environment.set(config.environment);
    paddle.Initialize({ token: config.clientToken, eventCallback: (event) => listener?.(event) });
    initialized = { environment: config.environment, token: config.clientToken };
  } else if (initialized.environment !== config.environment) {
    throw new Error("The payment form is already running in another mode. Reload the page and try again.");
  }
  return paddle;
}
