import type { Request, Response } from "express";
import type { HydratedDocument } from "mongoose";
import type {
  CreateOrderInput,
  ListMyOrdersQueryInput,
  UpdateOrderNoteInput,
  UpdateOrderPaymentStatusInput,
  UpdateOrderStatusInput,
} from "@restaurant/validation";
import { paginateQuery } from "../utils/pagination.js";
import { roleHasPermission } from "@restaurant/types";
import { Restaurant } from "../models/Restaurant.js";
import { Order, type OrderDoc } from "../models/Order.js";
import { User } from "../models/User.js";
import { ApiError } from "../utils/ApiError.js";
import { sendSuccess } from "../common/response.js";
import { reverseLoyaltyForOrderIfNeeded } from "../services/loyalty.service.js";
import { priceOrderItems, type PricedOrderItem } from "../services/orderPricing.service.js";
import { computeAvailability } from "../services/restaurantAvailability.service.js";
import { applyOrderStatusTransition } from "../services/orderTransition.service.js";
import { emitOrderEvent, statusToEventType } from "../events/orderEvents.js";
import { recordAuditEvent } from "../services/audit.service.js";
import { resolveTenantAccess } from "../middleware/tenant.js";
import { createOrderForCustomer } from "../services/orderCreation.service.js";

/** Never sent to a customer — staff-only field. Applied right before every customer-facing
 *  response (listMyOrders, getOrder-as-owner, cancelMyOrder) rather than relying on callers to
 *  remember, since the consequence of forgetting is a real data leak. */
function stripInternalFields<T extends Record<string, unknown>>(order: T): Omit<T, "internalNote"> {
  const { internalNote: _internalNote, ...rest } = order;
  return rest;
}

/**
 * Attaches { customerName, customerPhone } to each order's JSON for staff-facing views. A
 * separate batched User lookup rather than Mongoose .populate() — populate would replace
 * customerId with a nested document and change what order.toJSON() produces, which every
 * existing order test/consumer already depends on being a plain ObjectId string.
 */
async function withCustomerInfo(orders: HydratedDocument<OrderDoc>[]) {
  const customerIds = [...new Set(orders.map((o) => o.customerId.toString()))];
  const customers = await User.find({ _id: { $in: customerIds } }, "name phone");
  const byId = new Map(customers.map((c) => [c.id, c]));
  return orders.map((order) => {
    const customer = byId.get(order.customerId.toString());
    return { ...order.toJSON(), customerName: customer?.name, customerPhone: customer?.phone };
  });
}

export async function createOrder(req: Request, res: Response) {
  const { restaurantId } = req.params;
  const {
    items,
    orderType,
    paymentMethod,
    deliveryAddress,
    tableToken,
    customerNotes,
    redeemPoints: pointsToRedeem,
    promoCode,
  } = req.body as CreateOrderInput;

  const order = await createOrderForCustomer({
    restaurantId,
    customerId: req.user!.id,
    channel: "online",
    items,
    orderType,
    paymentMethod,
    deliveryAddress,
    tableToken,
    customerNotes,
    redeemPoints: pointsToRedeem,
    promoCode,
    // Phase 32 — re-derived from the authenticated session, never trusted from the request body
    // (which has no isDemo field at all — see createOrderSchema).
    isDemoAccount: req.user!.isDemoAccount === true,
  });

  sendSuccess(res, { order }, 201);
}

export async function listMyOrders(req: Request, res: Response) {
  const { page, limit } = req.query as unknown as ListMyOrdersQueryInput;
  const result = await paginateQuery(
    Order.find({ customerId: req.user!.id }).sort({ createdAt: -1 }),
    { page, limit }
  );
  sendSuccess(res, { ...result, items: result.items.map((o) => stripInternalFields(o.toJSON())) });
}

const ACTIVE_STATUSES = ["pending", "confirmed", "preparing", "ready", "out_for_delivery"] as const;
const DEFAULT_LIST_LIMIT = 200;

/**
 * ?active=true bounds the query to kitchen/dashboard-relevant statuses — used by the Kitchen
 * Display System and, optionally, the restaurant dashboard's "active" view, so that screen never
 * pulls a restaurant's entire order history. Omitting it preserves the original unbounded
 * behavior the existing dashboard's History section already depends on, capped defensively at
 * DEFAULT_LIST_LIMIT rather than truly unbounded (Phase 6 performance review — see docs).
 */
export async function listRestaurantOrders(req: Request, res: Response) {
  const { restaurantId } = req.params;
  const { active, orderType, tableId } = req.query as {
    active?: string;
    orderType?: string;
    tableId?: string;
  };

  // Phase 32 — excludes public storefront-playground demo orders by default so KDS/Orders
  // Management (both call this same function) never show a real restaurant's staff fake traffic
  // from an anonymous visitor's demo checkout.
  const filter: Record<string, unknown> = { restaurantId, isDemo: { $ne: true } };
  if (active === "true") filter.status = { $in: ACTIVE_STATUSES };
  if (orderType) filter.orderType = orderType;
  if (tableId) filter.tableId = tableId;

  const orders = await Order.find(filter)
    .sort({ createdAt: -1 })
    .limit(DEFAULT_LIST_LIMIT);
  sendSuccess(res, { orders: await withCustomerInfo(orders) });
}

export async function getOrder(req: Request, res: Response) {
  const order = await Order.findById(req.params.id);
  if (!order) throw ApiError.notFound("Order not found");

  const isOwner = order.customerId.toString() === req.user!.id;
  // Phase 29 audit finding P1-8 — this used to compare only the JWT's flat, original restaurantId,
  // never resolveTenantAccess's businessId/agency-aware resolution every other multi-location route
  // already uses (middleware/tenant.ts). An owner/manager viewing/printing an order at their
  // SECOND location (not the one restaurantId was originally issued for) got a false 403 here even
  // though they genuinely have access — over-restrictive, not a security hole, but broken for any
  // multi-location business.
  const isStaffForThisRestaurant =
    req.user!.role === "platform_admin" ||
    (roleHasPermission(req.user!.role, "restaurant.orders.read") &&
      (await resolveTenantAccess(req.user!, order.restaurantId.toString())).allowed);
  if (!isOwner && !isStaffForThisRestaurant) throw ApiError.forbidden();

  // Not sensitive to either audience — attached the same way customerName/customerPhone already
  // are, so a printable receipt/kitchen ticket (Phase 14) has the restaurant's own name/contact
  // without a second round trip from either frontend.
  const [[withInfo], restaurant] = await Promise.all([
    withCustomerInfo([order]),
    Restaurant.findById(order.restaurantId).select("name phone address city state postalCode logo"),
  ]);
  const withRestaurantInfo = {
    ...withInfo,
    restaurantName: restaurant?.name,
    restaurantPhone: restaurant?.phone,
    restaurantAddress: restaurant
      ? [restaurant.address, restaurant.city, restaurant.state, restaurant.postalCode].filter(Boolean).join(", ")
      : undefined,
    // Phase 29 audit finding P1-7 — the model always had this, the receipt/kitchen-ticket print
    // views (Phase 14) just never received it in this projection to render one.
    restaurantLogo: restaurant?.logo,
  };
  sendSuccess(res, { order: isOwner ? stripInternalFields(withRestaurantInfo) : withRestaurantInfo });
}

export async function updateOrderStatus(req: Request, res: Response) {
  const { restaurantId, id } = req.params;
  const { status: nextStatus } = req.body as UpdateOrderStatusInput;

  // Awaited BEFORE the response is sent: a caller that immediately reads the audit log after
  // getting a 200 back must already see this entry — recordAuditEvent still swallows its own
  // errors (see audit.service.ts), so this can't turn a real status change into a failed request.
  // Refunds are never auto-fired on cancellation (Phase 17 product decision — see
  // orderTransition.service.ts's applyOrderStatusTransition for the full rationale); that stays an
  // explicit, separate staff action (payment.service.ts's refundPayment / the admin "Issue refund"
  // button), flagged by OrderPaymentAdmin.tsx's needsRefundAttention when still unresolved.
  const { order } = await applyOrderStatusTransition({
    orderId: id,
    restaurantId,
    nextStatus,
    actor: { userId: req.user!.id, role: req.user!.role },
  });

  sendSuccess(res, { order: order.toJSON() });

  emitOrderEvent(statusToEventType(nextStatus), {
    orderId: order.id,
    orderNumber: order.orderNumber,
    restaurantId,
    customerId: order.customerId.toString(),
    status: nextStatus,
  });
}

/**
 * Cash-only from here on: an "online" order's paymentStatus is exclusively driven by
 * services/payment.service.ts's webhook-confirmed processProviderEvent, never by a manual staff
 * toggle — that's precisely the "a client/staff can mark an order as paid" gap the Payment domain
 * exists to close. This endpoint still IS the entire cash lifecycle (staff marks it collected),
 * unchanged from before this phase.
 */
export async function updateOrderPaymentStatus(req: Request, res: Response) {
  const { restaurantId, id } = req.params;
  const { paymentStatus } = req.body as UpdateOrderPaymentStatusInput;

  const existing = await Order.findOne({ _id: id, restaurantId });
  if (!existing) throw ApiError.notFound("Order not found");
  if (existing.paymentMethod === "online") {
    throw ApiError.badRequest(
      "This order's payment method is online — its payment status is set by the payment provider, not manually"
    );
  }

  const order = await Order.findOneAndUpdate(
    { _id: id, restaurantId },
    { $set: { paymentStatus } },
    { new: true, runValidators: true }
  );
  if (!order) throw ApiError.notFound("Order not found");
  sendSuccess(res, { order: order.toJSON() });

  emitOrderEvent("order.payment_updated", {
    orderId: order.id,
    orderNumber: order.orderNumber,
    restaurantId,
    customerId: order.customerId.toString(),
    status: order.status,
  });
}

/**
 * Customer self-service cancellation — deliberately narrower than the full state machine
 * (which also allows staff to cancel from confirmed/preparing/ready): once a restaurant has
 * accepted an order, only the restaurant can back out of it via updateOrderStatus. This is a
 * product decision, not a technical constraint.
 */
export async function cancelMyOrder(req: Request, res: Response) {
  const order = await Order.findById(req.params.id);
  if (!order) throw ApiError.notFound("Order not found");
  if (order.customerId.toString() !== req.user!.id) throw ApiError.forbidden();
  if (order.status !== "pending") {
    throw ApiError.badRequest(`Order can no longer be cancelled — its status is already "${order.status}"`);
  }

  order.status = "cancelled";
  order.statusHistory.push({ status: "cancelled", at: new Date() });
  await order.save();
  await reverseLoyaltyForOrderIfNeeded(order);
  sendSuccess(res, { order: stripInternalFields(order.toJSON()) });

  emitOrderEvent("order.cancelled", {
    orderId: order.id,
    orderNumber: order.orderNumber,
    restaurantId: order.restaurantId.toString(),
    customerId: order.customerId.toString(),
    status: "cancelled",
  });
}

/**
 * Staff-only internal note — never part of order creation, never visible to the customer (see
 * stripInternalFields). A separate endpoint rather than folding into updateOrderStatus so a note
 * can be added/edited without requiring an actual status transition.
 */
export async function updateOrderNote(req: Request, res: Response) {
  const { restaurantId, id } = req.params;
  const { internalNote } = req.body as UpdateOrderNoteInput;

  const order = await Order.findOneAndUpdate(
    { _id: id, restaurantId },
    { $set: { internalNote } },
    { new: true, runValidators: true }
  );
  if (!order) throw ApiError.notFound("Order not found");

  await recordAuditEvent({
    restaurantId,
    actorUserId: req.user!.id,
    actorRole: req.user!.role,
    action: "order.note_updated",
    targetType: "order",
    targetId: order.id,
  });

  sendSuccess(res, { order: order.toJSON() });
}

/**
 * Returns a re-priced, re-validated preview of a past order's contents against CURRENT menu
 * data — never the historical snapshot. The frontend uses this to populate a fresh cart; it
 * does not create an order. Items that no longer exist, are inactive, or have modifier
 * selections that are no longer valid are reported in `unavailableItems` instead of thrown away
 * silently, so the customer can see exactly what changed.
 */
export async function reorderOrder(req: Request, res: Response) {
  const original = await Order.findById(req.params.id);
  if (!original) throw ApiError.notFound("Order not found");
  if (original.customerId.toString() !== req.user!.id) throw ApiError.forbidden();

  const restaurantId = original.restaurantId.toString();
  const restaurant = await Restaurant.findOne({ _id: restaurantId, status: "active" });
  if (!restaurant) {
    sendSuccess(res, {
      restaurantId,
      restaurantSlug: null,
      restaurantAvailable: false,
      items: [],
      unavailableItems: original.items.map((i) => ({ name: i.name, reason: "This restaurant is no longer available" })),
      subtotal: 0,
    });
    return;
  }

  const availability = computeAvailability(restaurant.settings);

  const items: PricedOrderItem[] = [];
  const unavailableItems: Array<{ name: string; reason: string }> = [];

  for (const historicalItem of original.items) {
    try {
      const { items: priced } = await priceOrderItems(restaurantId, [
        {
          menuItemId: historicalItem.menuItemId.toString(),
          quantity: historicalItem.quantity,
          selectedModifiers: historicalItem.selectedModifiers.map((m) => ({
            groupId: m.groupId.toString(),
            optionId: m.optionId.toString(),
          })),
        },
      ]);
      items.push(priced[0]);
    } catch (err) {
      unavailableItems.push({
        name: historicalItem.name,
        reason: err instanceof ApiError ? err.message : "No longer available",
      });
    }
  }

  const subtotal = items.reduce((sum, i) => sum + i.lineTotal, 0);

  sendSuccess(res, {
    restaurantId,
    // The customer-facing reorder button (OrderDetailPage) needs this to route the customer to
    // the CORRECT restaurant's /r/:slug/cart — a historical order's restaurant is not necessarily
    // the one currently being browsed under Phase 8's multi-tenant routing.
    restaurantSlug: restaurant.slug,
    restaurantAvailable: availability.status === "open",
    items,
    unavailableItems,
    subtotal,
  });
}
