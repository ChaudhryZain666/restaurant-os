import type { Request, Response } from "express";
import type { MockAdvanceSubscriptionInput } from "@restaurant/validation";
import { ApiError } from "../utils/ApiError.js";
import { sendSuccess } from "../common/response.js";
import { getMockBillingProvider } from "../billing/index.js";
import { getSubscriptionForBusiness, processBillingProviderEvent } from "../services/subscription.service.js";

/**
 * Dev/test-only stand-in for "time passed and the provider reported a status change" (a trial
 * converting, a charge failing, a period-end cancellation landing) — the billing equivalent of
 * paymentMockDriver.controller.ts's mockCompletePayment. Only ever mounted when
 * BILLING_PROVIDER=mock (see routes/businessSubscription.routes.ts); a deployment configured for a
 * real provider has no such route at all. Drives the SAME signature-verification and idempotent
 * event-processing path a genuine webhook delivery would (processBillingProviderEvent), not a
 * shortcut around it.
 */
export async function mockAdvanceSubscription(req: Request, res: Response) {
  const { businessId } = req.params;
  const { status } = req.body as MockAdvanceSubscriptionInput;

  const subscription = await getSubscriptionForBusiness(businessId);
  if (!subscription) throw ApiError.notFound("This business has no subscription");
  if (!subscription.providerSubscriptionId) throw ApiError.badRequest("This subscription has no provider reference yet");

  const mockProvider = getMockBillingProvider();
  const payload = mockProvider.simulateEvent(subscription.providerSubscriptionId, status);
  const { rawBody, signatureHeader } = mockProvider.signPayload(payload);
  const event = mockProvider.verifyWebhookSignature(rawBody, signatureHeader);
  if (!event) throw new Error("mock provider failed to verify its own freshly-signed payload");

  await processBillingProviderEvent(mockProvider.name, event);

  const updated = await getSubscriptionForBusiness(businessId);
  sendSuccess(res, { subscription: updated!.toJSON() });
}
