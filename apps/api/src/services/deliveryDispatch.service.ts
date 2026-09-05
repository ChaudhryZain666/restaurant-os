import type { HydratedDocument } from "mongoose";
import type { DeliveryStatus } from "@restaurant/types";
import { Delivery, type DeliveryDoc } from "../models/Delivery.js";
import { Order, type OrderDoc } from "../models/Order.js";
import { Restaurant, type RestaurantDoc } from "../models/Restaurant.js";
import { User } from "../models/User.js";
import { ApiError } from "../utils/ApiError.js";
import { logger } from "../common/logger.js";
import { applyOrderStatusTransition, type OrderStatusTransitionActor } from "./orderTransition.service.js";
import { emitOrderEvent, statusToEventType } from "../events/orderEvents.js";
import { recordAuditEvent } from "./audit.service.js";
import { resolveDeliveryProviderForRestaurant } from "../deliveryProviders/restaurantDeliveryProvider.js";
import { buildDeliveryProviderFromAccount } from "../deliveryProviders/restaurantDeliveryProvider.js";
import { getManualDeliveryProvider } from "../deliveryProviders/index.js";
import { RestaurantDeliveryProviderAccount } from "../models/RestaurantDeliveryProviderAccount.js";
import {
  DeliveryProviderError,
  type DeliveryContact,
  type DeliveryProvider,
  type ManifestItem,
} from "../deliveryProviders/DeliveryProvider.js";

/**
 * Forward-only transition table for a Delivery's own normalized lifecycle — mirrors
 * orderStateMachine.ts's TRANSITIONS shape/reasoning exactly, applied to the richer courier-dispatch
 * lifecycle instead of the order lifecycle. Defends against a provider's at-least-once webhook
 * redelivery arriving out of order (e.g. "picked_up" replayed after "out_for_delivery" already
 * recorded) — DeliveryWebhookEvent's own unique eventId index already blocks a literal duplicate,
 * this blocks a stale-but-distinct event from ever moving the status backward. "failed" has no
 * forward entries here — retrying a failed delivery goes through retryDeliveryCreation, which
 * resets status back to "pending" explicitly, never through this table.
 */
const DELIVERY_TRANSITIONS: Record<DeliveryStatus, readonly DeliveryStatus[]> = {
  pending: ["quoted", "requested", "accepted", "cancelled", "failed"],
  quoted: ["requested", "cancelled", "failed"],
  requested: ["accepted", "cancelled", "failed"],
  // Not every provider surfaces every intermediate milestone (some never report a separate
  // "driver_assigned" event, some go straight from accepted to en-route for a fast/simple courier)
  // — accepted can skip straight to picked_up or even out_for_delivery, same reasoning as
  // driver_assigned skipping straight to out_for_delivery just below.
  accepted: ["driver_assigned", "picked_up", "out_for_delivery", "cancelled", "failed"],
  driver_assigned: ["picked_up", "out_for_delivery", "cancelled", "failed"],
  picked_up: ["out_for_delivery", "delivered", "failed"],
  out_for_delivery: ["delivered", "failed"],
  delivered: [],
  cancelled: [],
  failed: [],
};

/** Delivery-status values a cancel action is still meaningful for — once a courier has physically
 *  picked the order up, "cancelling" the dispatch record no longer reflects reality. */
const CANCELLABLE_DELIVERY_STATUSES: readonly DeliveryStatus[] = [
  "pending",
  "quoted",
  "requested",
  "accepted",
  "driver_assigned",
];

function isValidDeliveryTransition(from: DeliveryStatus, to: DeliveryStatus): boolean {
  return DELIVERY_TRANSITIONS[from].includes(to);
}

/** Stable per order — the same key every time regardless of how many times creation is
 *  attempted/retried, so the Delivery.idempotencyKey unique index is a real dedupe guard rather
 *  than a random value that would defeat its own purpose. */
function deliveryCreationIdempotencyKey(orderId: string): string {
  return `delivery_create_${orderId}`;
}

/**
 * Resolves the SAME provider a given (already-created) Delivery was dispatched through — used by
 * cancelDelivery and any future status-sync poll. Deliberately independent of
 * resolveDeliveryProviderForRestaurant/Restaurant.settings.deliveryProvider: a restaurant may
 * reconfigure or disconnect its provider after a delivery is already in flight, and an in-flight
 * delivery must keep talking to the provider it actually started with, never silently swap providers
 * mid-run.
 */
async function resolveProviderForDelivery(delivery: HydratedDocument<DeliveryDoc>): Promise<DeliveryProvider | null> {
  if (delivery.provider === "manual") return getManualDeliveryProvider();
  const account = await RestaurantDeliveryProviderAccount.findOne({
    restaurantId: delivery.restaurantId,
    provider: delivery.provider,
    status: "active",
  });
  if (!account) return null;
  try {
    return buildDeliveryProviderFromAccount(account);
  } catch {
    return null;
  }
}

/**
 * Idempotent — a duplicate call for the same order (a retried queue job, a double-click on a
 * "dispatch now" button) always returns the SAME Delivery document rather than creating a second
 * one. Never throws for an ordinary provider-side failure (timeout, rejected address, provider
 * outage): those land the Delivery in "failed" with a human-readable failureReason so the restaurant
 * sees a clear internal state and can retry (see retryDeliveryCreation), per this phase's explicit
 * "a failed delivery request should have a clear internal state" requirement. Only throws for a
 * genuine caller error (order not found, wrong order type, no delivery address) — those are bugs in
 * the caller, not something a retry could ever fix.
 */
export async function createDeliveryForOrder(orderId: string, restaurantId: string): Promise<HydratedDocument<DeliveryDoc>> {
  const existing = await Delivery.findOne({ orderId });
  if (existing) return existing;

  const [order, restaurant] = await Promise.all([
    Order.findOne({ _id: orderId, restaurantId }),
    Restaurant.findOne({ _id: restaurantId }),
  ]);
  if (!order) throw ApiError.notFound("Order not found");
  if (!restaurant) throw ApiError.notFound("Restaurant not found");
  if (order.orderType !== "delivery") throw ApiError.badRequest("Only delivery orders can be dispatched to a courier");
  if (!order.deliveryAddress) throw ApiError.badRequest("This order has no delivery address on file");
  if (restaurant.latitude == null || restaurant.longitude == null) {
    throw ApiError.badRequest("This restaurant has no pickup coordinates configured — a courier cannot be requested");
  }

  // Insert-first-then-process: the unique idempotencyKey/orderId indexes on Delivery are the real
  // dedupe guard against two concurrent calls racing this function for the same order (mirrors
  // DeliveryWebhookEvent's own insert-first idempotency pattern).
  let delivery: HydratedDocument<DeliveryDoc>;
  try {
    delivery = await Delivery.create({
      restaurantId,
      businessId: restaurant.businessId,
      orderId,
      orderNumber: order.orderNumber,
      provider: "manual",
      status: "pending",
      idempotencyKey: deliveryCreationIdempotencyKey(orderId),
    });
  } catch (err) {
    if ((err as { code?: number }).code === 11000) {
      const raced = await Delivery.findOne({ orderId });
      if (raced) return raced;
    }
    throw err;
  }

  return dispatchPendingDelivery(delivery, order, restaurant);
}

/** Re-attempts creation for a Delivery stuck in "pending" or "failed" with no providerDeliveryId
 *  yet — the restaurant-facing "retry" action for a failed dispatch. Refuses to touch a delivery
 *  that's already past this point (already has a providerDeliveryId, or has moved beyond pending —
 *  retrying would mean double-dispatching a real courier). */
export async function retryDeliveryCreation(deliveryId: string, restaurantId: string): Promise<HydratedDocument<DeliveryDoc>> {
  const delivery = await Delivery.findOne({ _id: deliveryId, restaurantId });
  if (!delivery) throw ApiError.notFound("Delivery not found");
  if (delivery.providerDeliveryId || (delivery.status !== "pending" && delivery.status !== "failed")) {
    throw ApiError.conflict("This delivery has already been dispatched — it cannot be retried from here");
  }

  const [order, restaurant] = await Promise.all([
    Order.findOne({ _id: delivery.orderId, restaurantId }),
    Restaurant.findOne({ _id: restaurantId }),
  ]);
  if (!order || !restaurant) throw ApiError.notFound("Order or restaurant not found");

  delivery.status = "pending";
  delivery.failureReason = undefined;
  return dispatchPendingDelivery(delivery, order, restaurant);
}

async function dispatchPendingDelivery(
  delivery: HydratedDocument<DeliveryDoc>,
  order: HydratedDocument<OrderDoc>,
  restaurant: HydratedDocument<RestaurantDoc>
): Promise<HydratedDocument<DeliveryDoc>> {
  // accountId (which RestaurantDeliveryProviderAccount was used) is deliberately not persisted on
  // Delivery itself — resolveProviderForDelivery looks the active account up fresh by
  // restaurantId+provider whenever one is needed later (e.g. cancelDelivery).
  const { provider, fellBackToManual } = await resolveDeliveryProviderForRestaurant(restaurant);
  delivery.provider = provider.name;
  if (fellBackToManual) {
    delivery.statusHistory.push({ status: "pending", at: new Date(), note: "Fell back to manual dispatch — configured provider unavailable" });
  }

  const customer = await User.findById(order.customerId).select("name phone");
  const restaurantCurrency = restaurant.settings.currency ?? order.currency;

  const pickup: DeliveryContact = {
    name: restaurant.name,
    phone: restaurant.phone ?? "",
    address: [restaurant.address, restaurant.city, restaurant.state, restaurant.postalCode, restaurant.country].filter(Boolean).join(", "),
    latitude: restaurant.latitude as number,
    longitude: restaurant.longitude as number,
  };
  const dropoff: DeliveryContact = {
    name: customer?.name ?? "Customer",
    phone: customer?.phone ?? "",
    address: [order.deliveryAddress!.line1, order.deliveryAddress!.line2, order.deliveryAddress!.city, order.deliveryAddress!.state, order.deliveryAddress!.postalCode]
      .filter(Boolean)
      .join(", "),
    latitude: order.deliveryAddress!.latitude,
    longitude: order.deliveryAddress!.longitude,
    notes: order.deliveryAddress!.instructions ?? undefined,
  };
  const manifestItems: ManifestItem[] = order.items.map((item) => ({ name: item.name, quantity: item.quantity }));

  try {
    const result = await provider.createDelivery({
      orderId: order.id as string,
      restaurantId: restaurant.id as string,
      pickup,
      dropoff,
      manifestItems,
      idempotencyKey: delivery.idempotencyKey,
    });
    delivery.status = result.status;
    delivery.providerDeliveryId = result.providerDeliveryId;
    delivery.trackingUrl = result.trackingUrl;
    if (result.fee != null) delivery.fee = result.fee;
    delivery.currency = result.currency ?? restaurantCurrency;
    delivery.statusHistory.push({ status: result.status, at: new Date() });
    delivery.lastProviderError = undefined;
    await delivery.save();
    logger.info("delivery dispatched", { deliveryId: delivery.id, orderId: order.id, provider: provider.name, status: result.status });
  } catch (err) {
    const message = err instanceof DeliveryProviderError ? err.message : `Unexpected error dispatching delivery: ${(err as Error).message}`;
    delivery.status = "failed";
    delivery.failureReason = message;
    delivery.lastProviderError = message;
    delivery.statusHistory.push({ status: "failed", at: new Date(), note: message });
    await delivery.save();
    logger.warn("delivery dispatch failed", { deliveryId: delivery.id, orderId: order.id, provider: provider.name, error: message });
  }

  return delivery;
}

export interface UpdateDeliveryStatusOptions {
  nextStatus: DeliveryStatus;
  providerEventId?: string;
  courierName?: string;
  courierPhone?: string;
  trackingUrl?: string;
  cancelReason?: string;
  note?: string;
  /** Present only for a staff-driven manual-dispatch action — absent for a provider webhook, since
   *  there's no real user to attribute (see applyOrderStatusTransition's own doc comment). */
  actor?: OrderStatusTransitionActor;
}

/**
 * The single place a Delivery's status is ever advanced — called by both the delivery webhook
 * handler (provider-driven) and the manual-dispatch staff actions (deliveryDispatch.controller.ts).
 * Idempotent/order-safe by construction: a same-status repeat or a backward/out-of-order move is
 * logged and ignored rather than applied or thrown, so a webhook redelivery or a stale status poll
 * can never corrupt the record or crash the caller. Successful forward moves that represent a real
 * milestone (picked up, delivered) drive the linked Order's own status forward through the exact
 * same applyOrderStatusTransition used everywhere else — never a second, parallel way to change an
 * order's status.
 */
export async function updateDeliveryStatus(
  deliveryId: string,
  restaurantId: string,
  opts: UpdateDeliveryStatusOptions
): Promise<HydratedDocument<DeliveryDoc>> {
  const delivery = await Delivery.findOne({ _id: deliveryId, restaurantId });
  if (!delivery) throw ApiError.notFound("Delivery not found");

  const { nextStatus, providerEventId, courierName, courierPhone, trackingUrl, cancelReason, note, actor } = opts;
  const previousStatus = delivery.status;

  if (nextStatus !== delivery.status) {
    if (!isValidDeliveryTransition(delivery.status as DeliveryStatus, nextStatus)) {
      logger.warn("ignored out-of-order or invalid delivery status transition", {
        deliveryId, restaurantId, from: delivery.status, to: nextStatus, providerEventId,
      });
      return delivery;
    }
    delivery.status = nextStatus;
    delivery.statusHistory.push({ status: nextStatus, at: new Date(), providerEventId, note });
  }

  if (courierName !== undefined) delivery.courierName = courierName;
  if (courierPhone !== undefined) delivery.courierPhone = courierPhone;
  if (trackingUrl !== undefined) delivery.trackingUrl = trackingUrl;
  if (cancelReason !== undefined) delivery.cancelReason = cancelReason;
  await delivery.save();

  // Only a staff-driven action gets an audit entry — see applyOrderStatusTransition's own doc
  // comment on why a webhook-driven change (no `actor`) never does; the Delivery's own
  // statusHistory (with providerEventId set) is that case's audit trail instead.
  if (actor && previousStatus !== nextStatus) {
    await recordAuditEvent({
      restaurantId,
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: nextStatus === "cancelled" ? "delivery.cancelled" : "delivery.status_updated",
      targetType: "delivery",
      targetId: delivery.id,
      metadata: { from: previousStatus, to: nextStatus },
    });
  }

  await advanceOrderForDeliveryStatus(delivery.orderId.toString(), restaurantId, nextStatus, actor);

  return delivery;
}

/**
 * Mirrors the linked Order's status forward to match a delivery milestone — "ready" ->
 * "out_for_delivery" once a courier has the order, "out_for_delivery" -> "completed" once delivered.
 * Best-effort: an order that's already moved on (or was separately cancelled by staff mid-flight)
 * is left alone rather than throwing, since the Delivery record itself — not this mirror — is the
 * real source of truth for what the courier is doing. Reuses emitOrderEvent so the existing
 * Socket.IO live-tracking push and BullMQ notification job fire exactly as they do for a
 * staff-driven status change (see events/orderEventListeners.ts) — no parallel notification path.
 */
async function advanceOrderForDeliveryStatus(
  orderId: string,
  restaurantId: string,
  deliveryStatus: DeliveryStatus,
  actor?: OrderStatusTransitionActor
): Promise<void> {
  if (deliveryStatus !== "picked_up" && deliveryStatus !== "out_for_delivery" && deliveryStatus !== "delivered") return;

  try {
    const order = await Order.findOne({ _id: orderId, restaurantId });
    if (!order) return;

    let currentStatus = order.status;
    if ((deliveryStatus === "picked_up" || deliveryStatus === "out_for_delivery" || deliveryStatus === "delivered") && currentStatus === "ready") {
      const { order: updated } = await applyOrderStatusTransition({ orderId, restaurantId, nextStatus: "out_for_delivery", actor });
      emitOrderEvent(statusToEventType("out_for_delivery"), {
        orderId: updated.id, orderNumber: updated.orderNumber, restaurantId, customerId: updated.customerId.toString(), status: "out_for_delivery",
      });
      currentStatus = "out_for_delivery";
    }

    if (deliveryStatus === "delivered" && currentStatus === "out_for_delivery") {
      const { order: updated } = await applyOrderStatusTransition({ orderId, restaurantId, nextStatus: "completed", actor });
      emitOrderEvent(statusToEventType("completed"), {
        orderId: updated.id, orderNumber: updated.orderNumber, restaurantId, customerId: updated.customerId.toString(), status: "completed",
      });
    }
  } catch (err) {
    logger.warn("delivery-driven order status transition skipped", {
      orderId, restaurantId, deliveryStatus, error: (err as Error).message,
    });
  }
}

/**
 * Staff- or restaurant-initiated cancellation of an in-flight delivery — distinct from the order
 * itself being cancelled (see order.controller.ts's updateOrderStatus). Refuses once a courier has
 * already physically picked the order up (CANCELLABLE_DELIVERY_STATUSES), since "cancelling" the
 * dispatch record at that point wouldn't reflect reality. Calls the SAME provider this delivery was
 * actually created through (resolveProviderForDelivery), never whatever the restaurant currently has
 * configured — those can differ if the restaurant reconfigured providers mid-flight.
 */
export async function cancelDelivery(deliveryId: string, restaurantId: string, reason: string | undefined, actor: OrderStatusTransitionActor): Promise<HydratedDocument<DeliveryDoc>> {
  const delivery = await Delivery.findOne({ _id: deliveryId, restaurantId });
  if (!delivery) throw ApiError.notFound("Delivery not found");
  if (!CANCELLABLE_DELIVERY_STATUSES.includes(delivery.status as DeliveryStatus)) {
    throw ApiError.conflict(`A delivery already "${delivery.status}" can no longer be cancelled from here`);
  }

  if (delivery.providerDeliveryId) {
    const provider = await resolveProviderForDelivery(delivery);
    if (!provider) {
      throw ApiError.serviceUnavailable("This delivery's provider account is no longer connected — it cannot be cancelled through the provider API. Contact the courier directly.");
    }
    try {
      await provider.cancelDelivery(delivery.providerDeliveryId, reason);
    } catch (err) {
      const message = err instanceof DeliveryProviderError ? err.message : `Unexpected error cancelling delivery: ${(err as Error).message}`;
      throw ApiError.serviceUnavailable(message);
    }
  }

  return updateDeliveryStatus(deliveryId, restaurantId, { nextStatus: "cancelled", cancelReason: reason, actor });
}
