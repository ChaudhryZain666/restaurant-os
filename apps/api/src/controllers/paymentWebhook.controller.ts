import type { Request, Response } from "express";
import { ApiError } from "../utils/ApiError.js";
import { getPaymentProvider, KNOWN_PAYMENT_PROVIDER_NAMES, type PaymentProviderName } from "../payments/index.js";
import { buildProviderFromAccount } from "../payments/restaurantProvider.js";
import { RestaurantPaymentAccount } from "../models/RestaurantPaymentAccount.js";
import { verifyStripeSignatureRaw, mapCheckoutSessionStatus } from "../payments/StripeProvider.js";
import { parseAccountEventObject, resolveConnectAccountStatus } from "../payments/stripeConnect.js";
import { processProviderEvent } from "../services/payment.service.js";
import { PaymentWebhookEvent } from "../models/PaymentWebhookEvent.js";
import { logger } from "../common/logger.js";
import { env } from "../config/env.js";

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
  // Phase 37 — a platform_connect account has no per-account webhook secret at all (Stripe Connect
  // events arrive centrally — see handleStripeConnectWebhook below), so this per-account URL must
  // never be reachable for one: buildProviderFromAccount would construct a StripeProvider with an
  // EMPTY webhookSecret for it, which is a real spoofing risk (a predictable/empty HMAC key), not
  // just a wrong-flow error.
  if (account.connectionMode === "platform_connect") {
    throw ApiError.badRequest("This payment account uses centralized webhook delivery, not a per-account URL");
  }

  const provider = buildProviderFromAccount(account);
  const rawBody = (req as Request & { rawBody?: Buffer }).rawBody ?? Buffer.from(JSON.stringify(req.body ?? {}));
  const signatureHeader = req.header(provider.signatureHeaderName);

  const event = provider.verifyWebhookSignature(rawBody, signatureHeader);
  if (!event) throw ApiError.badRequest("Invalid webhook signature");

  // Phase 35 audit fix — the first successfully-verified real event for this account is the only
  // genuine proof the owner actually finished configuring their provider dashboard's webhook, as
  // opposed to just entering a valid API key. Never set on connect, never faked.
  if (!account.firstWebhookReceivedAt) {
    await RestaurantPaymentAccount.updateOne({ _id: account._id }, { $set: { firstWebhookReceivedAt: new Date() } });
  }

  await processProviderEvent(provider.name, event, account._id.toString());

  res.status(200).json({ received: true });
}

interface StripeConnectEventPayload {
  id?: string;
  type?: string;
  account?: string;
  data?: { object?: { id?: string; status?: string; payment_status?: string } };
}

/**
 * POST /webhooks/payments/stripe-connect (Phase 37) — the ONE centralized endpoint for every
 * connected restaurant's Stripe events, registered once at the platform level (Connect-scoped —
 * "Events from: Connected accounts" — per Stripe's own current docs), never configured by a
 * restaurant. Verified against STRIPE_CONNECT_WEBHOOK_SECRET — deliberately separate from
 * STRIPE_WEBHOOK_SECRET (the pooled platform-account path), since these are two different Stripe
 * webhook endpoint registrations with two different signing secrets.
 *
 * Every real Connect event carries a top-level `account` field identifying which connected
 * account it's about — that field is how this single endpoint knows which restaurant it concerns,
 * with no restaurant-specific URL segment or secret involved at all.
 */
export async function handleStripeConnectWebhook(req: Request, res: Response) {
  if (!env.STRIPE_CONNECT_WEBHOOK_SECRET) {
    throw ApiError.badRequest("This deployment is not configured for Stripe Connect webhooks");
  }

  const rawBody = (req as Request & { rawBody?: Buffer }).rawBody ?? Buffer.from(JSON.stringify(req.body ?? {}));
  const signatureHeader = req.header("stripe-signature");
  const parsed = verifyStripeSignatureRaw(rawBody, signatureHeader, env.STRIPE_CONNECT_WEBHOOK_SECRET) as StripeConnectEventPayload | null;
  if (!parsed) throw ApiError.badRequest("Invalid webhook signature");

  const { id: eventId, type: eventType, account: connectedAccountId } = parsed;
  if (!eventId || !eventType || !connectedAccountId) {
    throw ApiError.badRequest("Malformed Stripe Connect event");
  }

  const account = await RestaurantPaymentAccount.findOne({ connectedAccountId, provider: "stripe" });
  if (!account) {
    logger.warn("stripe connect webhook for an unknown connected account", { connectedAccountId, eventType });
    res.status(200).json({ received: true });
    return;
  }

  // Payment events go through processProviderEvent, which already does its own idempotency
  // insert/atomic-transition — must NOT also insert PaymentWebhookEvent first here, or the second
  // (real) insert inside processProviderEvent would always collide with this one and the payment
  // would never actually transition. Account-status events (no payment involved) have no other
  // idempotency owner, so they get their own manual insert-then-early-return further below instead.
  if (eventType === "checkout.session.completed" || eventType === "checkout.session.expired") {
    const session = parsed.data?.object;
    if (session?.id) {
      if (!account.firstWebhookReceivedAt) {
        await RestaurantPaymentAccount.updateOne({ _id: account._id }, { $set: { firstWebhookReceivedAt: new Date() } });
      }
      await processProviderEvent(
        "stripe",
        {
          eventId,
          eventType,
          providerRef: session.id,
          status: mapCheckoutSessionStatus(eventType === "checkout.session.expired" ? "expired" : session.status, session.payment_status),
          raw: parsed,
        },
        account._id.toString()
      );
    }
    res.status(200).json({ received: true });
    return;
  }

  if (eventType !== "account.updated" && eventType !== "account.application.deauthorized") {
    // Any other Connect event this platform doesn't act on yet — acknowledge without processing,
    // same as processProviderEvent's own "no matching payment" branch does for events it can't use.
    res.status(200).json({ received: true });
    return;
  }

  try {
    await PaymentWebhookEvent.create({ provider: "stripe", eventId, eventType, payload: parsed });
  } catch (err) {
    if ((err as { code?: number }).code === 11000) {
      logger.info("duplicate stripe connect webhook event ignored", { eventId });
      res.status(200).json({ received: true });
      return;
    }
    throw err;
  }

  if (eventType === "account.updated") {
    // An explicit disconnect is sticky — a benign later account.updated (e.g. the owner changed a
    // bank detail on Stripe's own side) must never silently revive a connection the owner
    // deliberately ended. Only re-activating through a real new "Connect Stripe" flow should do that.
    if (account.status !== "disconnected") {
      const status = parseAccountEventObject(parsed.data?.object);
      account.chargesEnabled = status.chargesEnabled;
      account.payoutsEnabled = status.payoutsEnabled;
      account.requirementsDue = status.requirementsDue;
      account.disabledReason = status.disabledReason ?? undefined;
      account.status = resolveConnectAccountStatus(status);
      await account.save();
    }
  } else {
    account.status = "disconnected";
    await account.save();
  }

  await PaymentWebhookEvent.updateOne({ provider: "stripe", eventId }, { $set: { processedAt: new Date() } });
  res.status(200).json({ received: true });
}
