import type { Request, Response } from "express";
import mongoose, { type HydratedDocument } from "mongoose";
import type { CreateOrderInput, UpdateOrderPaymentStatusInput, UpdateOrderStatusInput } from "@restaurant/validation";
import { roleHasPermission } from "@restaurant/types";
import { Restaurant } from "../models/Restaurant.js";
import { Order, type OrderDoc } from "../models/Order.js";
import { User } from "../models/User.js";
import { ApiError } from "../utils/ApiError.js";
import { sendSuccess } from "../common/response.js";
import { earnPoints, redeemPoints } from "../services/loyalty.service.js";
import { priceOrderItems } from "../services/orderPricing.service.js";
import { nextOrderNumber } from "../services/orderNumber.service.js";
import { isValidStatusTransition } from "../services/orderStateMachine.js";
import { computeAvailability } from "../services/restaurantAvailability.service.js";

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
  const { items, orderType, deliveryAddress, customerNotes, redeemPoints: pointsToRedeem } =
    req.body as CreateOrderInput;
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
  if (orderType === "delivery" && !settings.deliveryEnabled) throw ApiError.badRequest("Delivery is not available");
  if (orderType === "delivery" && !deliveryAddress) {
    throw ApiError.badRequest("deliveryAddress is required for delivery orders");
  }

  // Prices, names, and modifier selections are entirely re-derived from the database here —
  // nothing about what this order costs comes from the request body except which menu items
  // and modifier options the customer picked.
  const { items: pricedItems, subtotal } = await priceOrderItems(restaurantId, items);

  if (subtotal < settings.minOrderAmount) {
    throw ApiError.badRequest(`Minimum order amount is ${settings.minOrderAmount}`);
  }

  // 1 point = 1 currency unit discount, applied before tax
  const discount = Math.min(pointsToRedeem, subtotal);
  const taxableAmount = subtotal - discount;
  const taxAmount = roundCurrency(taxableAmount * settings.taxRate);
  const deliveryFee = orderType === "delivery" ? settings.deliveryFee : 0;
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
            subtotal,
            taxAmount,
            deliveryFee,
            discount,
            total,
            loyaltyPointsRedeemed: discount,
            loyaltyPointsEarned: 0,
            deliveryAddress,
            customerNotes,
          },
        ],
        { session }
      );

      if (discount > 0) {
        await redeemPoints(restaurantId, customerId, discount, order.id, session);
      }

      const earned = await earnPoints(restaurantId, customerId, order.id, total, session);
      order.loyaltyPointsEarned = earned;
      await order.save({ session });
      createdOrder = order.toJSON();
    });

    sendSuccess(res, { order: createdOrder }, 201);
  } finally {
    await session.endSession();
  }
}

export async function listMyOrders(req: Request, res: Response) {
  const orders = await Order.find({ customerId: req.user!.id }).sort({ createdAt: -1 });
  sendSuccess(res, { orders: orders.map((o) => o.toJSON()) });
}

export async function listRestaurantOrders(req: Request, res: Response) {
  const { restaurantId } = req.params;
  const orders = await Order.find({ restaurantId }).sort({ createdAt: -1 });
  sendSuccess(res, { orders: await withCustomerInfo(orders) });
}

export async function getOrder(req: Request, res: Response) {
  const order = await Order.findById(req.params.id);
  if (!order) throw ApiError.notFound("Order not found");

  const isOwner = order.customerId.toString() === req.user!.id;
  const isStaffForThisRestaurant =
    req.user!.role === "platform_admin" ||
    (roleHasPermission(req.user!.role, "restaurant.orders.read") &&
      req.user!.restaurantId === order.restaurantId.toString());
  if (!isOwner && !isStaffForThisRestaurant) throw ApiError.forbidden();

  const [withInfo] = await withCustomerInfo([order]);
  sendSuccess(res, { order: withInfo });
}

export async function updateOrderStatus(req: Request, res: Response) {
  const { restaurantId, id } = req.params;
  const { status: nextStatus } = req.body as UpdateOrderStatusInput;

  const order = await Order.findOne({ _id: id, restaurantId });
  if (!order) throw ApiError.notFound("Order not found");

  if (!isValidStatusTransition(order.status, nextStatus, order.orderType)) {
    throw ApiError.badRequest(`Cannot move an order from "${order.status}" to "${nextStatus}"`);
  }

  order.status = nextStatus;
  await order.save();
  sendSuccess(res, { order: order.toJSON() });
}

export async function updateOrderPaymentStatus(req: Request, res: Response) {
  const { restaurantId, id } = req.params;
  const { paymentStatus } = req.body as UpdateOrderPaymentStatusInput;

  const order = await Order.findOneAndUpdate(
    { _id: id, restaurantId },
    { $set: { paymentStatus } },
    { new: true, runValidators: true }
  );
  if (!order) throw ApiError.notFound("Order not found");
  sendSuccess(res, { order: order.toJSON() });
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
  await order.save();
  sendSuccess(res, { order: order.toJSON() });
}
