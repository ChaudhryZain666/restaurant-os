import type { Request, Response } from "express";
import mongoose, { type HydratedDocument } from "mongoose";
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
import { Table, type TableDoc } from "../models/Table.js";
import { User } from "../models/User.js";
import { ApiError } from "../utils/ApiError.js";
import { sendSuccess } from "../common/response.js";
import { earnPoints, redeemPoints, reverseLoyaltyForOrderIfNeeded } from "../services/loyalty.service.js";
import { priceOrderItems, type PricedOrderItem } from "../services/orderPricing.service.js";
import { recordPromoUsage, validatePromoCode } from "../services/promotion.service.js";
import { nextOrderNumber } from "../services/orderNumber.service.js";
import { isValidStatusTransition } from "../services/orderStateMachine.js";
import { computeAvailability } from "../services/restaurantAvailability.service.js";
import { emitOrderEvent, statusToEventType } from "../events/orderEvents.js";
import { recordAuditEvent } from "../services/audit.service.js";
import { checkDeliveryEligibility } from "../services/delivery.service.js";
import { resolveTenantAccess } from "../middleware/tenant.js";

/** Never sent to a customer — staff-only field. Applied right before every customer-facing
 *  response (listMyOrders, getOrder-as-owner, cancelMyOrder) rather than relying on callers to
 *  remember, since the consequence of forgetting is a real data leak. */
function stripInternalFields<T extends Record<string, unknown>>(order: T): Omit<T, "internalNote"> {
  const { internalNote: _internalNote, ...rest } = order;
  return rest;
}

function roundCurrency(amount: number): number {
  return Math.round(amount * 100) / 100;
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
  const customerId = req.user!.id;

  const restaurant = await Restaurant.findOne({ _id: restaurantId, status: "active" });
  if (!restaurant) throw ApiError.notFound("Restaurant not found");

  const { settings } = restaurant;
  const availability = computeAvailability(settings);
  if (availability.status === "closed") {
    throw ApiError.badRequest("This restaurant is not accepting orders right now");
  }
  if (availability.status === "paused") {
    throw ApiError.badRequest(availability.reason || "This restaurant has temporarily paused ordering");
  }
  if (orderType === "pickup" && !settings.pickupEnabled) throw ApiError.badRequest("Pickup is not available");
  if (orderType === "dine_in" && !settings.dineInEnabled) throw ApiError.badRequest("Dine-in ordering is not available");
  // Delivery's own deliveryEnabled check happens inside checkDeliveryEligibility below (with a
  // more specific reason) rather than being duplicated here.

  // The selected payment method is independently re-checked against the restaurant's own
  // settings, never trusted from the client just because the checkout UI happened to offer it.
  if (paymentMethod === "cash" && !settings.cashEnabled) throw ApiError.badRequest("Cash payment is not available");
  if (paymentMethod === "online" && !settings.onlinePaymentEnabled) throw ApiError.badRequest("Online payment is not available");

  // The client only ever supplies the opaque token it resolved when the QR was scanned — never a
  // tableId. Re-resolved and re-validated from scratch here (active, belongs to THIS restaurant)
  // exactly like promo codes below; nothing about the earlier client-side resolution is trusted.
  let table: HydratedDocument<TableDoc> | null = null;
  if (orderType === "dine_in") {
    table = await Table.findOne({ restaurantId, qrToken: tableToken, isActive: true });
    if (!table) throw ApiError.badRequest("This table is no longer valid — please scan the QR code again");
  }

  // Delivery eligibility/fee/distance are entirely re-derived here from the restaurant's own
  // stored coordinates and settings — checkDeliveryEligibility never trusts the client for any of
  // deliveryEnabled, the restaurant's location, the delivery radius, the distance, or the fee. The
  // client's ONLY contribution is which lat/lng it's asking about (already required by
  // createOrderSchema for orderType "delivery"). See docs/delivery-architecture.md.
  let deliveryDistanceKm: number | undefined;
  let resolvedDeliveryFee = 0;
  if (orderType === "delivery") {
    // deliveryAddress.latitude/longitude are required by createOrderSchema's refine — deliveryAddress
    // itself is guaranteed present here.
    const eligibility = checkDeliveryEligibility(restaurant, deliveryAddress!.latitude, deliveryAddress!.longitude);
    if (!eligibility.eligible) {
      throw ApiError.badRequest(eligibility.reason ?? "Delivery is not available to this address");
    }
    deliveryDistanceKm = eligibility.distanceKm;
    resolvedDeliveryFee = eligibility.deliveryFee ?? settings.deliveryFee;
  }

  // Prices, names, and modifier selections are entirely re-derived from the database here —
  // nothing about what this order costs comes from the request body except which menu items
  // and modifier options the customer picked.
  const { items: pricedItems, subtotal } = await priceOrderItems(restaurantId, items);

  if (subtotal < settings.minOrderAmount) {
    throw ApiError.badRequest(`Minimum order amount is ${settings.minOrderAmount}`);
  }

  // A promo code is re-validated here from scratch — the same check the cart's "preview" call
  // already ran, but nothing from that earlier call (including its discount amount) is trusted.
  // businessId is passed through so a business-wide promotion (Phase 23) can resolve too, scoped
  // to exactly this restaurant being in that promotion's own locationIds — never "any location of
  // the same business."
  const appliedPromo = promoCode
    ? await validatePromoCode(restaurantId, promoCode, subtotal, restaurant.businessId?.toString())
    : null;
  const promoDiscount = appliedPromo?.discount ?? 0;

  // 1 point = 1 currency unit discount, applied before tax
  const loyaltyDiscount = Math.min(pointsToRedeem, subtotal);
  const taxableAmount = Math.max(0, subtotal - loyaltyDiscount - promoDiscount);
  const taxAmount = roundCurrency(taxableAmount * settings.taxRate);
  const deliveryFee = orderType === "delivery" ? resolvedDeliveryFee : 0;
  const total = roundCurrency(taxableAmount + taxAmount + deliveryFee);

  const session = await mongoose.startSession();
  try {
    let createdOrder;
    await session.withTransaction(async () => {
      const orderNumber = await nextOrderNumber(restaurant._id, session);

      const [order] = await Order.create(
        [
          {
            restaurantId,
            customerId,
            orderNumber,
            items: pricedItems,
            orderType,
            paymentMethod,
            currency: settings.currency,
            subtotal,
            taxAmount,
            deliveryFee,
            discount: loyaltyDiscount,
            promoCode: appliedPromo?.promotion.code,
            promoDiscount,
            total,
            loyaltyPointsRedeemed: loyaltyDiscount,
            loyaltyPointsEarned: 0,
            deliveryAddress: orderType === "delivery" ? deliveryAddress : undefined,
            deliveryDistanceKm: orderType === "delivery" ? deliveryDistanceKm : undefined,
            tableId: table?._id,
            tableName: table?.name,
            customerNotes,
            statusHistory: [{ status: "pending", at: new Date() }],
          },
        ],
        { session }
      );

      if (loyaltyDiscount > 0) {
        await redeemPoints(restaurantId, customerId, loyaltyDiscount, order.id, session);
      }
      if (appliedPromo) {
        // Re-checked atomically at write time, not just trusted from validatePromoCode's earlier
        // read (see promotion.service.ts's recordPromoUsage) — a concurrent order that reached the
        // usage limit first aborts this whole transaction rather than oversubscribing the promo.
        const recorded = await recordPromoUsage(appliedPromo.promotion.id, session);
        if (!recorded) {
          throw ApiError.conflict("This promo code just reached its usage limit — please remove it and try again");
        }
      }

      const earned = await earnPoints(restaurantId, customerId, order.id, total, session);
      order.loyaltyPointsEarned = earned;
      await order.save({ session });
      createdOrder = order.toJSON();
    });

    sendSuccess(res, { order: createdOrder }, 201);
    const created = createdOrder as unknown as { id: string; orderNumber: string };
    emitOrderEvent("order.created", {
      orderId: created.id,
      orderNumber: created.orderNumber,
      restaurantId,
      customerId,
      status: "pending",
    });
  } finally {
    await session.endSession();
  }
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

  const filter: Record<string, unknown> = { restaurantId };
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

  const order = await Order.findOne({ _id: id, restaurantId });
  if (!order) throw ApiError.notFound("Order not found");

  if (!isValidStatusTransition(order.status, nextStatus, order.orderType)) {
    throw ApiError.badRequest(`Cannot move an order from "${order.status}" to "${nextStatus}"`);
  }
  // An online order that hasn't actually been paid yet must not be accepted into the kitchen
  // workflow — cancelling out of "pending" is still allowed either way (nothing to protect there).
  if (order.paymentMethod === "online" && order.paymentStatus !== "paid" && nextStatus !== "cancelled") {
    throw ApiError.badRequest("This order's online payment has not completed yet — it cannot be accepted");
  }

  const previousStatus = order.status;
  order.status = nextStatus;
  order.statusHistory.push({ status: nextStatus, at: new Date() });
  await order.save();

  // Phase 17 product decision — cancelling a paid order does NOT auto-refund it. Loyalty points
  // reverse automatically (an accounting correction with no external side effect), but a refund is
  // a real-money action against an external payment provider: auto-firing it as a side effect of
  // every cancellation would remove the restaurant's ability to withhold a refund (e.g. a
  // no-show/late cancellation fee, suspected fraud) and would mix an external provider network call
  // into this request's synchronous path for no operational benefit. Refunds stay an explicit,
  // separate staff action (payment.service.ts's refundPayment / the admin "Issue refund" button),
  // which the admin UI now flags prominently when a cancelled order's payment is still unrefunded
  // (see OrderPaymentAdmin.tsx's needsRefundAttention) so this is never a silent gap in practice.
  if (nextStatus === "cancelled") {
    await reverseLoyaltyForOrderIfNeeded(order);
  }

  // Awaited BEFORE the response is sent: a caller that immediately reads the audit log after
  // getting a 200 back must already see this entry — recordAuditEvent still swallows its own
  // errors (see audit.service.ts), so this can't turn a real status change into a failed request.
  await recordAuditEvent({
    restaurantId,
    actorUserId: req.user!.id,
    actorRole: req.user!.role,
    action: nextStatus === "cancelled" ? "order.cancelled" : "order.status_changed",
    targetType: "order",
    targetId: order.id,
    metadata: { from: previousStatus, to: nextStatus },
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
