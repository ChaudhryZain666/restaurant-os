import type { Request, Response } from "express";
import { ApiError } from "../utils/ApiError.js";
import { KNOWN_DELIVERY_PROVIDER_NAMES, type KnownDeliveryProviderName } from "../deliveryProviders/index.js";
import { buildDeliveryProviderFromAccount } from "../deliveryProviders/restaurantDeliveryProvider.js";
import { RestaurantDeliveryProviderAccount } from "../models/RestaurantDeliveryProviderAccount.js";
import { DeliveryWebhookEvent } from "../models/DeliveryWebhookEvent.js";
import { Delivery } from "../models/Delivery.js";
import { updateDeliveryStatus } from "../services/deliveryDispatch.service.js";
import { logger } from "../common/logger.js";

/**
 * POST /webhooks/deliveries/:provider/:accountId — the ONLY shape a delivery webhook takes in this
 * system, unlike payments' two-tier (platform-pooled + BYOC) design: every third-party courier
 * provider here is BYOC-only (see restaurantDeliveryProvider.ts's doc comment on why Uber Direct has
 * no platform-pooled mode), so there is no equivalent of handleProviderWebhook's single shared
 * per-provider-name endpoint — the account must always be named up front, exactly like
 * paymentWebhook.controller.ts's handleRestaurantAccountWebhook. No requireAuth: a webhook is
 * authenticated by its signature, not a session — nothing of substance happens before that check.
 */
export async function handleDeliveryProviderWebhook(req: Request, res: Response) {
  const providerName = req.params.provider;
  if (!KNOWN_DELIVERY_PROVIDER_NAMES.includes(providerName as KnownDeliveryProviderName) || providerName === "manual") {
    throw ApiError.badRequest(`"${providerName}" is not a BYOC-eligible delivery provider`);
  }

  const account = await RestaurantDeliveryProviderAccount.findOne({ _id: req.params.accountId, provider: providerName });
  if (!account) throw ApiError.badRequest("No matching restaurant delivery provider account for this provider/id");

  let provider;
  try {
    provider = buildDeliveryProviderFromAccount(account);
  } catch (err) {
    logger.error("could not build delivery provider from account for webhook", { accountId: account.id, error: (err as Error).message });
    throw ApiError.badRequest("This delivery provider account is not currently connectable");
  }

  const rawBody = (req as Request & { rawBody?: Buffer }).rawBody ?? Buffer.from(JSON.stringify(req.body ?? {}));
  const signatureHeader = provider.signatureHeaderName ? req.header(provider.signatureHeaderName) : undefined;

  const event = provider.verifyWebhookSignature(rawBody, signatureHeader);
  if (!event) throw ApiError.badRequest("Invalid webhook signature");

  // Insert-first-then-process — DeliveryWebhookEvent's unique (provider, eventId) index is the
  // whole idempotency mechanism: a provider's at-least-once webhook redelivery always collides here
  // and is acknowledged without being processed a second time.
  try {
    await DeliveryWebhookEvent.create({ provider: providerName, eventId: event.eventId, eventType: event.eventType, payload: event.raw });
  } catch (err) {
    if ((err as { code?: number }).code === 11000) {
      logger.info("duplicate delivery webhook event ignored", { provider: providerName, eventId: event.eventId });
      res.status(200).json({ received: true });
      return;
    }
    throw err;
  }

  const delivery = await Delivery.findOne({
    restaurantId: account.restaurantId,
    provider: providerName,
    providerDeliveryId: event.providerDeliveryId,
  });
  if (!delivery) {
    // A real possibility, not a bug: a webhook can arrive for a delivery this system never
    // successfully recorded the providerDeliveryId for (e.g. the creation response was lost after
    // the provider already dispatched it). Acknowledged (never retried forever by the provider) and
    // logged for manual investigation, rather than thrown — a webhook handler must never turn an
    // unrecognized-but-real event into a 500.
    logger.warn("delivery webhook for an unrecognized providerDeliveryId", {
      provider: providerName, providerDeliveryId: event.providerDeliveryId, eventId: event.eventId,
    });
    await DeliveryWebhookEvent.updateOne({ provider: providerName, eventId: event.eventId }, { $set: { processedAt: new Date() } });
    res.status(200).json({ received: true });
    return;
  }

  try {
    await updateDeliveryStatus(delivery.id as string, account.restaurantId!.toString(), {
      nextStatus: event.status,
      providerEventId: event.eventId,
      courierName: event.courierName,
      courierPhone: event.courierPhone,
      trackingUrl: event.trackingUrl,
      cancelReason: event.cancelReason,
    });
    await DeliveryWebhookEvent.updateOne({ provider: providerName, eventId: event.eventId }, { $set: { processedAt: new Date() } });
  } catch (err) {
    await DeliveryWebhookEvent.updateOne({ provider: providerName, eventId: event.eventId }, { $set: { processingError: (err as Error).message } });
    logger.error("delivery webhook processing failed", { provider: providerName, eventId: event.eventId, error: (err as Error).message });
  }

  res.status(200).json({ received: true });
}
