import type { Request, Response } from "express";
import type { ConnectRestaurantPaymentAccountInput } from "@restaurant/validation";
import { Restaurant } from "../models/Restaurant.js";
import { RestaurantPaymentAccount } from "../models/RestaurantPaymentAccount.js";
import { ApiError } from "../utils/ApiError.js";
import { sendSuccess } from "../common/response.js";
import { encryptCredentials } from "../utils/credentialEncryption.js";
import { buildProviderFromAccount } from "../payments/restaurantProvider.js";
import {
  createAccountLink,
  createConnectedAccount,
  resolveConnectAccountStatus,
  retrieveConnectedAccountStatus,
} from "../payments/stripeConnect.js";
import { recordAuditEvent } from "../services/audit.service.js";
import { env } from "../config/env.js";

/** "sk_test_abc123xyz" -> "sk_test_····xyz" — display-safe, never reversible, never the full key. */
function fingerprint(secret: string): string {
  const tail = secret.slice(-4);
  const head = secret.slice(0, Math.max(0, secret.length - 4 - 4));
  return `${head.slice(0, 8)}····${tail}`;
}

export async function getRestaurantPaymentAccount(req: Request, res: Response) {
  const account = await RestaurantPaymentAccount.findOne({
    restaurantId: req.params.restaurantId,
    status: { $ne: "disconnected" },
  }).sort({ createdAt: -1 });
  sendSuccess(res, {
    account: account ? account.toJSON() : null,
    // Phase 37 — meaningful only for merchant_credentials (Safepay): the restaurant pastes this
    // URL into their own dashboard, the only way a shared endpoint can know which
    // restaurant-specific secret to verify a delivery against. A platform_connect (Stripe) account
    // has no equivalent — its webhook is one centralized platform-level endpoint the restaurant
    // never sees or configures (see paymentWebhook.routes.ts's handleStripeConnectWebhook).
    webhookUrl:
      account && account.connectionMode === "merchant_credentials"
        ? `${env.API_PUBLIC_ORIGIN}/api/v1/webhooks/payments/${account.provider}/${account._id.toString()}`
        : null,
  });
}

/**
 * Connects (or reconnects) a restaurant's own Safepay account via manually-entered credentials —
 * Safepay-only as of Phase 37 (see packages/validation/src/restaurantPaymentAccount.ts's header
 * comment for why: their current docs confirm no provider-native connection mechanism exists).
 * Creates the row and synchronously verifies it in the same request (no separate "verified" stage,
 * unlike DomainMapping's DNS-gap lifecycle; there's no equivalent gap here). On success, atomically
 * activates the new row and disconnects any prior active one so the partial unique index on
 * {restaurantId, status:"active"} is never transiently violated.
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
    provider: "safepay",
    connectionMode: "merchant_credentials",
    status: "pending_verification",
    encryptedCredentials,
    credentialFingerprint: fingerprint(input.credentials.apiKey),
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

  // Disconnect any existing active account for this restaurant BEFORE saving the new one as active
  // — not after. The partial unique index on {restaurantId, status:"active"} enforces at most one
  // active row at any instant it's actually checked; saving a second active row while the first is
  // still active is a genuine E11000 duplicate-key conflict, not something the index waits around
  // for a following updateMany to resolve (this exact ordering bug was caught and fixed the same
  // way in restaurantDeliveryProviderAccount.controller.ts's connect flow — see Phase 40).
  await RestaurantPaymentAccount.updateMany(
    { restaurantId: restaurant._id, status: "active", _id: { $ne: account._id } },
    { $set: { status: "disconnected" } }
  );
  account.status = "active";
  account.lastVerifiedAt = new Date();
  await account.save();

  await recordAuditEvent({
    restaurantId: restaurant._id,
    actorUserId: req.user!.id,
    actorRole: req.user!.role,
    action: "payment_account.connected",
    targetType: "payment_account",
    targetId: account._id,
    metadata: { provider: "safepay", fingerprint: account.credentialFingerprint },
  });

  sendSuccess(
    res,
    {
      account: account.toJSON(),
      // Pasted by the restaurant owner into their OWN Safepay dashboard's webhook config — see
      // paymentWebhook.routes.ts's handleRestaurantAccountWebhook, the only way a shared endpoint
      // can know which restaurant-specific secret to verify a delivery against.
      webhookUrl: `${env.API_PUBLIC_ORIGIN}/api/v1/webhooks/payments/safepay/${account._id.toString()}`,
    },
    201
  );
}

/**
 * POST /restaurants/:restaurantId/payment-account/connect/stripe (Phase 37) — starts (or resumes)
 * Stripe's real hosted-onboarding flow. Never collects a secret key: creates a Standard connected
 * account if one doesn't already exist for this restaurant, then returns a single-use Account Link
 * URL for the frontend to redirect the browser to. `restaurant.country` is required and can never
 * be changed after the connected account is created — resolved from the restaurant's OWN stored
 * record, never trusted from the request body.
 */
export async function connectStripeConnect(req: Request, res: Response) {
  const restaurant = await Restaurant.findById(req.params.restaurantId);
  if (!restaurant) throw ApiError.notFound("Restaurant not found");
  if (!restaurant.businessId) throw ApiError.badRequest("This restaurant has no business association yet");
  if (!restaurant.country) {
    throw ApiError.badRequest("Set this restaurant's country in Settings before connecting Stripe — it can't be changed afterward");
  }
  if (!restaurant.email) {
    throw ApiError.badRequest("Set this restaurant's contact email in Settings before connecting Stripe — it's how Stripe will reach the account holder");
  }

  // Resume: an existing not-yet-active attempt reuses the SAME connected account (a fresh
  // Account Link for it) rather than creating a new Stripe account every time the owner clicks
  // "Connect" again — Stripe accounts are not cheap, disposable objects.
  let account = await RestaurantPaymentAccount.findOne({
    restaurantId: restaurant._id,
    provider: "stripe",
    connectionMode: "platform_connect",
    status: { $in: ["pending_verification", "action_required"] },
  });

  if (!account) {
    const connectedAccountId = await createConnectedAccount(restaurant.country, restaurant.email);
    account = await RestaurantPaymentAccount.create({
      restaurantId: restaurant._id,
      businessId: restaurant.businessId,
      provider: "stripe",
      connectionMode: "platform_connect",
      status: "pending_verification",
      connectedAccountId,
      connectedByUserId: req.user!.id,
    });
  }

  const refreshUrl = `${env.ADMIN_ORIGIN}/restaurants/${restaurant.id}/settings?stripeConnect=refresh`;
  const returnUrl = `${env.ADMIN_ORIGIN}/restaurants/${restaurant.id}/settings?stripeConnect=return`;
  // `as string` — InferSchemaType's known quirk with this optional top-level field (same class of
  // gotcha this codebase already works around elsewhere, e.g. restaurantProvider.ts); real and
  // Date/string-typed at runtime, guaranteed set by the branch above.
  const url = await createAccountLink(account.connectedAccountId as string, refreshUrl, returnUrl);

  sendSuccess(res, { url });
}

/**
 * POST /restaurants/:restaurantId/payment-account/sync-stripe-status (Phase 37) — called by the
 * frontend once when it lands back on return_url. Per Stripe's own documentation, completing the
 * redirect "doesn't mean that all information has been collected, or that there are no outstanding
 * requirements" — the only real source of truth is retrieving the account fresh and checking its
 * actual capabilities, never inferred from the redirect itself.
 */
export async function syncStripeConnectStatus(req: Request, res: Response) {
  const account = await RestaurantPaymentAccount.findOne({
    restaurantId: req.params.restaurantId,
    provider: "stripe",
    connectionMode: "platform_connect",
    status: { $ne: "disconnected" },
  }).sort({ createdAt: -1 });
  if (!account?.connectedAccountId) throw ApiError.notFound("No Stripe connection in progress for this restaurant");

  const status = await retrieveConnectedAccountStatus(account.connectedAccountId as string);
  account.chargesEnabled = status.chargesEnabled;
  account.payoutsEnabled = status.payoutsEnabled;
  account.requirementsDue = status.requirementsDue;
  account.disabledReason = status.disabledReason ?? undefined;
  account.lastVerifiedAt = new Date();

  const wasActive = account.status === "active";
  account.status = resolveConnectAccountStatus(status);
  if (account.status === "invalid") {
    account.lastVerificationError = "Stripe rejected this account — see your Stripe dashboard for details.";
  }

  // Disconnect any other active account BEFORE saving this one as active — not after. See
  // connectRestaurantPaymentAccount's identical fix above for why the ordering matters: the
  // partial unique index on {restaurantId, status:"active"} rejects this save outright if another
  // row is still active at the moment it's persisted.
  if (account.status === "active" && !wasActive) {
    await RestaurantPaymentAccount.updateMany(
      { restaurantId: account.restaurantId, status: "active", _id: { $ne: account._id } },
      { $set: { status: "disconnected" } }
    );
  }
  await account.save();

  if (account.status === "active" && !wasActive) {
    await recordAuditEvent({
      restaurantId: account.restaurantId!,
      actorUserId: req.user!.id,
      actorRole: req.user!.role,
      action: "payment_account.connected",
      targetType: "payment_account",
      targetId: account._id,
      metadata: { provider: "stripe", connectionMode: "platform_connect", connectedAccountId: account.connectedAccountId },
    });
  }

  sendSuccess(res, { account: account.toJSON() });
}

export async function disconnectRestaurantPaymentAccount(req: Request, res: Response) {
  const account = await RestaurantPaymentAccount.findOne({
    restaurantId: req.params.restaurantId,
    status: { $in: ["active", "action_required", "pending_verification"] },
  }).sort({ createdAt: -1 });
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
    metadata: { provider: account.provider, connectionMode: account.connectionMode, fingerprint: account.credentialFingerprint },
  });

  sendSuccess(res, { account: account.toJSON() });
}
