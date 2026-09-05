import type { Request, Response } from "express";
import type { ConnectUberDirectAccountInput } from "@restaurant/validation";
import { Restaurant } from "../models/Restaurant.js";
import { RestaurantDeliveryProviderAccount } from "../models/RestaurantDeliveryProviderAccount.js";
import { ApiError } from "../utils/ApiError.js";
import { sendSuccess } from "../common/response.js";
import { encryptCredentials } from "../utils/credentialEncryption.js";
import { buildDeliveryProviderFromAccount } from "../deliveryProviders/restaurantDeliveryProvider.js";
import { recordAuditEvent } from "../services/audit.service.js";
import { env } from "../config/env.js";

/** "abc123xyz" -> "abc1····3xyz" — display-safe, never reversible, never the full secret. Mirrors
 *  restaurantPaymentAccount.controller.ts's own fingerprint helper exactly. */
function fingerprint(secret: string): string {
  const tail = secret.slice(-4);
  const head = secret.slice(0, Math.max(0, secret.length - 4 - 4));
  return `${head.slice(0, 8)}····${tail}`;
}

export async function getRestaurantDeliveryProviderAccount(req: Request, res: Response) {
  const account = await RestaurantDeliveryProviderAccount.findOne({
    restaurantId: req.params.restaurantId,
    status: { $ne: "disconnected" },
  }).sort({ createdAt: -1 });
  sendSuccess(res, {
    account: account ? account.toJSON() : null,
    // Pasted by the restaurant owner into their own Uber Direct dashboard's webhook config — the
    // only way handleDeliveryProviderWebhook (BYOC-only, no platform-pooled equivalent) can know
    // which restaurant-specific signing secret to verify a delivery against.
    webhookUrl: account ? `${env.API_PUBLIC_ORIGIN}/api/v1/webhooks/deliveries/${account.provider}/${account._id.toString()}` : null,
  });
}

/**
 * Connects (or reconnects) a restaurant's own Uber Direct account via manually-entered credentials
 * — mirrors restaurantPaymentAccount.controller.ts's connectRestaurantPaymentAccount exactly (same
 * encrypt-then-verify-then-activate flow, same partial-unique-index-safe atomic activate/disconnect
 * ordering). Uber Direct is BYOC-only — see restaurantDeliveryProvider.ts's header comment — so this
 * is the ONLY way a restaurant ever gets a working third-party delivery provider connected; there is
 * no OAuth/hosted-onboarding equivalent the way Stripe Connect has for payments.
 */
export async function connectUberDirectAccount(req: Request, res: Response) {
  const input = req.body as ConnectUberDirectAccountInput;
  const restaurant = await Restaurant.findById(req.params.restaurantId);
  if (!restaurant) throw ApiError.notFound("Restaurant not found");
  if (!restaurant.businessId) throw ApiError.badRequest("This restaurant has no business association yet");

  const encryptedCredentials = encryptCredentials(input);
  const account = new RestaurantDeliveryProviderAccount({
    restaurantId: restaurant._id,
    businessId: restaurant.businessId,
    provider: "uber_direct",
    status: "pending_verification",
    encryptedCredentials,
    credentialFingerprint: fingerprint(input.customerId),
    connectedByUserId: req.user!.id,
  });

  const verified = await buildDeliveryProviderFromAccount(account).healthCheck();
  if (!verified) {
    account.status = "invalid";
    account.lastVerificationError = "These credentials could not be verified against Uber Direct.";
    await account.save();
    sendSuccess(res, { account: account.toJSON() }, 201);
    return;
  }

  // Disconnect any existing active account for this restaurant+provider BEFORE saving the new one
  // as active — not after. The partial unique index on {restaurantId, provider, status:"active"}
  // enforces at most one active row at any instant it's actually checked; saving a second active
  // row while the first is still active is a genuine E11000 duplicate-key conflict, not something
  // the index politely waits around for a following updateMany to resolve. (The equivalent
  // payment-account connect flow — restaurantPaymentAccount.controller.ts — does the disconnect
  // step AFTER the new save instead, which reproduces exactly this collision; not touched here as
  // it's outside this phase's scope, but worth fixing there too.)
  await RestaurantDeliveryProviderAccount.updateMany(
    { restaurantId: restaurant._id, provider: "uber_direct", status: "active", _id: { $ne: account._id } },
    { $set: { status: "disconnected" } }
  );
  account.status = "active";
  account.lastVerifiedAt = new Date();
  await account.save();

  await recordAuditEvent({
    restaurantId: restaurant._id,
    actorUserId: req.user!.id,
    actorRole: req.user!.role,
    action: "delivery_account.connected",
    targetType: "delivery_account",
    targetId: account._id,
    metadata: { provider: "uber_direct", fingerprint: account.credentialFingerprint },
  });

  sendSuccess(
    res,
    {
      account: account.toJSON(),
      webhookUrl: `${env.API_PUBLIC_ORIGIN}/api/v1/webhooks/deliveries/uber_direct/${account._id.toString()}`,
    },
    201
  );
}

export async function disconnectRestaurantDeliveryProviderAccount(req: Request, res: Response) {
  const account = await RestaurantDeliveryProviderAccount.findOne({
    restaurantId: req.params.restaurantId,
    status: { $in: ["active", "pending_verification", "invalid"] },
  }).sort({ createdAt: -1 });
  if (!account) throw ApiError.notFound("This restaurant has no connected delivery provider account");

  account.status = "disconnected";
  await account.save();

  await recordAuditEvent({
    restaurantId: account.restaurantId!,
    actorUserId: req.user!.id,
    actorRole: req.user!.role,
    action: "delivery_account.disconnected",
    targetType: "delivery_account",
    targetId: account._id,
    metadata: { provider: account.provider, fingerprint: account.credentialFingerprint },
  });

  sendSuccess(res, { account: account.toJSON() });
}
