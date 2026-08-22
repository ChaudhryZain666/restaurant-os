import { env } from "../config/env.js";
import type { PaymentProvider } from "./PaymentProvider.js";
import { MockPaymentProvider } from "./MockPaymentProvider.js";
import { SafepayProvider } from "./SafepayProvider.js";

let instance: PaymentProvider | null = null;
let mockInstance: MockPaymentProvider | null = null;

/**
 * Lazy-singleton provider getter, mirroring email/index.ts and services/geocoding/index.ts:
 * never throws at boot, only when a route actually tries to use an unconfigured provider.
 * "safepay" (Phase 15) is real, network-capable code — see SafepayProvider.ts's header comment
 * for exactly what's verified against Safepay's real hosts vs. still assumed. Selecting it
 * without all three SAFEPAY_* secrets throws a clear config error rather than silently starting
 * up in a state that would fail on the first real checkout.
 */
export function getPaymentProvider(): PaymentProvider {
  if (instance) return instance;

  if (env.PAYMENT_PROVIDER === "mock") {
    instance = new MockPaymentProvider(env.MOCK_PAYMENT_WEBHOOK_SECRET);
    return instance;
  }

  if (env.PAYMENT_PROVIDER === "safepay") {
    if (!env.SAFEPAY_API_KEY || !env.SAFEPAY_SECRET_KEY || !env.SAFEPAY_WEBHOOK_SECRET) {
      throw new Error(
        "PAYMENT_PROVIDER=safepay requires SAFEPAY_API_KEY, SAFEPAY_SECRET_KEY, and " +
          "SAFEPAY_WEBHOOK_SECRET to all be set."
      );
    }
    instance = new SafepayProvider(
      env.SAFEPAY_API_KEY,
      env.SAFEPAY_SECRET_KEY,
      env.SAFEPAY_WEBHOOK_SECRET,
      SafepayProvider.baseUrlForEnv(env.SAFEPAY_ENV)
    );
    return instance;
  }

  throw new Error(`PAYMENT_PROVIDER="${env.PAYMENT_PROVIDER as string}" is not a recognized provider.`);
}

/** Test/dev-only accessor for the mock provider's driver surface (simulateOutcome/signPayload) —
 *  throws if a different provider is configured, same as getPaymentProvider(). */
export function getMockPaymentProvider(): MockPaymentProvider {
  const provider = getPaymentProvider();
  if (!(provider instanceof MockPaymentProvider)) {
    throw new Error("The mock payment driver is only available when PAYMENT_PROVIDER=mock.");
  }
  mockInstance = provider;
  return mockInstance;
}
