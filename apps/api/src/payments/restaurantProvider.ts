import { RestaurantPaymentAccount, type RestaurantPaymentAccountDoc } from "../models/RestaurantPaymentAccount.js";
import { decryptCredentials, type EncryptedBlob } from "../utils/credentialEncryption.js";
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

export type { StripeCredentials, SafepayCredentials };
