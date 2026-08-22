import type { Request, Response } from "express";
import { roleHasPermission } from "@restaurant/types";
import type { CreatePaymentInput, RefundPaymentInput } from "@restaurant/validation";
import { Order } from "../models/Order.js";
import { ApiError } from "../utils/ApiError.js";
import { sendSuccess } from "../common/response.js";
import { createPaymentForOrder, getPaymentById, listPaymentsForOrder, refundPayment } from "../services/payment.service.js";
import { recordAuditEvent } from "../services/audit.service.js";

async function assertCanViewOrderPayments(req: Request, restaurantId: string, orderId: string) {
  const order = await Order.findOne({ _id: orderId, restaurantId });
  if (!order) throw ApiError.notFound("Order not found");

  const isOwner = order.customerId.toString() === req.user!.id;
  const isStaff =
    req.user!.role === "platform_admin" ||
    (roleHasPermission(req.user!.role, "restaurant.orders.read") && req.user!.restaurantId === restaurantId);
  if (!isOwner && !isStaff) throw ApiError.forbidden();
}

export async function createPayment(req: Request, res: Response) {
  const { restaurantId, orderId } = req.params;
  const { idempotencyKey } = req.body as CreatePaymentInput;

  const { payment, clientSecret, created } = await createPaymentForOrder({
    restaurantId,
    orderId,
    customerId: req.user!.id,
    idempotencyKey,
  });

  sendSuccess(res, { payment: payment.toJSON(), clientSecret }, created ? 201 : 200);
}

export async function listPayments(req: Request, res: Response) {
  const { restaurantId, orderId } = req.params;
  await assertCanViewOrderPayments(req, restaurantId, orderId);
  const payments = await listPaymentsForOrder(restaurantId, orderId);
  sendSuccess(res, { payments: payments.map((p) => p.toJSON()) });
}

export async function getPayment(req: Request, res: Response) {
  const { restaurantId, orderId, paymentId } = req.params;
  await assertCanViewOrderPayments(req, restaurantId, orderId);
  const payment = await getPaymentById(restaurantId, paymentId);
  if (payment.orderId.toString() !== orderId) throw ApiError.notFound("Payment not found");
  sendSuccess(res, { payment: payment.toJSON() });
}

export async function refund(req: Request, res: Response) {
  const { restaurantId, paymentId } = req.params;
  const { amount, reason, idempotencyKey } = req.body as RefundPaymentInput;

  const refundDoc = await refundPayment({
    restaurantId,
    paymentId,
    amount,
    reason,
    initiatedByUserId: req.user!.id,
    idempotencyKey,
  });

  await recordAuditEvent({
    restaurantId,
    actorUserId: req.user!.id,
    actorRole: req.user!.role,
    action: "payment.refunded",
    targetType: "payment",
    targetId: paymentId,
    metadata: { amount: refundDoc.amount, refundId: refundDoc.id },
  });

  sendSuccess(res, { refund: refundDoc.toJSON() }, 201);
}
