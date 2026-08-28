import { env } from "../config/env.js";
import type { PaymentProvider } from "./PaymentProvider.js";
import { MockPaymentProvider } from "./MockPaymentProvider.js";
import { SafepayProvider } from "./SafepayProvider.js";
import { StripeProvider } from "./StripeProvider.js";

export type PaymentProviderName = "mock" | "safepay" | "stripe";

const instances = new Map<PaymentProviderName, PaymentProvider>();

function buildProvider(name: PaymentProviderName): PaymentProvider {
  if (name === "mock") {
    return new MockPaymentProvider(env.MOCK_PAYMENT_WEBHOOK_SECRET);
  }

  if (name === "safepay") {
    if (!env.SAFEPAY_API_KEY || !env.SAFEPAY_SECRET_KEY || !env.SAFEPAY_WEBHOOK_SECRET) {
      throw new Error(
        "Provider \"safepay\" requires SAFEPAY_API_KEY, SAFEPAY_SECRET_KEY, and SAFEPAY_WEBHOOK_SECRET to all be set."
      );
    }
    return new SafepayProvider(env.SAFEPAY_API_KEY, env.SAFEPAY_SECRET_KEY, env.SAFEPAY_WEBHOOK_SECRET, SafepayProvider.baseUrlForEnv(env.SAFEPAY_ENV));
  }

  if (name === "stripe") {
    if (!env.STRIPE_SECRET_KEY || !env.STRIPE_WEBHOOK_SECRET) {
      throw new Error('Provider "stripe" requires STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET to both be set.');
    }
    return new StripeProvider(env.STRIPE_SECRET_KEY, env.STRIPE_WEBHOOK_SECRET);
  }

  throw new Error(`"${name as string}" is not a recognized payment provider.`);
}

/**
 * Phase 15/29: a lazy-singleton provider getter, mirroring email/index.ts and
 * services/geocoding/index.ts — never throws at boot, only when a route actually tries to use an
 * unconfigured provider.
 *
 * Phase 34: widened from a single process-wide singleton to a small keyed registry, each concrete
 * adapter still built lazily/once and cached. `getPaymentProvider()` with no argument keeps
 * today's exact behavior (env.PAYMENT_PROVIDER's configured default) — every existing call site
 * (payment.service.ts's refundPayment, the mock driver controller, every existing test) is
 * unaffected. The new optional argument is for payments/eligibility.ts, which resolves a specific
 * provider PER RESTAURANT (e.g. safepay for Pakistan, stripe elsewhere) — something a single
 * env-var-selected singleton could never express, and paymentWebhook.controller.ts, which now looks
 * up the provider the webhook URL itself names (:provider) instead of comparing against a fixed
 * default's `.name`.
 */
export function getPaymentProvider(name?: PaymentProviderName): PaymentProvider {
  const resolved = name ?? env.PAYMENT_PROVIDER;
  const cached = instances.get(resolved);
  if (cached) return cached;
  const built = buildProvider(resolved);
  instances.set(resolved, built);
  return built;
}

export const KNOWN_PAYMENT_PROVIDER_NAMES: PaymentProviderName[] = ["mock", "safepay", "stripe"];

/** Test/dev-only accessor for the mock provider's driver surface (simulateOutcome/signPayload) —
 *  throws if the DEFAULT provider isn't mock, same as before Phase 34's registry change. */
export function getMockPaymentProvider(): MockPaymentProvider {
  const provider = getPaymentProvider();
  if (!(provider instanceof MockPaymentProvider)) {
    throw new Error("The mock payment driver is only available when PAYMENT_PROVIDER=mock.");
  }
  return provider;
}
