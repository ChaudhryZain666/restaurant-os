import type { Request, Response } from "express";
import { roleHasPermission } from "@restaurant/types";
import type { CreatePaymentInput, RefundPaymentInput, ResolveRefundInput } from "@restaurant/validation";
import { Order } from "../models/Order.js";
import { ApiError } from "../utils/ApiError.js";
import { sendSuccess } from "../common/response.js";
import {
  createPaymentForOrder,
  describeRefundForStaff,
  getPaymentById,
  listPaymentsForOrder,
  reconcileRefund,
  refundPayment,
  resolveHeldRefund,
} from "../services/payment.service.js";
import { Refund } from "../models/Refund.js";
import { recordAuditEvent } from "../services/audit.service.js";
import { resolveTenantAccess } from "../middleware/tenant.js";

async function assertCanViewOrderPayments(req: Request, restaurantId: string, orderId: string) {
  const order = await Order.findOne({ _id: orderId, restaurantId });
  if (!order) throw ApiError.notFound("Order not found");

  const isOwner = order.customerId.toString() === req.user!.id;
  // Phase 35 audit fix — was `req.user!.restaurantId === restaurantId`, the same flat-comparison
  // bug already fixed once in order.controller.ts's getOrder (Phase 29 finding P1-8): over-
  // restrictive, not a security hole, but a genuine 403 for any multi-location owner/manager/agency
  // member viewing payments for a location other than the one their JWT was originally issued for.
  const isStaff =
    req.user!.role === "platform_admin" ||
    (roleHasPermission(req.user!.role, "restaurant.orders.read") && (await resolveTenantAccess(req.user!, restaurantId)).allowed);
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

  // Only a refund that actually went through is audited as "refunded" — a pending or held one is
  // audited when it is held/reconciled (payment.service.ts).
  if (refundDoc.status === "succeeded") {
    await recordAuditEvent({
      restaurantId,
      actorUserId: req.user!.id,
      actorRole: req.user!.role,
      action: "payment.refunded",
      targetType: "payment",
      targetId: paymentId,
      metadata: { amount: refundDoc.amount, refundId: refundDoc.id },
    });
  }

  sendSuccess(res, { refund: refundDoc.toJSON(), reconciliation: await describeRefundForStaff(refundDoc) }, 201);
}

async function findPaymentRefund(req: Request) {
  const { restaurantId, orderId, paymentId, refundId } = req.params;
  const refundDoc = await Refund.findOne({ _id: refundId, restaurantId, paymentId, orderId });
  if (!refundDoc) throw ApiError.notFound("Refund not found");
  return refundDoc;
}

/** GET …/payments/:paymentId/refunds — every refund on the payment, with what staff should do next. */
export async function listPaymentRefunds(req: Request, res: Response) {
  const { restaurantId, orderId, paymentId } = req.params;
  const refunds = await Refund.find({ restaurantId, orderId, paymentId }).sort({ createdAt: -1 });
  const cache = new Map();
  const items = await Promise.all(
    refunds.map(async (r) => ({ ...r.toJSON(), reconciliation: await describeRefundForStaff(r, cache) }))
  );
  sendSuccess(res, { refunds: items });
}

/** POST …/refunds/:refundId/check — look the refund up in the provider's records. Never creates a
 *  refund; an inconclusive lookup leaves it held. */
export async function checkPaymentRefund(req: Request, res: Response) {
  const refundDoc = await findPaymentRefund(req);
  const { refund: updated, outcome } = await reconcileRefund(refundDoc, { actorUserId: req.user!.id, actorRole: req.user!.role });
  sendSuccess(res, { refund: updated.toJSON(), outcome, reconciliation: await describeRefundForStaff(updated) });
}

/** POST …/refunds/:refundId/retry — lookup first; only re-issues (same key) when the provider
 *  definitively has no such refund and still honors the key. */
export async function retryPaymentRefund(req: Request, res: Response) {
  const refundDoc = await findPaymentRefund(req);
  const { refund: updated, outcome } = await reconcileRefund(refundDoc, { actorUserId: req.user!.id, actorRole: req.user!.role, allowReissue: true });
  sendSuccess(res, { refund: updated.toJSON(), outcome, reconciliation: await describeRefundForStaff(updated) });
}

/** POST …/refunds/:refundId/resolve — a person settles a held refund with evidence. */
export async function resolvePaymentRefund(req: Request, res: Response) {
  const refundDoc = await findPaymentRefund(req);
  const updated = await resolveHeldRefund(refundDoc, req.body as ResolveRefundInput, { actorUserId: req.user!.id, actorRole: req.user!.role });
  sendSuccess(res, { refund: updated.toJSON(), reconciliation: await describeRefundForStaff(updated) });
}
