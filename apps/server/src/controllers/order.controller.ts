import type { Request, Response } from "express";
import mongoose from "mongoose";
import { z } from "zod";
import { MenuItem } from "../models/MenuItem.js";
import { Order } from "../models/Order.js";
import { ApiError } from "../utils/ApiError.js";
import { earnPoints, redeemPoints } from "../services/loyalty.service.js";

export const createOrderSchema = z.object({
  items: z
    .array(z.object({ menuItemId: z.string(), quantity: z.number().int().positive() }))
    .min(1),
  redeemPoints: z.number().int().nonnegative().default(0),
});

export async function createOrder(req: Request, res: Response) {
  const { items, redeemPoints: pointsToRedeem } = req.body as z.infer<typeof createOrderSchema>;
  const customerId = req.user!.id;

  const menuItemIds = items.map((i) => i.menuItemId);
  const menuItems = await MenuItem.find({ _id: { $in: menuItemIds }, isAvailable: true });
  if (menuItems.length !== new Set(menuItemIds).size) {
    throw ApiError.badRequest("One or more menu items are unavailable or do not exist");
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
        await redeemPoints(customerId, redeemedValue, order.id, session);
      }

      const earned = await earnPoints(customerId, order.id, total, session);
      order.loyaltyPointsEarned = earned;
      await order.save({ session });
      createdOrder = order;
    });

    res.status(201).json({ order: createdOrder });
  } finally {
    await session.endSession();
  }
}

export async function listMyOrders(req: Request, res: Response) {
  const orders = await Order.find({ customerId: req.user!.id }).sort({ createdAt: -1 });
  res.json({ orders });
}

export async function getOrder(req: Request, res: Response) {
  const order = await Order.findById(req.params.id);
  if (!order) throw ApiError.notFound("Order not found");

  const isOwner = order.customerId.toString() === req.user!.id;
  const isStaff = req.user!.role === "staff" || req.user!.role === "admin";
  if (!isOwner && !isStaff) throw ApiError.forbidden();

  res.json({ order });
}

const updateStatusSchema = z.object({
  status: z.enum(["pending", "confirmed", "preparing", "out_for_delivery", "delivered", "cancelled"]),
});

export async function updateOrderStatus(req: Request, res: Response) {
  const { status } = updateStatusSchema.parse(req.body);
  const order = await Order.findByIdAndUpdate(req.params.id, { status }, { new: true });
  if (!order) throw ApiError.notFound("Order not found");
  res.json({ order });
}
