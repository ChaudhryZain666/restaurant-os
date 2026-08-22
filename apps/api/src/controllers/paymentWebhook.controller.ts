import type { Request, Response } from "express";
import { ApiError } from "../utils/ApiError.js";
import { getPaymentProvider } from "../payments/index.js";
import { processProviderEvent } from "../services/payment.service.js";

/**
 * POST /webhooks/payments/:provider — no requireAuth: a webhook is authenticated by its
 * signature, not a session. req.rawBody is the raw request-body Buffer captured by app.ts's
 * express.json({verify}) hook — verification must run against the exact bytes the provider
 * signed, not a re-serialized copy of the parsed body (which can differ in whitespace/key order
 * and would make every real signature fail).
 */
export async function handleProviderWebhook(req: Request, res: Response) {
  const provider = getPaymentProvider();
  if (provider.name !== req.params.provider) {
    // Deliberately 400, not 404: this is a request that arrived at a real endpoint but claims to
    // be from a provider this deployment isn't configured for — worth distinguishing from a
    // plain wrong-URL 404 in logs/monitoring.
    throw ApiError.badRequest(`This deployment is not configured for provider "${req.params.provider}"`);
  }

  const rawBody = (req as Request & { rawBody?: Buffer }).rawBody ?? Buffer.from(JSON.stringify(req.body ?? {}));
  // Read from whichever header THIS provider actually signs with — not a single hardcoded name,
  // since different real providers use different header conventions (see
  // PaymentProvider.signatureHeaderName).
  const signatureHeader = req.header(provider.signatureHeaderName);

  const event = provider.verifyWebhookSignature(rawBody, signatureHeader);
  if (!event) throw ApiError.badRequest("Invalid webhook signature");

  await processProviderEvent(provider.name, event);

  res.status(200).json({ received: true });
}
