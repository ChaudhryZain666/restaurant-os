import { env } from "../config/env.js";
import type { BillingProvider } from "./BillingProvider.js";
import { MockBillingProvider } from "./MockBillingProvider.js";
import { PaddleBillingProvider } from "./PaddleBillingProvider.js";

let instance: BillingProvider | null = null;
let mockInstance: MockBillingProvider | null = null;

/**
 * Lazy-singleton provider getter, mirroring apps/api/src/payments/index.ts exactly. "mock" is the
 * only provider this project's own automated tests ever select. "paddle" (Phase 27) is real,
 * network-capable code (see PaddleBillingProvider.ts's header comment for exactly what's verified
 * vs. assumed) but throws clearly if selected without PADDLE_API_KEY/PADDLE_WEBHOOK_SECRET
 * configured, rather than silently falling back to the mock — mirrors payments/index.ts's
 * getPaymentProvider's "safepay" handling exactly.
 */
export function getBillingProvider(): BillingProvider {
  if (instance) return instance;
  if (env.BILLING_PROVIDER === "mock") {
    instance = new MockBillingProvider(env.MOCK_BILLING_WEBHOOK_SECRET);
    return instance;
  }
  if (env.BILLING_PROVIDER === "paddle") {
    if (!env.PADDLE_API_KEY || !env.PADDLE_WEBHOOK_SECRET) {
      throw new Error("BILLING_PROVIDER=paddle requires PADDLE_API_KEY and PADDLE_WEBHOOK_SECRET to be configured.");
    }
    instance = new PaddleBillingProvider(env.PADDLE_API_KEY, env.PADDLE_WEBHOOK_SECRET, PaddleBillingProvider.baseUrlForEnv(env.PADDLE_ENV));
    return instance;
  }
  throw new Error(`BILLING_PROVIDER="${env.BILLING_PROVIDER as string}" is not a recognized provider.`);
}

/** Test/dev-only accessor for the mock provider's driver surface (simulateEvent/signPayload) —
 *  throws if a different provider is configured, same as getBillingProvider(). */
export function getMockBillingProvider(): MockBillingProvider {
  const provider = getBillingProvider();
  if (!(provider instanceof MockBillingProvider)) {
    throw new Error("The mock billing driver is only available when BILLING_PROVIDER=mock.");
  }
  mockInstance = provider;
  return mockInstance;
}
