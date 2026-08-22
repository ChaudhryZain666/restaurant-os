import type { Request, Response } from "express";
import type { MockCompletePaymentInput } from "@restaurant/validation";
import { ApiError } from "../utils/ApiError.js";
import { sendSuccess } from "../common/response.js";
import { getMockPaymentProvider } from "../payments/index.js";
import { getPaymentById, processProviderEvent } from "../services/payment.service.js";

/**
 * Dev/test-only stand-in for "the customer finished paying on the provider's hosted page." Only
 * ever mounted when PAYMENT_PROVIDER=mock (see routes/payment.routes.ts) — a deployment
 * configured for a real provider has no such route at all, so this can never be mistaken for or
 * substituted as a real payment confirmation. It drives the SAME signature-verification and
 * idempotent-event-processing path a genuine webhook delivery would (see
 * services/payment.service.ts's processProviderEvent), not a shortcut around it.
 */
export async function mockCompletePayment(req: Request, res: Response) {
  const { restaurantId, orderId, paymentId } = req.params;
  const { outcome } = req.body as MockCompletePaymentInput;

  const payment = await getPaymentById(restaurantId, paymentId);
  if (payment.orderId.toString() !== orderId) throw ApiError.notFound("Payment not found");
  if (payment.customerId.toString() !== req.user!.id) throw ApiError.forbidden();
  if (!payment.providerRef) throw ApiError.badRequest("Payment has no provider reference yet");

  const mockProvider = getMockPaymentProvider();
  const payload = mockProvider.simulateOutcome(payment.providerRef, outcome);
  const { rawBody, signatureHeader } = mockProvider.signPayload(payload);
  const event = mockProvider.verifyWebhookSignature(rawBody, signatureHeader);
  if (!event) throw new Error("mock provider failed to verify its own freshly-signed payload");

  await processProviderEvent(mockProvider.name, event);

  const updated = await getPaymentById(restaurantId, paymentId);
  sendSuccess(res, { payment: updated.toJSON() });
}
