import { createHash, randomBytes } from "node:crypto";
import { redis } from "../config/redis.js";

/**
 * In-app subscription checkout runs on garnishtable.com, not on the app's own host (27 Nov 2026).
 *
 * Paddle only opens its checkout on domains it has approved. garnishtable.com is approved; the
 * owner portal's host (app.garnishtable.com) was refused twice in review. So when an owner (or
 * agency) clicks Subscribe in the app, the API prepares the exact same checkout as before (same
 * price, same Paddle customer, same custom data the webhook uses to link the subscription) and
 * stores it here under a one-time link: garnishtable.com/checkout#handoff=<token>. That page reads it
 * (POST /public/checkout/handoff) and opens Paddle's form. Nothing about payment confirmation
 * changes: access is still granted only by Paddle's signed webhook.
 *
 * The token is random, stored only as a hash, kept 30 minutes, and lives in the URL fragment (never
 * sent to a server in a request line, so never in access logs). Holding it lets someone open a
 * checkout that pays for that owner's plan: nothing more.
 */
export interface CheckoutHandoff {
  clientToken: string;
  environment: "sandbox" | "production";
  providerPriceId: string;
  providerCustomerId: string;
  /** Exactly what the in-app overlay sent: ownerType, ownerId, planCode, billingInterval. */
  customData: Record<string, string>;
  planName: string;
  billingInterval: "monthly" | "yearly";
  /** Where to send the owner after paying (their Billing page in the app). */
  returnUrl: string;
}

export const CHECKOUT_HANDOFF_TTL_SECONDS = 30 * 60;
const key = (token: string) => `checkout-handoff:${createHash("sha256").update(token).digest("hex")}`;

export async function createCheckoutHandoff(handoff: CheckoutHandoff): Promise<string> {
  const token = randomBytes(24).toString("base64url");
  await redis.set(key(token), JSON.stringify(handoff), "EX", CHECKOUT_HANDOFF_TTL_SECONDS);
  return token;
}

/** Null when the link is unknown or has expired. Readable more than once within its 30 minutes, so
 *  closing Paddle's form and opening it again (or reloading the page) still works. */
export async function readCheckoutHandoff(token: string): Promise<CheckoutHandoff | null> {
  const raw = await redis.get(key(token));
  return raw ? (JSON.parse(raw) as CheckoutHandoff) : null;
}
