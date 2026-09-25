import type { Request, Response } from "express";
import type { HydratedDocument, Types } from "mongoose";
import type { ConnectMarketplaceIntegrationInput } from "@restaurant/validation";
import type { MarketplaceProviderCapabilities, MarketplaceProviderName, UserRole } from "@restaurant/types";
import type { EncryptedBlob } from "../utils/credentialEncryption.js";
import { Restaurant } from "../models/Restaurant.js";
import { RestaurantMarketplaceIntegration, type RestaurantMarketplaceIntegrationDoc } from "../models/RestaurantMarketplaceIntegration.js";
import { ApiError } from "../utils/ApiError.js";
import { sendSuccess } from "../common/response.js";
import { KNOWN_MARKETPLACE_PROVIDER_NAMES, getMarketplaceProvider } from "../marketplaceProviders/index.js";
import { buildAuthorizeUrl } from "../marketplaceProviders/uberEatsConnect.js";
import { notificationQueue } from "../queues/notification.queue.js";
import { recordAuditEvent } from "../services/audit.service.js";
import { issueOAuthConnectState } from "../services/oauthConnectState.service.js";
import { env } from "../config/env.js";

/** GET /restaurants/:restaurantId/marketplace-integrations — every provider this restaurant has
 *  ever connected to (not just active ones, mirroring getRestaurantDeliveryProviderAccount's own
 *  "most recent per scope" convention, widened here to per-provider since a restaurant can run all
 *  three simultaneously, unlike the single-active-account payment/delivery model). Never a fake
 *  "connected" row for a provider that was never actually connected — a provider with no row here
 *  is simply absent from the array, and the admin UI renders that as "Not connected."
 *
 *  Phase 78 — also returns `capabilities` per provider (a static, no-network-call read off the
 *  resolved adapter instance) so the UI knows which connect mechanism to offer BEFORE the owner
 *  clicks anything: oauth_redirect gets a real "Connect" button, not_available/platform_admin_managed
 *  get an honest disabled state. Resolved per the CURRENT provider instance (mock vs. live), so mock
 *  mode's manual_store_id capability is what the UI actually sees in dev/test, never the live-mode
 *  value. */
export async function listRestaurantMarketplaceIntegrations(req: Request, res: Response) {
  const integrations = await RestaurantMarketplaceIntegration.find({
    restaurantId: req.params.restaurantId,
    status: { $ne: "disconnected" },
  }).sort({ createdAt: -1 });

  const capabilities = {} as Record<MarketplaceProviderName, MarketplaceProviderCapabilities>;
  for (const provider of KNOWN_MARKETPLACE_PROVIDER_NAMES) {
    capabilities[provider] = getMarketplaceProvider(provider).capabilities;
  }

  sendSuccess(res, { integrations: integrations.map((i) => i.toJSON()), capabilities });
}

interface ActivateIntegrationInput {
  restaurantId: Types.ObjectId;
  businessId: Types.ObjectId;
  provider: MarketplaceProviderName;
  externalStoreId: string;
  actorUserId: string;
  actorRole: UserRole;
  encryptedCredentials?: EncryptedBlob;
  credentialFingerprint?: string;
}

/** Shared "make this the restaurant's one active integration for this provider" step — used by the
 *  manual connect flow below, the Uber Eats OAuth finalize flow, and the Platform Admin foodpanda
 *  linking action. Disconnects any existing active integration for this restaurant+provider BEFORE
 *  saving the new one as active (mirrors connectUberDirectAccount's own ordering fix — that file's
 *  comment notes the sibling payment-account flow does this the other way around and calls out the
 *  resulting race; not repeated here), then records the audit event. Callers are responsible for
 *  verifying the connection is real (healthCheck/OAuth token exchange/admin confirmation) BEFORE
 *  calling this — it never itself decides whether a connection is legitimate. */
export async function activateIntegration(input: ActivateIntegrationInput): Promise<HydratedDocument<RestaurantMarketplaceIntegrationDoc>> {
  const integration = new RestaurantMarketplaceIntegration({
    restaurantId: input.restaurantId,
    businessId: input.businessId,
    provider: input.provider,
    status: "active",
    externalStoreId: input.externalStoreId,
    connectedByUserId: input.actorUserId,
    lastVerifiedAt: new Date(),
    ...(input.encryptedCredentials ? { encryptedCredentials: input.encryptedCredentials } : {}),
    ...(input.credentialFingerprint ? { credentialFingerprint: input.credentialFingerprint } : {}),
  });

  await RestaurantMarketplaceIntegration.updateMany(
    { restaurantId: input.restaurantId, provider: input.provider, status: "active", _id: { $ne: integration._id } },
    { $set: { status: "disconnected" } }
  );
  await integration.save();

  await recordAuditEvent({
    restaurantId: input.restaurantId,
    actorUserId: input.actorUserId,
    actorRole: input.actorRole,
    action: "marketplace_integration.connected",
    targetType: "marketplace_integration",
    targetId: integration._id,
    metadata: { provider: integration.provider, externalStoreId: integration.externalStoreId },
  });

  return integration;
}

/**
 * Connects (or reconnects) a restaurant's store to a marketplace provider via the manual
 * externalStoreId form — the sanctioned MARKETPLACE_PROVIDER_MODE=mock dev/test path (see
 * MockMarketplaceProvider's `connect: {mechanism: "manual_store_id"}`) and, in live mode, whatever a
 * provider's own capability declares that mechanism for (none do, today — Uber Eats uses OAuth,
 * DoorDash/foodpanda use their own honest not_available/platform_admin_managed states). Rejects
 * (400) up front if the resolved provider's capability doesn't actually declare manual_store_id, so
 * this can never be used to fake a connection to a provider whose real mechanism is something else.
 * Verifies the platform itself can currently reach the provider (adapter.healthCheck()) before
 * activating — a provider with no configured platform credentials fails this cleanly rather than
 * ever showing a fake "connected" state, mirroring connectUberDirectAccount's honest
 * verify-then-activate flow.
 */
export async function connectMarketplaceIntegration(req: Request, res: Response) {
  const input = req.body as ConnectMarketplaceIntegrationInput;
  const restaurant = await Restaurant.findById(req.params.restaurantId);
  if (!restaurant) throw ApiError.notFound("Restaurant not found");
  if (!restaurant.businessId) throw ApiError.badRequest("This restaurant has no business association yet");

  const provider = getMarketplaceProvider(input.provider);
  if (provider.capabilities.connect.mechanism !== "manual_store_id") {
    throw ApiError.badRequest(`"${input.provider}" is not connected by manually entering a store ID on this deployment.`);
  }

  let verified = false;
  let verificationError = "This provider is not currently configured on this deployment.";
  try {
    verified = await provider.healthCheck();
    if (!verified) verificationError = "Could not verify these platform credentials against this provider.";
  } catch (err) {
    verificationError = (err as Error).message;
  }

  if (!verified) {
    const integration = new RestaurantMarketplaceIntegration({
      restaurantId: restaurant._id,
      businessId: restaurant.businessId,
      provider: input.provider,
      status: "invalid",
      externalStoreId: input.externalStoreId,
      connectedByUserId: req.user!.id,
      lastVerificationError: verificationError,
    });
    await integration.save();
    sendSuccess(res, { integration: integration.toJSON() }, 201);
    return;
  }

  const integration = await activateIntegration({
    restaurantId: restaurant._id,
    businessId: restaurant.businessId,
    provider: input.provider,
    externalStoreId: input.externalStoreId,
    actorUserId: req.user!.id,
    actorRole: req.user!.role,
  });

  sendSuccess(res, { integration: integration.toJSON() }, 201);
}

function requireKnownProvider(provider: string): MarketplaceProviderName {
  if (!KNOWN_MARKETPLACE_PROVIDER_NAMES.includes(provider as MarketplaceProviderName)) {
    throw ApiError.badRequest(`"${provider}" is not a recognized marketplace provider`);
  }
  return provider as MarketplaceProviderName;
}

/**
 * POST /restaurants/:restaurantId/marketplace-integrations/:provider/connect/start — mints a fresh
 * OAuth state and returns the real authorize URL to redirect the owner's browser to. Only ever valid
 * for a provider whose resolved capability actually declares `oauth_redirect` (Uber Eats today) —
 * rejects (400) any other provider server-side, not just hidden in the UI, so this endpoint can never
 * be used to fake a connection flow for a provider that doesn't really have one.
 *
 * `redirectUri` is a single STATIC admin URL (never tenant-scoped — apps/admin has no tenant-scoped
 * routing, and neither Uber's authorize endpoint nor a browser landing back from it carries any
 * Authorization header, so the callback can't be tenant-scoped in its own URL either). Tenant context
 * instead rides inside the minted state document, consumed server-side on callback — see
 * marketplaceOAuth.controller.ts's completeUberEatsConnect.
 */
export async function startProviderOAuthConnect(req: Request, res: Response) {
  const provider = requireKnownProvider(req.params.provider);
  const restaurant = await Restaurant.findById(req.params.restaurantId);
  if (!restaurant) throw ApiError.notFound("Restaurant not found");
  if (!restaurant.businessId) throw ApiError.badRequest("This restaurant has no business association yet");

  const capability = getMarketplaceProvider(provider).capabilities.connect;
  if (capability.mechanism !== "oauth_redirect") {
    throw ApiError.badRequest(`"${provider}" is not connected via a redirect flow on this deployment.`);
  }
  if (provider !== "uber_eats") {
    // Only Uber Eats has a real OAuth flow implemented today (see uberEatsConnect.ts) — this branch
    // exists so a future provider whose capability legitimately declares oauth_redirect doesn't
    // silently fall through to Uber's own flow.
    throw ApiError.badRequest(`No OAuth connect flow is implemented for "${provider}" yet.`);
  }

  const redirectUri = env.UBER_EATS_REDIRECT_URI ?? `${env.ADMIN_ORIGIN}/marketplace/oauth-callback`;
  const { raw } = await issueOAuthConnectState({
    provider: "uber_eats",
    restaurantId: restaurant._id,
    businessId: restaurant.businessId,
    userId: req.user!.id,
    redirectUri,
  });

  sendSuccess(res, { url: buildAuthorizeUrl(raw, redirectUri) });
}

export async function disconnectMarketplaceIntegration(req: Request, res: Response) {
  const provider = requireKnownProvider(req.params.provider);
  const integration = await RestaurantMarketplaceIntegration.findOne({
    restaurantId: req.params.restaurantId,
    provider,
    status: { $in: ["active", "pending_verification", "invalid"] },
  }).sort({ createdAt: -1 });
  if (!integration) throw ApiError.notFound(`This restaurant has no connected ${provider} integration`);

  integration.status = "disconnected";
  await integration.save();

  await recordAuditEvent({
    restaurantId: integration.restaurantId!,
    actorUserId: req.user!.id,
    actorRole: req.user!.role,
    action: "marketplace_integration.disconnected",
    targetType: "marketplace_integration",
    targetId: integration._id,
    metadata: { provider: integration.provider, externalStoreId: integration.externalStoreId },
  });

  sendSuccess(res, { integration: integration.toJSON() });
}

/** POST /restaurants/:restaurantId/marketplace-integrations/:provider/sync — enqueues a menu sync
 *  rather than running it inline (a full-menu push is a genuine network round trip per provider's
 *  own docs, sometimes an async job on their side too — see FoodpandaProvider's POST /export note),
 *  matching this codebase's "don't block a request on a slow external call" convention. */
export async function triggerMarketplaceMenuSync(req: Request, res: Response) {
  const provider = requireKnownProvider(req.params.provider);
  const integration = await RestaurantMarketplaceIntegration.findOne({ restaurantId: req.params.restaurantId, provider, status: "active" });
  if (!integration) throw ApiError.notFound(`This restaurant has no active ${provider} integration`);

  await notificationQueue.add("marketplace.menu_sync", { integrationId: integration._id.toString() });

  await recordAuditEvent({
    restaurantId: integration.restaurantId!,
    actorUserId: req.user!.id,
    actorRole: req.user!.role,
    action: "marketplace_integration.menu_sync_triggered",
    targetType: "marketplace_integration",
    targetId: integration._id,
    metadata: { provider: integration.provider },
  });

  sendSuccess(res, { queued: true });
}
