import type { MarketplaceProviderName } from "@restaurant/types";
import { RestaurantMarketplaceIntegration } from "../models/RestaurantMarketplaceIntegration.js";
import { MarketplaceMenuMapping } from "../models/MarketplaceMenuMapping.js";
import { MarketplaceWebhookEvent } from "../models/MarketplaceWebhookEvent.js";
import { ModifierGroup } from "../models/ModifierGroup.js";
import { logger } from "../common/logger.js";
import { buildMarketplaceProviderFromIntegration } from "../marketplaceProviders/restaurantMarketplaceProvider.js";
import type { MarketplaceOrder } from "../marketplaceProviders/MarketplaceProvider.js";
import { resolveMarketplaceCustomerId } from "./marketplaceCustomer.service.js";
import { createOrderForCustomer } from "./orderCreation.service.js";

interface IngestParams {
  provider: MarketplaceProviderName;
  integrationId: string;
  externalOrderId: string;
  eventId: string;
}

interface ResolvedItem {
  menuItemId: string;
  quantity: number;
  selectedModifiers: { groupId: string; optionId: string }[];
}

/** Resolves one order line item's external ids to internal ones via MarketplaceMenuMapping. Returns
 *  null (never throws) the moment anything can't be mapped — the caller denies the whole order
 *  rather than guessing at a substitute item, per this phase's explicit "avoid destructive
 *  automatic overwrites... never guess" mapping-layer requirement. */
async function resolveLineItem(integrationId: string, item: MarketplaceOrder["items"][number]): Promise<ResolvedItem | null> {
  const itemMapping = await MarketplaceMenuMapping.findOne({ integrationId, internalType: "menu_item", externalId: item.externalItemId });
  if (!itemMapping) return null;

  const selectedModifiers: { groupId: string; optionId: string }[] = [];
  for (const modifier of item.modifiers) {
    const optionMapping = await MarketplaceMenuMapping.findOne({
      integrationId,
      internalType: "modifier_option",
      externalId: modifier.externalOptionId,
    });
    if (!optionMapping) return null;
    // The option's own internalId is a subdocument _id inside ModifierGroup.options[] — its parent
    // group id isn't stored on the mapping row itself (it's derivable, and groups are re-parented
    // rarely enough that storing a second, potentially-stale copy isn't worth it).
    const group = await ModifierGroup.findOne({ "options._id": optionMapping.internalId }).select("_id");
    if (!group) return null;
    selectedModifiers.push({ groupId: group.id as string, optionId: optionMapping.internalId.toString() });
  }

  return { menuItemId: itemMapping.internalId.toString(), quantity: item.quantity, selectedModifiers };
}

async function markEventProcessed(provider: string, eventId: string): Promise<void> {
  await MarketplaceWebhookEvent.updateOne({ provider, eventId }, { $set: { processedAt: new Date() } });
}

/**
 * The single entry point marketplace.order_ingest (queues/notification.queue.ts) calls, run
 * strictly AFTER the webhook handler has already returned 200 — see
 * marketplaceWebhook.controller.ts's header comment on why acknowledgment and processing are
 * decoupled (Uber Eats' 11.5-minute accept/deny SLA in particular).
 *
 * Marks the originating MarketplaceWebhookEvent's `processedAt` on every path that concludes
 * normally (success, or the intentional "denied unmappable order" path) — this, not mere enqueue,
 * is the signal the stuck-event alert sweep depends on (see notification.queue.ts's
 * checkForStuckMarketplaceWebhookEvents). An unexpected throw instead records `processingError` and
 * clears `processingStartedAt` (mirroring subscription.service.ts's own claim-retry precedent) so a
 * later webhook redelivery's claim-retry logic can pick it back up, then re-throws so BullMQ's own
 * job-level retry also applies.
 *
 * orderType is always mapped to "pickup", regardless of what the marketplace itself calls it
 * (pickup or delivery): from GarnishTable's/the kitchen's point of view, a marketplace order is
 * always "prepare this, someone will collect it" — the marketplace's own courier network (or the
 * diner themselves) handles the actual hand-off, never this platform's own delivery-eligibility/fee
 * engine (checkDeliveryEligibility), which would incorrectly reject a marketplace delivery order
 * that falls outside THIS restaurant's configured delivery radius even though the marketplace's own
 * courier — not this platform — is doing the driving.
 */
export async function ingestMarketplaceOrder({ provider, integrationId, externalOrderId, eventId }: IngestParams): Promise<void> {
  try {
    await ingestMarketplaceOrderInner({ provider, integrationId, externalOrderId, eventId });
  } catch (err) {
    await MarketplaceWebhookEvent.updateOne(
      { provider, eventId },
      { $set: { processingError: (err as Error).message }, $unset: { processingStartedAt: "" } }
    );
    throw err;
  }
}

async function ingestMarketplaceOrderInner({ provider, integrationId, externalOrderId, eventId }: IngestParams): Promise<void> {
  const integration = await RestaurantMarketplaceIntegration.findOne({ _id: integrationId, provider, status: "active" });
  if (!integration) {
    logger.warn("marketplace order ingestion skipped — integration is not active", { provider, integrationId, externalOrderId });
    await markEventProcessed(provider, eventId);
    return;
  }

  const adapter = buildMarketplaceProviderFromIntegration(integration);
  const externalStoreId = integration.externalStoreId as string | undefined;
  if (!externalStoreId) {
    logger.error("marketplace integration has no externalStoreId — cannot ingest", { provider, integrationId });
    await markEventProcessed(provider, eventId);
    return;
  }

  const order = await adapter.fetchOrder(externalStoreId, externalOrderId);

  const resolvedItems: ResolvedItem[] = [];
  for (const item of order.items) {
    const resolved = await resolveLineItem(integrationId, item);
    if (!resolved) {
      logger.error("marketplace order has an item this platform cannot map — denying", {
        provider,
        integrationId,
        externalOrderId,
        externalItemId: item.externalItemId,
      });
      if (adapter.capabilities.orderDeny) {
        await adapter.denyOrder(externalStoreId, externalOrderId, "One or more items in this order could not be fulfilled").catch((err: unknown) => {
          logger.error("failed to deny unmappable marketplace order", { provider, externalOrderId, error: (err as Error).message });
        });
      }
      await markEventProcessed(provider, eventId);
      return;
    }
    resolvedItems.push(resolved);
  }

  const customerId = await resolveMarketplaceCustomerId(provider, order.customerName, order.customerPhone);

  try {
    await createOrderForCustomer({
      restaurantId: integration.restaurantId!.toString(),
      customerId,
      channel: "marketplace",
      items: resolvedItems,
      orderType: "pickup",
      paymentMethod: "marketplace",
      customerNotes: order.customerNotes,
      markPaidImmediately: true,
      marketplace: {
        provider,
        integrationId,
        externalOrderId: order.externalOrderId,
        externalStoreId: order.externalStoreId,
        externalStatus: order.externalStatus,
        externalCreatedAt: order.externalCreatedAt,
      },
    });
  } catch (err) {
    // A duplicate-key error here means Order's {marketplace.provider, marketplace.externalOrderId}
    // unique index caught a retry of an already-ingested order (a redelivered webhook whose
    // MarketplaceWebhookEvent claim raced a prior successful run, or a manually-retried job) — this
    // is the expected, safe outcome of that backstop, not a failure to surface.
    if ((err as { code?: number }).code === 11000) {
      logger.info("marketplace order already ingested — duplicate ignored", { provider, externalOrderId });
      await markEventProcessed(provider, eventId);
      return;
    }
    throw err;
  }

  if (adapter.capabilities.orderAccept) {
    await adapter.acceptOrder(externalStoreId, externalOrderId).catch((err: unknown) => {
      // The Order already exists at this point — a failed accept-call is a provider-communication
      // problem, not a reason to have never created the order. Logged loudly for a human to notice
      // and manually confirm on the provider's own dashboard if needed.
      logger.error("marketplace order was created but acceptOrder failed", { provider, externalOrderId, error: (err as Error).message });
    });
  }

  await markEventProcessed(provider, eventId);
}
