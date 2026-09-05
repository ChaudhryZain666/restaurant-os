import type { Request, Response } from "express";
import type { CancelDeliveryInput, UpdateManualDeliveryInput } from "@restaurant/validation";
import { Delivery } from "../models/Delivery.js";
import { ApiError } from "../utils/ApiError.js";
import { sendSuccess } from "../common/response.js";
import { cancelDelivery, retryDeliveryCreation, updateDeliveryStatus } from "../services/deliveryDispatch.service.js";

/** GET /restaurants/:restaurantId/orders/:orderId/delivery — staff-facing delivery status/tracking
 *  view for one order (POS and the admin order detail page both use this). Returns null, not a
 *  404, for an order with no Delivery yet (pending dispatch, or not a delivery order at all) — the
 *  UI already has to handle "no delivery record" as a normal state, not an error. */
export async function getDeliveryForOrder(req: Request, res: Response) {
  const delivery = await Delivery.findOne({ orderId: req.params.orderId, restaurantId: req.params.restaurantId });
  sendSuccess(res, { delivery: delivery ? delivery.toJSON() : null });
}

/**
 * POST /restaurants/:restaurantId/orders/:orderId/delivery/manual-status — the staff-driven
 * counterpart to a third-party provider's webhook (updateDeliveryStatus itself doesn't know or
 * care which one called it). Restricted server-side to provider:"manual" deliveries — a
 * third-party-dispatched delivery's status is only ever supposed to move via that provider's own
 * webhook (see updateManualDeliverySchema's own doc comment); accepting a manual override for one
 * would let staff silently desync this system's record from what the real courier API says.
 */
export async function updateManualDeliveryStatus(req: Request, res: Response) {
  const { restaurantId, orderId } = req.params;
  const input = req.body as UpdateManualDeliveryInput;

  const delivery = await Delivery.findOne({ orderId, restaurantId });
  if (!delivery) throw ApiError.notFound("This order has no delivery to update");
  if (delivery.provider !== "manual") {
    throw ApiError.badRequest("This delivery is dispatched through a third-party provider — its status is driven by that provider's webhook, not a manual action");
  }

  const updated = await updateDeliveryStatus(delivery.id as string, restaurantId, {
    nextStatus: input.status,
    courierName: input.courierName,
    courierPhone: input.courierPhone,
    note: input.note,
    actor: { userId: req.user!.id, role: req.user!.role },
  });
  sendSuccess(res, { delivery: updated.toJSON() });
}

/** POST /restaurants/:restaurantId/orders/:orderId/delivery/cancel */
export async function cancelOrderDelivery(req: Request, res: Response) {
  const { restaurantId, orderId } = req.params;
  const { reason } = req.body as CancelDeliveryInput;

  const delivery = await Delivery.findOne({ orderId, restaurantId });
  if (!delivery) throw ApiError.notFound("This order has no delivery to cancel");

  const updated = await cancelDelivery(delivery.id as string, restaurantId, reason, { userId: req.user!.id, role: req.user!.role });
  sendSuccess(res, { delivery: updated.toJSON() });
}

/** POST /restaurants/:restaurantId/orders/:orderId/delivery/retry — re-attempts courier creation
 *  for a delivery stuck in "pending"/"failed" (see retryDeliveryCreation's own doc comment for the
 *  exact guard against retrying an already-dispatched delivery). */
export async function retryOrderDeliveryCreation(req: Request, res: Response) {
  const { restaurantId, orderId } = req.params;
  const delivery = await Delivery.findOne({ orderId, restaurantId });
  if (!delivery) throw ApiError.notFound("This order has no delivery to retry");

  const updated = await retryDeliveryCreation(delivery.id as string, restaurantId);
  sendSuccess(res, { delivery: updated.toJSON() });
}
