import type { Request, Response } from "express";
import type { ConnectRestaurantPaymentAccountInput } from "@restaurant/validation";
import { Restaurant } from "../models/Restaurant.js";
import { RestaurantPaymentAccount } from "../models/RestaurantPaymentAccount.js";
import { ApiError } from "../utils/ApiError.js";
import { sendSuccess } from "../common/response.js";
import { encryptCredentials } from "../utils/credentialEncryption.js";
import { buildProviderFromAccount } from "../payments/restaurantProvider.js";
import { recordAuditEvent } from "../services/audit.service.js";
import { env } from "../config/env.js";

/** "sk_test_abc123xyz" -> "sk_test_····xyz" — display-safe, never reversible, never the full key. */
function fingerprint(secret: string): string {
  const tail = secret.slice(-4);
  const head = secret.slice(0, Math.max(0, secret.length - 4 - 4));
  return `${head.slice(0, 8)}····${tail}`;
}

function identifyingSecret(input: ConnectRestaurantPaymentAccountInput): string {
  return input.provider === "stripe" ? input.credentials.secretKey : input.credentials.apiKey;
}

export async function getRestaurantPaymentAccount(req: Request, res: Response) {
  const account = await RestaurantPaymentAccount.findOne({
    restaurantId: req.params.restaurantId,
    status: { $ne: "disconnected" },
  }).sort({ createdAt: -1 });
  sendSuccess(res, {
    account: account ? account.toJSON() : null,
    webhookUrl: account ? `${env.API_PUBLIC_ORIGIN}/api/v1/webhooks/payments/${account.provider}/${account._id.toString()}` : null,
  });
}

/**
 * Connects (or reconnects) a restaurant's own payment account — creates the row and synchronously
 * verifies it in the same request (no separate "verified" stage, unlike DomainMapping's DNS-gap
 * lifecycle; there's no equivalent gap here). On success, atomically activates the new row and
 * disconnects any prior active one so the partial unique index on {restaurantId, status:"active"}
 * is never transiently violated.
 */
export async function connectRestaurantPaymentAccount(req: Request, res: Response) {
  const input = req.body as ConnectRestaurantPaymentAccountInput;
  const restaurant = await Restaurant.findById(req.params.restaurantId);
  if (!restaurant) throw ApiError.notFound("Restaurant not found");
  if (!restaurant.businessId) throw ApiError.badRequest("This restaurant has no business association yet");

  const encryptedCredentials = encryptCredentials(input.credentials);
  const account = new RestaurantPaymentAccount({
    restaurantId: restaurant._id,
    businessId: restaurant.businessId,
    provider: input.provider,
    status: "pending_verification",
    encryptedCredentials,
    credentialFingerprint: fingerprint(identifyingSecret(input)),
    connectedByUserId: req.user!.id,
  });

  const verified = await buildProviderFromAccount(account).verifyCredentials();
  if (!verified) {
    account.status = "invalid";
    account.lastVerificationError = "These credentials could not be verified against the provider.";
    await account.save();
    sendSuccess(res, { account: account.toJSON() }, 201);
    return;
  }

  account.status = "active";
  account.lastVerifiedAt = new Date();
  await account.save();
  // Deliberately AFTER the new row is saved, not a single atomic multi-document transaction: the
  // partial unique index on {restaurantId, status:"active"} is what actually prevents two active
  // rows from ever being readable at once — if this second write were to fail, the worst case is a
  // dangling old "active" row a subsequent connect attempt would immediately hit the index conflict
  // on, not a silent double-active state.
  await RestaurantPaymentAccount.updateMany(
    { restaurantId: restaurant._id, status: "active", _id: { $ne: account._id } },
    { $set: { status: "disconnected" } }
  );

  await recordAuditEvent({
    restaurantId: restaurant._id,
    actorUserId: req.user!.id,
    actorRole: req.user!.role,
    action: "payment_account.connected",
    targetType: "payment_account",
    targetId: account._id,
    metadata: { provider: input.provider, fingerprint: account.credentialFingerprint },
  });

  sendSuccess(
    res,
    {
      account: account.toJSON(),
      // Pasted by the restaurant owner into their OWN Stripe/Safepay dashboard's webhook config —
      // see paymentWebhook.routes.ts's handleRestaurantAccountWebhook, the only way a shared
      // endpoint can know which restaurant-specific secret to verify a delivery against.
      webhookUrl: `${env.API_PUBLIC_ORIGIN}/api/v1/webhooks/payments/${account.provider}/${account._id.toString()}`,
    },
    201
  );
}

export async function disconnectRestaurantPaymentAccount(req: Request, res: Response) {
  const account = await RestaurantPaymentAccount.findOne({
    restaurantId: req.params.restaurantId,
    status: "active",
  });
  if (!account) throw ApiError.notFound("This restaurant has no connected payment account");

  account.status = "disconnected";
  await account.save();

  await recordAuditEvent({
    restaurantId: account.restaurantId!,
    actorUserId: req.user!.id,
    actorRole: req.user!.role,
    action: "payment_account.disconnected",
    targetType: "payment_account",
    targetId: account._id,
    metadata: { provider: account.provider, fingerprint: account.credentialFingerprint },
  });

  sendSuccess(res, { account: account.toJSON() });
}
