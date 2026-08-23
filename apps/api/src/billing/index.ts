import { env } from "../config/env.js";
import type { BillingProvider } from "./BillingProvider.js";
import { MockBillingProvider } from "./MockBillingProvider.js";

let instance: BillingProvider | null = null;
let mockInstance: MockBillingProvider | null = null;

/**
 * Lazy-singleton provider getter, mirroring apps/api/src/payments/index.ts exactly. Only "mock" is
 * a valid value this phase — no real billing provider is integrated (see BillingProvider.ts's
 * header comment) — so the env enum deliberately has no second option yet rather than a value that
 * would silently no-op if ever selected.
 */
export function getBillingProvider(): BillingProvider {
  if (instance) return instance;
  if (env.BILLING_PROVIDER === "mock") {
    instance = new MockBillingProvider(env.MOCK_BILLING_WEBHOOK_SECRET);
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
