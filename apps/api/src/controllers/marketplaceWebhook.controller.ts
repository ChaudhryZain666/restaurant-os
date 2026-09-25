import type { Request, Response } from "express";
import type { MarketplaceProviderName } from "@restaurant/types";
import { ApiError } from "../utils/ApiError.js";
import { KNOWN_MARKETPLACE_PROVIDER_NAMES, getMarketplaceProvider } from "../marketplaceProviders/index.js";
import { resolveMarketplaceIntegrationByExternalStore } from "../marketplaceProviders/restaurantMarketplaceProvider.js";
import { MarketplaceWebhookEvent } from "../models/MarketplaceWebhookEvent.js";
import { notificationQueue } from "../queues/notification.queue.js";
import { logger } from "../common/logger.js";

/**
 * POST /webhooks/marketplace/:provider — the ONE centralized endpoint for every restaurant
 * connected to a given provider, mirroring paymentWebhook.controller.ts's
 * handleStripeConnectWebhook exactly (never a per-restaurant URL): none of Uber Eats/DoorDash/
 * foodpanda sign with a per-restaurant secret (see RestaurantMarketplaceIntegration.ts's header
 * comment) — signature verification uses only the platform-level credentials
 * getMarketplaceProvider(provider) resolves from env, and the specific restaurant is resolved
 * AFTER verification, from the payload's own store id, via
 * resolveMarketplaceIntegrationByExternalStore. No requireAuth: a webhook is authenticated by its
 * signature, not a session.
 *
 * Timing is critical here (Uber Eats specifically: 11.5 minutes from webhook delivery to
 * accept/deny or the order auto-cancels) — this handler does the minimum possible work
 * (verify -> idempotency-claim -> resolve integration -> enqueue) and returns 200 immediately,
 * exactly like delivery.dispatch_create's own "don't block the response on the real work" pattern.
 * The actual order fetch/mapping/creation/accept happens in marketplaceOrderIngestion.service.ts,
 * off the request/response cycle entirely.
 */
export async function handleMarketplaceWebhook(req: Request, res: Response) {
  const providerName = req.params.provider;
  if (!KNOWN_MARKETPLACE_PROVIDER_NAMES.includes(providerName as MarketplaceProviderName)) {
    throw ApiError.badRequest(`"${providerName}" is not a recognized marketplace provider`);
  }
  const provider = providerName as MarketplaceProviderName;

  let adapter;
  try {
    adapter = getMarketplaceProvider(provider);
  } catch (err) {
    logger.error("marketplace webhook received for an unconfigured provider", { provider, error: (err as Error).message });
    throw ApiError.badRequest(`This deployment is not configured to receive ${provider} webhooks`);
  }

  const rawBody = (req as Request & { rawBody?: Buffer }).rawBody ?? Buffer.from(JSON.stringify(req.body ?? {}));
  const signatureHeader = req.header(adapter.signatureHeaderName);
  const event = adapter.verifyWebhookSignature(rawBody, signatureHeader);
  if (!event) {
    logger.warn("marketplace webhook signature verification failed", { provider });
    throw ApiError.badRequest("Invalid webhook signature");
  }

  const claimed = await claimMarketplaceWebhookEventForProcessing(provider, event.eventId, event.eventType, event.raw);
  if (!claimed) {
    // Already processed, or a concurrent delivery is in flight — the routine, expected outcome of
    // a provider's at-least-once redelivery. Acknowledged without reprocessing.
    res.status(200).json({ received: true });
    return;
  }

  const integration = await resolveMarketplaceIntegrationByExternalStore(provider, event.externalStoreId);
  if (!integration) {
    logger.warn("marketplace webhook for an unknown or disconnected store", { provider, externalStoreId: event.externalStoreId, eventId: event.eventId });
    await MarketplaceWebhookEvent.updateOne({ provider, eventId: event.eventId }, { $set: { processedAt: new Date() } });
    res.status(200).json({ received: true });
    return;
  }

  if (!event.externalOrderId) {
    // Store-status/menu-processing events (store.provisioned, store.status.changed, etc.) — not
    // acted on this phase (two-way status sync is explicitly out of scope, see
    // docs/marketplace-integration-architecture.md), acknowledged and marked processed so a
    // redelivery of the same event doesn't re-log it.
    await MarketplaceWebhookEvent.updateOne({ provider, eventId: event.eventId }, { $set: { processedAt: new Date() } });
    res.status(200).json({ received: true });
    return;
  }

  try {
    await notificationQueue.add(
      "marketplace.order_ingest",
      { provider, integrationId: integration._id.toString(), externalOrderId: event.externalOrderId, eventId: event.eventId },
      // Elevated priority (lower number = higher in BullMQ) — the only job family in this queue
      // with a hard external deadline (see this file's header comment).
      { priority: 1 }
    );
    // processedAt is deliberately NOT set here — it's set by ingestMarketplaceOrder itself once
    // the async job actually concludes (success, or the intentional "denied unmappable order"
    // path). Marking it now, at mere enqueue time, would make the stuck-event alert sweep
    // (queues/notification.queue.ts's checkForStuckMarketplaceWebhookEvents) blind to a job that
    // gets enqueued but never actually processed (a crashed worker, a stalled job) — exactly the
    // failure mode that sweep exists to catch. processingStartedAt (set by the claim above) stays
    // the correct "still in flight" signal until then.
  } catch (err) {
    await MarketplaceWebhookEvent.updateOne(
      { provider, eventId: event.eventId },
      { $set: { processingError: (err as Error).message }, $unset: { processingStartedAt: "" } }
    );
    logger.error("failed to enqueue marketplace order ingestion", { provider, eventId: event.eventId, error: (err as Error).message });
  }

  res.status(200).json({ received: true });
}

/** Reuses subscription.service.ts's claimWebhookEventForProcessing atomic-claim pattern verbatim
 *  (see MarketplaceWebhookEvent.ts's header comment for why this — not the weaker delivery-webhook
 *  bare-insert pattern) — duplicated rather than imported/generalized, since the two collections
 *  (BillingWebhookEvent/MarketplaceWebhookEvent) are deliberately separate idempotency domains and
 *  a shared generic risks silently coupling them later. */
async function claimMarketplaceWebhookEventForProcessing(provider: string, eventId: string, eventType: string, payload: unknown): Promise<boolean> {
  try {
    await MarketplaceWebhookEvent.create({ provider, eventId, eventType, payload, processingStartedAt: new Date() });
    return true;
  } catch (err) {
    if ((err as { code?: number }).code !== 11000) throw err;
  }

  const claimed = await MarketplaceWebhookEvent.findOneAndUpdate(
    { provider, eventId, processedAt: { $exists: false }, processingStartedAt: { $exists: false } },
    { $set: { processingStartedAt: new Date() } },
    { new: true }
  );
  if (claimed) {
    logger.info("retrying a previously-stuck marketplace webhook event whose earlier attempt never finished", { provider, eventId });
    return true;
  }

  logger.info("duplicate marketplace webhook event ignored", { provider, eventId });
  return false;
}
