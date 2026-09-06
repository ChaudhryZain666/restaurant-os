import type { Request, Response } from "express";
import { ApiError } from "../utils/ApiError.js";
import { getBillingProvider } from "../billing/index.js";
import { processBillingProviderEvent } from "../services/subscription.service.js";
import { logger } from "../common/logger.js";

/**
 * POST /webhooks/billing/:provider — mirrors paymentWebhook.controller.ts's handleProviderWebhook
 * exactly: no requireAuth, authenticated by signature alone. req.rawBody is the raw request-body
 * Buffer captured by app.ts's express.json({verify}) hook — the same capture already used for
 * payment webhooks, reused here rather than duplicated.
 */
export async function handleBillingProviderWebhook(req: Request, res: Response) {
  const provider = getBillingProvider();
  if (provider.name !== req.params.provider) {
    throw ApiError.badRequest(`This deployment is not configured for billing provider "${req.params.provider}"`);
  }

  const rawBody = (req as Request & { rawBody?: Buffer }).rawBody ?? Buffer.from(JSON.stringify(req.body ?? {}));
  const signatureHeader = req.header(provider.signatureHeaderName);

  const event = provider.verifyWebhookSignature(rawBody, signatureHeader);
  if (!event) {
    // Phase 48 — the global error handler only logs 500+ responses, so this 400 was previously
    // invisible in our own logs regardless of whether it meant a misconfigured secret or a genuine
    // forged request. .warn, not .error: a correctly-handled rejection, not a server fault. Never
    // logs the signature header or raw body.
    logger.warn("billing webhook signature verification failed", { provider: provider.name });
    throw ApiError.badRequest("Invalid webhook signature");
  }

  await processBillingProviderEvent(provider.name, event);

  res.status(200).json({ received: true });
}
