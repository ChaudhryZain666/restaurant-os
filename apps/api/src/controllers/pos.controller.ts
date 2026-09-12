import type { Request, Response } from "express";
import type { CreatePosOrderInput } from "@restaurant/validation";
import { Order } from "../models/Order.js";
import { Restaurant } from "../models/Restaurant.js";
import { ApiError } from "../utils/ApiError.js";
import { sendSuccess } from "../common/response.js";
import { createOrderForCustomer } from "../services/orderCreation.service.js";
import { resolvePosCustomerId } from "../services/posCustomer.service.js";
import { withCustomerInfo } from "./order.controller.js";

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
    // Phase 75 — the authenticated staff member, re-derived from the verified session exactly like
    // every other actor-identity field in this codebase (e.g. recordAuditEvent's actorUserId) —
    // never accepted from req.body, which has no field for this at all.
    createdByUserId: req.user!.id,
  });

  sendSuccess(res, { order }, 201);
}

/**
 * GET /restaurants/:restaurantId/pos/pending-sales — Phase 75. Every POS-originated order at this
 * location that is still unpaid and not cancelled: an interrupted/abandoned sale (browser closed,
 * payment declined and never retried, staff walked away) or a deliberately tabbed dine-in order
 * (Phase 73's markPaidImmediately:false) — both are "still needs resolving," which is exactly what
 * this surface is for. Scoped by the SAME requireTenantMatch()+restaurant.pos.operate gate every
 * other route in this router already uses (posRouter.use, routes/pos.routes.ts) — a staff member
 * assigned only to location B can never reach location A's pending sales, same as every other POS
 * action. Reuses withCustomerInfo (order.controller.ts) for customerName/createdByName rather than
 * a second User-lookup implementation.
 */
export async function listPendingSales(req: Request, res: Response) {
  const { restaurantId } = req.params;
  const orders = await Order.find({
    restaurantId,
    channel: "pos",
    paymentStatus: "unpaid",
    status: { $ne: "cancelled" },
  }).sort({ createdAt: -1 });
  sendSuccess(res, { orders: await withCustomerInfo(orders) });
}
