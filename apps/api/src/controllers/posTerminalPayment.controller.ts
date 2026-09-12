import type { Request, Response } from "express";
import type { CreatePosTerminalPaymentInput, MockCompleteTerminalPaymentInput } from "@restaurant/validation";
import { sendSuccess } from "../common/response.js";
import {
  cancelPosTerminalPayment,
  createPosTerminalPayment,
  getPosTerminalPaymentStatus,
} from "../services/posTerminalPayment.service.js";
import { getMockTerminalProvider } from "../payments/terminal/index.js";
import { ApiError } from "../utils/ApiError.js";

/**
 * Phase 74 — all three real endpoints below sit under posRouter (routes/pos.routes.ts), which
 * already applies requireAuth + requireTenantMatch() + requirePermission("restaurant.pos.operate")
 * to every route in the file — no new permission, no separate auth check here. Owner/manager/staff
 * (the roles that already hold restaurant.pos.operate) can all initiate/poll/cancel a terminal
 * payment; kitchen_staff, which never holds that permission, is rejected before reaching any of
 * these, exactly like every other POS action.
 */
export async function createTerminalPayment(req: Request, res: Response) {
  const { restaurantId, orderId } = req.params;
  const { idempotencyKey } = req.body as CreatePosTerminalPaymentInput;

  const { payment, created } = await createPosTerminalPayment({ restaurantId, orderId, idempotencyKey });
  sendSuccess(res, { payment: payment.toJSON() }, created ? 201 : 200);
}

export async function getTerminalPaymentStatus(req: Request, res: Response) {
  const { restaurantId, orderId, paymentId } = req.params;
  const payment = await getPosTerminalPaymentStatus(restaurantId, orderId, paymentId);
  sendSuccess(res, { payment: payment.toJSON() });
}

export async function cancelTerminalPayment(req: Request, res: Response) {
  const { restaurantId, orderId, paymentId } = req.params;
  const payment = await cancelPosTerminalPayment(restaurantId, orderId, paymentId);
  sendSuccess(res, { payment: payment.toJSON() });
}

/**
 * Dev/test-only stand-in for "the physical terminal reported an outcome" — only ever mounted when
 * POS_TERMINAL_PROVIDER=mock (see routes/pos.routes.ts). A deployment with a real provider (or none
 * at all) has no such route, so this can never be mistaken for or substituted as a real terminal
 * response. Flips the mock's in-memory record; the next status poll picks it up via retrieve() and
 * applies it through the same transition path a real provider's answer would use — this endpoint
 * itself never marks anything paid directly.
 */
export async function mockCompleteTerminalPayment(req: Request, res: Response) {
  const { restaurantId, orderId, paymentId } = req.params;
  const { outcome } = req.body as MockCompleteTerminalPaymentInput;

  const payment = await getPosTerminalPaymentStatus(restaurantId, orderId, paymentId);
  if (!payment.providerRef) throw ApiError.badRequest("Payment has no provider reference yet");

  getMockTerminalProvider().simulateOutcome(payment.providerRef, outcome);

  const updated = await getPosTerminalPaymentStatus(restaurantId, orderId, paymentId);
  sendSuccess(res, { payment: updated.toJSON() });
}
