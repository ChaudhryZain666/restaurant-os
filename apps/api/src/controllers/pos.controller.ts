import type { Request, Response } from "express";
import type { CreatePosOrderInput } from "@restaurant/validation";
import { Restaurant } from "../models/Restaurant.js";
import { ApiError } from "../utils/ApiError.js";
import { sendSuccess } from "../common/response.js";
import { createOrderForCustomer } from "../services/orderCreation.service.js";
import { resolvePosCustomerId } from "../services/posCustomer.service.js";

/**
 * POST /restaurants/:restaurantId/pos/orders — the staff terminal's order-creation endpoint.
 * Distinct route from the customer-facing POST /restaurants/:restaurantId/orders (different
 * trust model entirely: an authenticated, tenant-matched, restaurant.pos.operate staff member
 * instead of an anonymous customer's own session) but both ultimately call the exact same
 * createOrderForCustomer — one canonical order lifecycle, not two. See docs/pos-architecture.md.
 */
export async function createPosOrder(req: Request, res: Response) {
  const { restaurantId } = req.params;
  const input = req.body as CreatePosOrderInput;

  const restaurant = await Restaurant.findOne({ _id: restaurantId, status: "active" });
  if (!restaurant) throw ApiError.notFound("Restaurant not found");
  // Same opt-in-off-by-default pattern as dineInEnabled — restaurant.pos.operate alone isn't
  // enough; the location must also have explicitly turned the POS terminal on.
  if (!restaurant.settings.posEnabled) throw ApiError.badRequest("POS is not enabled for this location");

  const customerId = await resolvePosCustomerId(input.customer);

  const order = await createOrderForCustomer({
    restaurantId,
    customerId,
    channel: "pos",
    items: input.items,
    orderType: input.orderType,
    paymentMethod: input.paymentMethod,
    deliveryAddress: input.deliveryAddress,
    tableId: input.tableId,
    customerNotes: input.customerNotes,
    redeemPoints: input.redeemPoints,
    promoCode: input.promoCode,
    isDemoAccount: false,
    markPaidImmediately: input.markPaidImmediately,
  });

  sendSuccess(res, { order }, 201);
}
