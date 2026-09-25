import type { Request, Response } from "express";
import type { CompleteMarketplaceOAuthConnectInput, SelectMarketplaceOAuthStoreInput } from "@restaurant/validation";
import { Restaurant } from "../models/Restaurant.js";
import { ApiError } from "../utils/ApiError.js";
import { sendSuccess } from "../common/response.js";
import { logger } from "../common/logger.js";
import { encryptCredentials } from "../utils/credentialEncryption.js";
import { consumeOAuthConnectState, finalizePendingStoreSelection, savePendingStoreSelection } from "../services/oauthConnectState.service.js";
import { discoverStores, exchangeCodeForToken } from "../marketplaceProviders/uberEatsConnect.js";
import { activateIntegration } from "./restaurantMarketplaceIntegration.controller.js";

function fingerprint(secret: string): string {
  const tail = secret.slice(-4);
  const head = secret.slice(0, Math.max(0, secret.length - 4 - 4));
  return `${head.slice(0, 8)}····${tail}`;
}

/**
 * POST /marketplace-oauth/uber_eats/callback — where the admin app's MarketplaceOAuthCallbackPage
 * posts after the browser lands back from Uber's own consent screen. Deliberately NOT tenant-scoped
 * in its URL (no `:restaurantId` to check yet, and apps/admin has no tenant-scoped routing anyway —
 * see marketplaceOAuth.routes.ts's own header comment): `requireAuth` only, everything about WHICH
 * restaurant this concerns is derived purely from the consumed state document, never trusted from
 * the request body or any URL param — the literal implementation of "tenant context is always
 * server-derived, never browser-supplied" for this flow.
 */
export async function completeUberEatsConnect(req: Request, res: Response) {
  const { code, state: rawState, error } = req.body as CompleteMarketplaceOAuthConnectInput;

  const consumed = await consumeOAuthConnectState(rawState, "uber_eats");
  if (!consumed) {
    sendSuccess(res, { status: "expired" });
    return;
  }
  // The real CSRF/account-linking-injection defense — see OAuthConnectState.ts's own header comment.
  // An attacker replaying their own valid state against a victim's session fails here even though
  // the state value itself "checked out" above.
  if (consumed.userId.toString() !== req.user!.id) {
    throw ApiError.forbidden("This connection was not started by your account.");
  }

  if (error || !code) {
    sendSuccess(res, { status: "denied" });
    return;
  }

  const restaurant = await Restaurant.findById(consumed.restaurantId);
  if (!restaurant || !restaurant.businessId) {
    sendSuccess(res, { status: "error", message: "We couldn't find the restaurant this connection belongs to. Please start over." });
    return;
  }

  let tokenResult;
  try {
    tokenResult = await exchangeCodeForToken(code, consumed.redirectUri);
  } catch (err) {
    logger.warn("Uber Eats token exchange failed", { restaurantId: restaurant.id, error: (err as Error).message });
    sendSuccess(res, { status: "error", message: "We couldn't complete the connection to Uber Eats. Please try again." });
    return;
  }

  let stores;
  try {
    stores = await discoverStores(tokenResult.accessToken);
  } catch (err) {
    logger.warn("Uber Eats store discovery failed", { restaurantId: restaurant.id, error: (err as Error).message });
    sendSuccess(res, { status: "error", message: "Uber Eats connected, but we couldn't look up your stores. Please try again." });
    return;
  }
  if (stores.length === 0) {
    sendSuccess(res, { status: "error", message: "No Uber Eats stores were found for this account." });
    return;
  }

  const encryptedCredentials = encryptCredentials({
    accessToken: tokenResult.accessToken,
    refreshToken: tokenResult.refreshToken,
    expiresAt: Date.now() + tokenResult.expiresIn * 1000,
  });
  const credentialFingerprint = fingerprint(tokenResult.accessToken);

  if (stores.length === 1) {
    const integration = await activateIntegration({
      restaurantId: restaurant._id,
      businessId: restaurant.businessId,
      provider: "uber_eats",
      externalStoreId: stores[0]!.externalStoreId,
      actorUserId: req.user!.id,
      actorRole: req.user!.role,
      encryptedCredentials,
      credentialFingerprint,
    });
    sendSuccess(res, { status: "connected", restaurantId: restaurant.id, integration: integration.toJSON() });
    return;
  }

  // More than one store on this Uber account — a genuinely possible case per Uber's own docs, not
  // guessed at. Stash the candidates against the (already-consumed) state and let the owner pick.
  await savePendingStoreSelection(consumed.id, stores, encryptedCredentials, credentialFingerprint);
  sendSuccess(res, { status: "select_store", stateId: consumed.id, restaurantId: restaurant.id, candidates: stores });
}

/** POST /marketplace-oauth/uber_eats/select-store — the multi-store-picker follow-up. Same
 *  "requireAuth only, tenant context server-derived" shape as completeUberEatsConnect: the
 *  restaurant/business this concerns comes back from the state document via
 *  finalizePendingStoreSelection, never from the request body. */
export async function selectUberEatsStore(req: Request, res: Response) {
  const { stateId, externalStoreId } = req.body as SelectMarketplaceOAuthStoreInput;

  const picked = await finalizePendingStoreSelection(stateId, externalStoreId, req.user!.id);
  if (!picked) throw ApiError.notFound("This connection attempt has expired or is no longer valid. Please start over.");

  const integration = await activateIntegration({
    restaurantId: picked.restaurantId,
    businessId: picked.businessId,
    provider: "uber_eats",
    externalStoreId: picked.externalStoreId,
    actorUserId: req.user!.id,
    actorRole: req.user!.role,
    encryptedCredentials: picked.encryptedCredentials,
    credentialFingerprint: picked.credentialFingerprint,
  });

  sendSuccess(res, { status: "connected", restaurantId: picked.restaurantId.toString(), integration: integration.toJSON() });
}
