import type { Request, Response } from "express";
import { ApiError } from "../utils/ApiError.js";
import { KNOWN_DELIVERY_PROVIDER_NAMES, type KnownDeliveryProviderName, type ProviderDeliveryWebhookEvent } from "../deliveryProviders/index.js";
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

  // Phase 89 — claim-then-process. DeliveryWebhookEvent's unique (provider, eventId) index still
  // stops two copies running at once, but only a PROCESSED event counts as a duplicate: one whose
  // processing failed (or whose worker died mid-way) is claimed again on the provider's retry,
  // instead of being acknowledged and lost as before.
  if (!(await claimDeliveryWebhookEvent(providerName, event))) {
    logger.info("duplicate delivery webhook event ignored", { provider: providerName, eventId: event.eventId });
    res.status(200).json({ received: true });
    return;
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
    await DeliveryWebhookEvent.updateOne({ provider: providerName, eventId: event.eventId }, { $set: { processedAt: new Date() }, $unset: { processingStartedAt: "" } });
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
    await DeliveryWebhookEvent.updateOne(
      { provider: providerName, eventId: event.eventId },
      { $set: { processedAt: new Date() }, $unset: { processingStartedAt: "", processingError: "" } }
    );
  } catch (err) {
    await DeliveryWebhookEvent.updateOne(
      { provider: providerName, eventId: event.eventId },
      { $set: { processingError: (err as Error).message }, $unset: { processingStartedAt: "" } }
    );
    logger.error("delivery webhook processing failed", { provider: providerName, eventId: event.eventId, error: (err as Error).message });
    // Phase 89 — a non-2xx makes the provider redeliver; the claim above lets that retry run.
    throw ApiError.serviceUnavailable("Delivery webhook processing failed; please retry");
  }

  res.status(200).json({ received: true });
}

/** A claim older than this is treated as abandoned (the process died mid-way) and may be retaken. */
const CLAIM_STALE_MS = 5 * 60 * 1000;

/**
 * Phase 89 — true when this request may process the event: it's new, or an earlier attempt failed
 * or was abandoned. False when it's already processed, or another request is processing it right
 * now. Mirrors subscription.service.ts's claimWebhookEventForProcessing.
 */
async function claimDeliveryWebhookEvent(providerName: string, event: ProviderDeliveryWebhookEvent): Promise<boolean> {
  try {
    await DeliveryWebhookEvent.create({
      provider: providerName,
      eventId: event.eventId,
      eventType: event.eventType,
      payload: event.raw,
      processingStartedAt: new Date(),
    });
    return true;
  } catch (err) {
    if ((err as { code?: number }).code !== 11000) throw err;
  }
  const claimed = await DeliveryWebhookEvent.findOneAndUpdate(
    {
      provider: providerName,
      eventId: event.eventId,
      processedAt: { $exists: false },
      $or: [{ processingStartedAt: { $exists: false } }, { processingStartedAt: { $lt: new Date(Date.now() - CLAIM_STALE_MS) } }],
    },
    { $set: { processingStartedAt: new Date() } }
  );
  return Boolean(claimed);
}
