import { RestaurantPaymentAccount, type RestaurantPaymentAccountDoc } from "../models/RestaurantPaymentAccount.js";
import { decryptCredentials, type EncryptedBlob } from "../utils/credentialEncryption.js";
import { env } from "../config/env.js";
import { SafepayProvider } from "./SafepayProvider.js";
import { StripeProvider } from "./StripeProvider.js";
import type { PaymentProvider } from "./PaymentProvider.js";

interface StripeCredentials {
  secretKey: string;
  webhookSecret: string;
}

interface SafepayCredentials {
  apiKey: string;
  secretKey: string;
  webhookSecret: string;
  env: "sandbox" | "production";
}

/**
 * BYOC ("bring your own credentials") — restaurant-owned payment accounts. Deliberately bypasses
 * payments/index.ts's `getPaymentProvider()` registry entirely: that Map is cached by provider
 * NAME only ("stripe"/"safepay"), which is exactly right for one platform-wide pooled account per
 * provider, but would serve one restaurant's decrypted credentials to another if reused here. No
 * caching is added for BYOC instances — constructing an adapter only holds constructor args, no
 * network I/O happens until a real call is made, so a fresh instance per call is cheap and avoids
 * ever needing to invalidate a stale cache after a restaurant reconnects/disconnects.
 */
export function buildProviderFromAccount(account: RestaurantPaymentAccountDoc): PaymentProvider {
  // Phase 37 — platform_connect (Stripe Connect) never has encryptedCredentials at all: the
  // platform's OWN STRIPE_SECRET_KEY plus this account's stored connectedAccountId (via the
  // Stripe-Account header — StripeProvider.ts) is everything a Direct Charge needs. This is the
  // whole point of the redesign — nothing restaurant-specific is ever decrypted here for Stripe.
  if (account.provider === "stripe" && account.connectionMode === "platform_connect") {
    if (!env.STRIPE_SECRET_KEY) throw new Error("STRIPE_SECRET_KEY is not configured on this deployment");
    if (!account.connectedAccountId) throw new Error("This account has no connectedAccountId — onboarding was never completed");
    // `as string` — InferSchemaType's known quirk with this optional top-level field; real and
    // string-typed at runtime, guaranteed set by the check just above.
    return new StripeProvider(env.STRIPE_SECRET_KEY, "", undefined, account.connectedAccountId as string);
  }

  // The nested subdocument's leaf fields are all explicitly typed strings/numbers in the schema
  // (RestaurantPaymentAccount.ts), so this shape is guaranteed at runtime — Mongoose's
  // InferSchemaType just doesn't carry that through for a plain nested-object path the way it does
  // for top-level fields.
  const blob = account.encryptedCredentials as EncryptedBlob;
  if (account.provider === "stripe") {
    const creds = decryptCredentials<StripeCredentials>(blob);
    return new StripeProvider(creds.secretKey, creds.webhookSecret);
  }
  if (account.provider === "safepay") {
    const creds = decryptCredentials<SafepayCredentials>(blob);
    return new SafepayProvider(creds.apiKey, creds.secretKey, creds.webhookSecret, SafepayProvider.baseUrlForEnv(creds.env));
  }
  // "mock" is excluded from the schema's provider enum — this is unreachable in practice, but
  // typed defensively rather than asserted away, matching this codebase's fail-closed convention.
  throw new Error(`"${account.provider as string}" is not a BYOC-eligible payment provider.`);
}

/**
 * Resolves a restaurant's OWN connected payment account, if it has one — the entry point
 * `createPaymentForOrder`/`refundPayment` (payment.service.ts) check FIRST, before falling back to
 * the existing pooled/eligibility-engine default. Returns null (never throws) when the restaurant
 * has no active BYOC account, which is the common case and must stay a cheap, silent no-op so every
 * existing restaurant's behavior is completely unchanged.
 */
export async function resolveRestaurantPaymentProvider(
  restaurantId: string
): Promise<{ provider: PaymentProvider; accountId: string } | null> {
  const account = await RestaurantPaymentAccount.findOne({ restaurantId, status: "active" });
  if (!account) return null;
  return { provider: buildProviderFromAccount(account), accountId: account._id.toString() };
}

/**
 * Phase 42 — a cheap existence check for the production-safety gate below and the settings-update
 * gate (restaurant.controller.ts). Deliberately does NOT go through resolveRestaurantPaymentProvider/
 * buildProviderFromAccount: those decrypt credentials and (for platform_connect) require
 * STRIPE_SECRET_KEY to be configured just to answer a yes/no existence question, which is wasted
 * work and a wrong failure mode for a plain "is this restaurant connected" check.
 */
export async function hasActiveRestaurantPaymentAccount(restaurantId: string): Promise<boolean> {
  return (await RestaurantPaymentAccount.exists({ restaurantId, status: "active" })) !== null;
}

/**
 * Phase 42 — the single safety rule behind "BYOC required before real online payments": a
 * restaurant may accept a real online payment when it has its own connected account, OR when the
 * platform-wide pooled default is still the mock provider (dev/test/demo — never real money). Once
 * a deployment configures a REAL pooled default (PAYMENT_PROVIDER=stripe/safepay), a restaurant
 * with no account of its own must be blocked rather than silently routed through the platform's
 * pooled credentials — see docs/payment-provider-decision.md's "BYOC required" update for why. Pure
 * and parameterized (no env/DB access) so both call sites (payment.service.ts at the point money
 * actually moves, restaurant.controller.ts at the point a restaurant tries to enable the setting)
 * share one tested rule instead of two copies that could drift.
 */
export function canProcessOnlinePayments(hasOwnAccount: boolean, pooledProviderName: string): boolean {
  return hasOwnAccount || pooledProviderName === "mock";
}

export type { StripeCredentials, SafepayCredentials };
