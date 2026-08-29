import type { Request, Response } from "express";
import { ApiError } from "../utils/ApiError.js";
import { getPaymentProvider, KNOWN_PAYMENT_PROVIDER_NAMES, type PaymentProviderName } from "../payments/index.js";
import { buildProviderFromAccount } from "../payments/restaurantProvider.js";
import { RestaurantPaymentAccount } from "../models/RestaurantPaymentAccount.js";
import { processProviderEvent } from "../services/payment.service.js";

/**
 * POST /webhooks/payments/:provider — no requireAuth: a webhook is authenticated by its
 * signature, not a session. req.rawBody is the raw request-body Buffer captured by app.ts's
 * express.json({verify}) hook — verification must run against the exact bytes the provider
 * signed, not a re-serialized copy of the parsed body (which can differ in whitespace/key order
 * and would make every real signature fail).
 *
 * Phase 34 — looks up the provider the URL itself names (getPaymentProvider(name), the registry
 * keyed lookup) rather than comparing against a single configured default's `.name`: a deployment
 * can now have more than one provider actually configured (payments/eligibility.ts routes
 * different restaurants to different providers), so "safepay" and "stripe" webhooks must both be
 * routable at once, not just whichever one PAYMENT_PROVIDER happens to name.
 */
export async function handleProviderWebhook(req: Request, res: Response) {
  if (!KNOWN_PAYMENT_PROVIDER_NAMES.includes(req.params.provider as PaymentProviderName)) {
    throw ApiError.badRequest(`"${req.params.provider}" is not a recognized payment provider`);
  }

  let provider;
  try {
    provider = getPaymentProvider(req.params.provider as PaymentProviderName);
  } catch {
    // Deliberately 400, not 404 or 500: this is a request that arrived at a real endpoint but
    // names a provider this deployment isn't configured (missing credentials) for — worth
    // distinguishing from a plain wrong-URL 404, and from an unrelated server error, in
    // logs/monitoring.
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

/**
 * POST /webhooks/payments/:provider/:restaurantPaymentAccountId — the BYOC counterpart to
 * handleProviderWebhook above (see restaurantProvider.ts, RestaurantPaymentAccount.ts). A shared
 * per-provider-name secret can't verify a webhook signed with a specific restaurant's OWN secret,
 * so a BYOC-connected restaurant's own provider dashboard points its webhook config at this URL
 * instead — naming the account up front is the only way to know which decrypted secret to check
 * before trusting anything in the payload. No auth here either, same reasoning as above: the
 * account id alone isn't sensitive, and nothing of substance happens before signature verification.
 */
export async function handleRestaurantAccountWebhook(req: Request, res: Response) {
  if (!KNOWN_PAYMENT_PROVIDER_NAMES.includes(req.params.provider as PaymentProviderName) || req.params.provider === "mock") {
    throw ApiError.badRequest(`"${req.params.provider}" is not a BYOC-eligible payment provider`);
  }

  const account = await RestaurantPaymentAccount.findOne({
    _id: req.params.restaurantPaymentAccountId,
    provider: req.params.provider,
  });
  if (!account) throw ApiError.badRequest("No matching restaurant payment account for this provider/id");

  const provider = buildProviderFromAccount(account);
  const rawBody = (req as Request & { rawBody?: Buffer }).rawBody ?? Buffer.from(JSON.stringify(req.body ?? {}));
  const signatureHeader = req.header(provider.signatureHeaderName);

  const event = provider.verifyWebhookSignature(rawBody, signatureHeader);
  if (!event) throw ApiError.badRequest("Invalid webhook signature");

  await processProviderEvent(provider.name, event, account._id.toString());

  res.status(200).json({ received: true });
}
