import type { Request, Response } from "express";
import mongoose from "mongoose";
import type { CreateOrderInput, UpdateOrderStatusInput } from "@restaurant/validation";
import { roleHasPermission } from "@restaurant/types";
import { MenuItem } from "../models/MenuItem.js";
import { Restaurant } from "../models/Restaurant.js";
import { Order } from "../models/Order.js";
import { ApiError } from "../utils/ApiError.js";
import { sendSuccess } from "../common/response.js";
import { earnPoints, redeemPoints } from "../services/loyalty.service.js";

export async function createOrder(req: Request, res: Response) {
  const { restaurantId } = req.params;
  const { items, redeemPoints: pointsToRedeem } = req.body as CreateOrderInput;
  const customerId = req.user!.id;

  const restaurant = await Restaurant.findOne({ _id: restaurantId, status: "active" });
  if (!restaurant) throw ApiError.notFound("Restaurant not found");

  const menuItemIds = items.map((i) => i.menuItemId);
  const menuItems = await MenuItem.find({ _id: { $in: menuItemIds }, restaurantId, isAvailable: true });
  if (menuItems.length !== new Set(menuItemIds).size) {
    throw ApiError.badRequest("One or more menu items are unavailable or do not exist for this restaurant");
  }

  const menuItemById = new Map(menuItems.map((m) => [m.id, m]));
  const orderItems = items.map((i) => {
    const menuItem = menuItemById.get(i.menuItemId)!;
    return {
      menuItemId: menuItem._id,
      name: menuItem.name,
      price: menuItem.price,
      quantity: i.quantity,
    };
  });

  const subtotal = orderItems.reduce((sum, i) => sum + i.price * i.quantity, 0);
  // 1 point = 1 currency unit discount, applied before earning new points on the discounted total
  const redeemedValue = Math.min(pointsToRedeem, subtotal);
  const total = subtotal - redeemedValue;

  const session = await mongoose.startSession();
  try {
    let createdOrder;
    await session.withTransaction(async () => {
      const [order] = await Order.create(
        [
          {
            restaurantId,
            customerId,
            items: orderItems,
            subtotal,
            total,
            loyaltyPointsRedeemed: redeemedValue,
            loyaltyPointsEarned: 0,
          },
        ],
        { session }
      );

      if (redeemedValue > 0) {
        await redeemPoints(restaurantId, customerId, redeemedValue, order.id, session);
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
  sendSuccess(res, { orders: orders.map((o) => o.toJSON()) });
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

  sendSuccess(res, { order: order.toJSON() });
}

export async function updateOrderStatus(req: Request, res: Response) {
  const { restaurantId, id } = req.params;
  const { status } = req.body as UpdateOrderStatusInput;
  const order = await Order.findOneAndUpdate({ _id: id, restaurantId }, { status }, { new: true });
  if (!order) throw ApiError.notFound("Order not found");
  sendSuccess(res, { order: order.toJSON() });
}
