import type { HydratedDocument } from "mongoose";
import type { RestaurantDoc } from "../models/Restaurant.js";
import { RestaurantDeliveryProviderAccount, type RestaurantDeliveryProviderAccountDoc } from "../models/RestaurantDeliveryProviderAccount.js";
import { decryptCredentials, type EncryptedBlob } from "../utils/credentialEncryption.js";
import { UberDirectProvider } from "./UberDirectProvider.js";
import { getManualDeliveryProvider } from "./index.js";
import type { DeliveryProvider } from "./DeliveryProvider.js";
import { logger } from "../common/logger.js";

export interface UberDirectCredentials {
  clientId: string;
  clientSecret: string;
  customerId: string;
  /** Phase 89 — optional: added after connecting, once Uber has issued it for our webhook URL. */
  webhookSigningSecret?: string;
}

/**
 * BYOC — mirrors payments/restaurantProvider.ts's buildProviderFromAccount exactly. No caching: a
 * fresh instance per call is cheap (the constructor only holds args; no network I/O happens until
 * a real call is made) and avoids ever needing to invalidate a stale instance after a restaurant
 * reconnects/disconnects its account.
 */
export function buildDeliveryProviderFromAccount(account: RestaurantDeliveryProviderAccountDoc): DeliveryProvider {
  if (account.provider === "uber_direct") {
    const blob = account.encryptedCredentials as EncryptedBlob;
    const creds = decryptCredentials<UberDirectCredentials>(blob);
    // Phase 89 — the account id scopes the shared token cache (uberDirectTokenCache.ts), so tokens
    // are reused across these per-call instances but never across accounts.
    const accountId = (account as { _id?: { toString(): string } })._id?.toString();
    return new UberDirectProvider(creds.clientId, creds.clientSecret, creds.customerId, creds.webhookSigningSecret ?? "", {
      tokenScope: accountId ? `account:${accountId}` : undefined,
    });
  }
  throw new Error(`"${account.provider as string}" is not a BYOC-eligible delivery provider.`);
}

/**
 * The one entry point deliveryDispatch.service.ts calls — hides "manual vs. a connected
 * third-party account" behind a single resolution. `Restaurant.settings.deliveryProvider` names
 * which provider this location WANTS to use; if it names a third-party provider with no currently
 * active connected account (never connected, disconnected, or a credential that failed
 * verification), this falls back to "manual" rather than blocking delivery dispatch entirely — a
 * misconfigured/unavailable third-party provider must never be the reason an order can't be
 * fulfilled at all (Part 5: "a failed delivery request should have a clear internal state," not a
 * dead end). The fallback is never silent: the caller is told whether a fallback happened so the
 * resulting Delivery record and any restaurant-facing message can say so honestly.
 */
export async function resolveDeliveryProviderForRestaurant(
  restaurant: HydratedDocument<RestaurantDoc>
): Promise<{ provider: DeliveryProvider; accountId?: string; fellBackToManual: boolean; fallbackReason?: string }> {
  const restaurantId = restaurant.id as string;
  const wanted = restaurant.settings.deliveryProvider ?? "manual";
  if (wanted === "manual") {
    return { provider: getManualDeliveryProvider(), fellBackToManual: false };
  }

  const account = await RestaurantDeliveryProviderAccount.findOne({
    restaurantId,
    provider: wanted,
    status: "active",
  });
  if (!account) {
    logger.warn("delivery provider configured but not connected — falling back to manual dispatch", {
      restaurantId,
      wanted,
    });
    return { provider: getManualDeliveryProvider(), fellBackToManual: true, fallbackReason: "the courier account is not connected" };
  }
  // Phase 89 — no courier is booked until the webhook signing secret is added: without it every
  // status update from the provider is rejected, so a booked delivery would never progress here.
  // (Connecting and seeing the webhook URL still work before it — see the account controller.)
  if (account.webhookSecretConfigured === false) {
    logger.warn("courier account has no webhook signing secret yet — falling back to manual dispatch", { restaurantId, wanted });
    return {
      provider: getManualDeliveryProvider(),
      fellBackToManual: true,
      fallbackReason: "the courier account's webhook signing secret hasn't been added yet (Settings → Delivery)",
    };
  }

  try {
    return { provider: buildDeliveryProviderFromAccount(account), accountId: account._id.toString(), fellBackToManual: false };
  } catch (err) {
    logger.warn("delivery provider account could not be built — falling back to manual dispatch", {
      restaurantId,
      wanted,
      error: (err as Error).message,
    });
    return { provider: getManualDeliveryProvider(), fellBackToManual: true, fallbackReason: "the courier account could not be loaded" };
  }
}

/**
 * Phase 89 — whether a delivery order for this restaurant would actually be booked with a
 * third-party courier (connected, active, signing secret added) — the case where the courier needs
 * the customer's phone, so checkout must collect one. Same conditions resolveDeliveryProviderForRestaurant uses.
 */
export async function thirdPartyCourierWillDispatch(restaurant: Pick<RestaurantDoc, "settings"> & { _id: unknown }): Promise<boolean> {
  const wanted = restaurant.settings?.deliveryProvider ?? "manual";
  if (wanted === "manual") return false;
  const account = await RestaurantDeliveryProviderAccount.findOne({ restaurantId: restaurant._id, provider: wanted, status: "active" }).select("webhookSecretConfigured");
  return Boolean(account) && account!.webhookSecretConfigured !== false;
}
