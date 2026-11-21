import bcrypt from "bcryptjs";
import mongoose, { type HydratedDocument } from "mongoose";
import type { CreateBusinessSelfServeInput } from "@restaurant/validation";
import { CheckoutIntent, type CheckoutIntentDoc } from "../models/CheckoutIntent.js";
import { BillingWebhookEvent } from "../models/BillingWebhookEvent.js";
import { Plan } from "../models/Plan.js";
import { Subscription } from "../models/Subscription.js";
import { User, type UserDoc } from "../models/User.js";
import { getBillingProvider } from "../billing/index.js";
import type { ProviderBillingWebhookEvent } from "../billing/BillingProvider.js";
import { getEmailService } from "../email/index.js";
import { purchaseSetupEmail } from "../email/templates.js";
import { env } from "../config/env.js";
import { logger } from "../common/logger.js";
import { ApiError } from "../utils/ApiError.js";
import { ErrorCode } from "../common/errorCodes.js";
import { generateSecureToken, hashToken } from "./secureToken.service.js";
import { assertRestaurantSlugAvailable, provisionOwnerBusiness } from "./ownerBusiness.service.js";
import { DuplicateLiveSubscriptionError, linkProviderSubscription, BILLING_ALERT_DUPLICATE_PURCHASE } from "./subscription.service.js";
import { LIVE_STATUSES } from "./subscriptionResolution.service.js";

/**
 * Launch, 2026-11-21 — the PUBLIC pay-now checkout (garnishtable.com/checkout): a visitor picks a plan
 * and pays straight away — no account, no login, no trial — and sets up their account afterwards.
 * Runs on the marketing domain because that is the domain Paddle has approved for checkout.
 *
 * Access is granted only from the provider's verified webhook: the browser's "checkout completed"
 * callback never marks anything paid. See models/CheckoutIntent.ts for the lifecycle.
 */

/** How long an unpaid checkout intent is kept (the TTL index then removes it). A checkout normally
 *  completes in minutes; this leaves room for a slow webhook. */
const OPEN_INTENT_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/** A claim that crashed mid-way releases its lock after this long. */
const CLAIM_LOCK_MS = 2 * 60 * 1000;
const PADDLE_PRICE_ID = /^pri_[a-z0-9]+$/;

export const BILLING_ALERT_GUEST_PURCHASE_UNLINKED = "billing_guest_purchase_unlinked";

function isOwnerSellable(plan: { isActive?: boolean | null; isPubliclyListed?: boolean | null; type?: string | null }): boolean {
  return Boolean(plan.isActive) && plan.isPubliclyListed !== false && plan.type === "OWNER";
}

// ─── Start ─────────────────────────────────────────────────────────────────────────────────────────

export async function startGuestCheckout(input: { planCode: string; billingInterval: "monthly" | "yearly" }) {
  const provider = getBillingProvider();
  // Only a real overlay provider can run this page; the mock provider has no browser checkout here.
  if (provider.name !== "paddle") {
    throw ApiError.serviceUnavailable("Paying online isn't open yet. You can start a free trial instead.");
  }
  if (!env.BILLING_CHECKOUT_ENABLED) {
    throw ApiError.serviceUnavailable("Paid plan checkout is paused right now. You can start a free trial instead.");
  }
  const plan = await Plan.findOne({ code: input.planCode });
  if (!plan || !isOwnerSellable(plan)) throw ApiError.notFound("That plan isn't available.");
  const pricing = plan.pricing.find((p) => p.interval === input.billingInterval);
  if (!pricing || pricing.amountCents == null || !pricing.currency) {
    throw ApiError.badRequest(`${plan.name} isn't sold ${input.billingInterval === "yearly" ? "annually" : "monthly"}.`);
  }
  if (!pricing.providerPriceId || !PADDLE_PRICE_ID.test(pricing.providerPriceId)) {
    logger.error("guest checkout refused — the plan's price id is not a Paddle price id (run setPaddlePriceIds)", {
      planCode: plan.code,
      billingInterval: input.billingInterval,
    });
    throw ApiError.serviceUnavailable("Paying online isn't available yet. You can start a free trial instead.");
  }

  const { raw, hash } = generateSecureToken();
  const intent = await CheckoutIntent.create({
    status: "open",
    provider: provider.name,
    planCode: plan.code,
    billingInterval: input.billingInterval,
    browserTokenHash: hash,
    expiresAt: new Date(Date.now() + OPEN_INTENT_TTL_MS),
  });
  const customData = { checkoutIntentId: intent.id as string };
  const session = await provider.createCheckoutSession({
    providerCustomerId: "",
    providerPriceId: pricing.providerPriceId,
    metadata: customData,
    successUrl: "",
    cancelUrl: "",
  });

  return {
    token: raw,
    plan: { code: plan.code, name: plan.name, billingInterval: input.billingInterval, amountCents: pricing.amountCents, currency: pricing.currency },
    checkout: {
      clientToken: session.clientToken,
      environment: session.environment,
      providerPriceId: pricing.providerPriceId,
      customData,
    },
  };
}

/** What a page that only RESUMES a Paddle-created checkout (a payment link carrying `_ptxn`) needs to
 *  initialise Paddle.js; null when pay-now checkout isn't running. */
export function getGuestCheckoutConfig(): { clientToken: string; environment: "sandbox" | "production" } | null {
  const provider = getBillingProvider();
  if (provider.name !== "paddle") return null;
  const clientToken = env.PADDLE_CLIENT_TOKEN;
  if (!clientToken) return null;
  return { clientToken, environment: env.PADDLE_ENV === "production" ? "production" : "sandbox" };
}

// ─── Webhook: payment verified ─────────────────────────────────────────────────────────────────────

async function finishWebhookEvent(providerName: string, eventId: string, processingError?: string) {
  await BillingWebhookEvent.updateOne(
    { provider: providerName, eventId },
    processingError
      ? { $set: { processedAt: new Date(), processingError }, $unset: { processingStartedAt: "" } }
      : { $set: { processedAt: new Date() }, $unset: { processingStartedAt: "", processingError: "" } }
  );
}

/**
 * subscription.created for a pay-now checkout: the payment is real. Records it on the intent, then
 * emails the customer a one-time set-up link. Errors that can't fix themselves (an unknown intent or
 * price) are recorded and alerted on — a customer has paid for a subscription no account uses yet.
 */
export async function recordGuestCheckoutPaid(providerName: string, event: ProviderBillingWebhookEvent): Promise<void> {
  const { intentId, providerCustomerId } = event.guestCheckout!;
  const alert = (reason: string, extra: Record<string, unknown> = {}) =>
    logger.error(`paid pay-now checkout not linked — ${reason}`, {
      alert: BILLING_ALERT_GUEST_PURCHASE_UNLINKED,
      provider: providerName,
      eventId: event.eventId,
      providerSubscriptionId: event.providerSubscriptionId,
      intentId,
      ...extra,
    });

  const intent = mongoose.isValidObjectId(intentId) ? await CheckoutIntent.findById(intentId) : null;
  if (!intent || intent.provider !== providerName) {
    alert("no such checkout intent");
    await finishWebhookEvent(providerName, event.eventId, "Rejected: unknown checkout intent");
    return;
  }
  if (intent.status !== "open") {
    if (intent.providerSubscriptionId === event.providerSubscriptionId) {
      await finishWebhookEvent(providerName, event.eventId, "Duplicate: checkout intent already paid");
      return;
    }
    logger.error("second payment for one pay-now checkout — the new provider subscription is NOT linked", {
      alert: BILLING_ALERT_DUPLICATE_PURCHASE,
      provider: providerName,
      intentId,
      existingProviderSubscriptionId: intent.providerSubscriptionId,
      providerSubscriptionId: event.providerSubscriptionId,
    });
    await finishWebhookEvent(providerName, event.eventId, "Duplicate purchase: checkout intent already paid by another subscription");
    return;
  }

  // The plan comes from what the provider actually sold, never from the browser's custom data.
  const plan = event.providerPriceId ? await Plan.findOne({ "pricing.providerPriceId": event.providerPriceId }) : null;
  const pricing = plan?.pricing.find((p) => p.providerPriceId === event.providerPriceId);
  if (!plan || !pricing) {
    alert("its price maps to no plan", { providerPriceId: event.providerPriceId });
    await finishWebhookEvent(providerName, event.eventId, `Rejected: unknown price ${event.providerPriceId ?? "(none)"}`);
    return;
  }

  // A provider failure here throws: the event stays retryable and the provider redelivers it.
  const customer = await getBillingProvider().retrieveCustomer(providerCustomerId);
  const email = customer.email?.trim().toLowerCase();

  const { raw, hash } = generateSecureToken();
  const paid = await CheckoutIntent.findOneAndUpdate(
    { _id: intent._id, status: "open" },
    {
      $set: {
        status: "paid",
        email,
        providerCustomerId,
        providerSubscriptionId: event.providerSubscriptionId,
        paidPlanCode: plan.code,
        paidBillingInterval: pricing.interval,
        paidEventId: event.eventId,
        paidAt: new Date(),
        lastProviderEventAt: event.occurredAt,
        emailTokenHash: hash,
      },
      $unset: { expiresAt: "" },
    },
    { new: true }
  );
  if (!paid) {
    // A concurrent delivery of the same event won the update; it sends the email.
    await finishWebhookEvent(providerName, event.eventId, "Duplicate: checkout intent already paid");
    return;
  }
  logger.info("pay-now checkout paid — waiting for the buyer to set up their account", {
    intentId,
    planCode: plan.code,
    billingInterval: pricing.interval,
    providerSubscriptionId: event.providerSubscriptionId,
  });

  if (email) {
    // A fragment, not a query: it is never sent to a server, so the token stays out of access logs.
    const setupUrl = `${env.ADMIN_ORIGIN}/claim#token=${raw}`;
    try {
      await getEmailService().send(purchaseSetupEmail(email, setupUrl, plan.name));
    } catch (err) {
      // The checkout page still shows its own set-up link; support can resend from the logs.
      logger.error("failed to send pay-now account set-up email", { intentId, error: (err as Error).message });
    }
  } else {
    alert("the provider returned no customer email (the set-up link is only on the checkout page)");
  }
  await finishWebhookEvent(providerName, event.eventId);
}

/**
 * Any other provider event for a subscription that has no Subscription document yet: if it belongs
 * to a paid, not-yet-claimed pay-now purchase, it is acknowledged here (returns true) — the claim
 * reads the subscription's current state from the provider. While a claim is linking it right now,
 * the provider is asked to retry so the event lands on the new Subscription.
 */
export async function acknowledgeUnclaimedPurchaseEvent(providerName: string, event: ProviderBillingWebhookEvent): Promise<boolean> {
  if (!event.providerSubscriptionId) return false;
  const intent = await CheckoutIntent.findOne({ provider: providerName, providerSubscriptionId: event.providerSubscriptionId });
  if (!intent) return false;
  if (intent.claimingAt || intent.status === "claimed") {
    throw ApiError.serviceUnavailable("Subscription is being linked to its account — retry later.");
  }
  if (event.occurredAt) {
    await CheckoutIntent.updateOne(
      { _id: intent._id, $or: [{ lastProviderEventAt: { $exists: false } }, { lastProviderEventAt: { $lt: event.occurredAt } }] },
      { $set: { lastProviderEventAt: event.occurredAt } }
    );
  }
  return true;
}

// ─── Status ────────────────────────────────────────────────────────────────────────────────────────

async function findByToken(token: string): Promise<{ intent: HydratedDocument<CheckoutIntentDoc>; viaEmail: boolean } | null> {
  const hash = hashToken(token);
  const intent = await CheckoutIntent.findOne({ $or: [{ browserTokenHash: hash }, { emailTokenHash: hash }] });
  if (!intent) return null;
  return { intent, viaEmail: intent.emailTokenHash === hash };
}

export async function getGuestCheckoutStatus(token: string) {
  const found = await findByToken(token);
  if (!found) throw ApiError.notFound("This set-up link is invalid or has expired.");
  const { intent } = found;
  const planCode = intent.paidPlanCode ?? intent.planCode;
  const plan = await Plan.findOne({ code: planCode }).select("code name");
  return {
    status: intent.status as "open" | "paid" | "claimed",
    plan: { code: planCode, name: plan?.name ?? planCode },
    billingInterval: (intent.paidBillingInterval ?? intent.billingInterval) as "monthly" | "yearly",
    email: intent.status === "open" ? null : (intent.email ?? null),
    emailHasAccount: intent.status === "paid" && intent.email ? Boolean(await User.exists({ email: intent.email })) : false,
  };
}

// ─── Claim ─────────────────────────────────────────────────────────────────────────────────────────

async function lockPaidIntent(token: string) {
  const found = await findByToken(token);
  if (!found) throw ApiError.notFound("This set-up link is invalid or has expired.");
  const { intent, viaEmail } = found;
  if (intent.status === "open") throw ApiError.conflict("We're still confirming your payment. This page updates as soon as it's confirmed.");
  if (intent.status === "claimed") throw ApiError.conflict("This purchase is already set up. Sign in to your account.");
  const locked = await CheckoutIntent.findOneAndUpdate(
    {
      _id: intent._id,
      status: "paid",
      $or: [{ claimingAt: { $exists: false } }, { claimingAt: { $lt: new Date(Date.now() - CLAIM_LOCK_MS) } }],
    },
    { $set: { claimingAt: new Date() } },
    { new: true }
  );
  if (!locked) throw ApiError.conflict("Your account is already being set up. Wait a moment and refresh.");
  return { intent: locked, viaEmail };
}

const releaseLock = (intent: HydratedDocument<CheckoutIntentDoc>) => CheckoutIntent.updateOne({ _id: intent._id, status: "paid" }, { $unset: { claimingAt: "" } });

/** Refuses a purchase the provider no longer bills (cancelled before the account was set up). */
async function assertStillBilled(intent: HydratedDocument<CheckoutIntentDoc>) {
  const snapshot = await getBillingProvider().retrieveSubscription(intent.providerSubscriptionId!);
  if (snapshot.status === "cancelled") {
    throw ApiError.conflict("This purchase was cancelled before the account was set up. Contact us if that's unexpected.");
  }
}

async function linkIntentToBusiness(intent: HydratedDocument<CheckoutIntentDoc>, businessId: string, userId: mongoose.Types.ObjectId) {
  const plan = await Plan.findOne({ code: intent.paidPlanCode });
  if (!plan) throw ApiError.serviceUnavailable("This plan is temporarily unavailable. Try again shortly.");
  const subscription = await linkProviderSubscription({
    providerName: intent.provider,
    ownerType: "business",
    ownerId: businessId,
    plan,
    billingInterval: intent.paidBillingInterval as "monthly" | "yearly",
    providerCustomerId: intent.providerCustomerId!,
    providerSubscriptionId: intent.providerSubscriptionId!,
    occurredAt: intent.lastProviderEventAt ?? undefined,
    reference: intent.paidEventId!,
    historyMetadata: { viaPayNowCheckout: true, checkoutIntentId: intent.id },
  });
  await CheckoutIntent.updateOne(
    { _id: intent._id },
    { $set: { status: "claimed", claimedAt: new Date(), claimedByUserId: userId, subscriptionId: subscription._id }, $unset: { claimingAt: "" } }
  );
  const provider = getBillingProvider();
  if (provider.setCustomerOwner && intent.providerCustomerId) {
    // Best effort: only lets a later in-app checkout reuse this customer; nothing depends on it now.
    provider.setCustomerOwner(intent.providerCustomerId, "business", businessId).catch((err: Error) =>
      logger.warn("could not tag the provider customer with its new owner", { intentId: intent.id, error: err.message })
    );
  }
  logger.info("pay-now purchase set up", { intentId: intent.id, businessId, subscriptionId: subscription.id });
  return subscription;
}

/**
 * A NEW account for a paid purchase: the user (email from checkout), their restaurant, and the
 * subscription. The emailed link proves the address; the checkout-page link does not, so that path
 * leaves the email unverified (the usual verification email follows).
 */
export async function claimGuestCheckout(input: {
  token: string;
  name: string;
  password: string;
  restaurant: CreateBusinessSelfServeInput;
  legalVersion: string;
}): Promise<{ user: HydratedDocument<UserDoc>; viaEmail: boolean }> {
  const { intent, viaEmail } = await lockPaidIntent(input.token);
  let user: HydratedDocument<UserDoc> | null = null;
  try {
    if (!intent.email) throw ApiError.conflict("We couldn't read the email from your checkout. Contact us to finish setting up.");
    if (await User.exists({ email: intent.email })) {
      throw new ApiError(409, ErrorCode.CONFLICT, "This email already has a GarnishTable account. Sign in, then open this link again.", {
        reason: "email_has_account",
      });
    }
    await assertRestaurantSlugAvailable(input.restaurant.slug);
    await assertStillBilled(intent);

    try {
      user = await User.create({
        name: input.name,
        email: intent.email,
        passwordHash: await bcrypt.hash(input.password, 12),
        role: "restaurant_owner",
        legalAcceptedAt: new Date(),
        legalVersion: input.legalVersion,
        ...(viaEmail ? { emailVerifiedAt: new Date() } : {}),
      });
    } catch (err) {
      if ((err as { code?: number }).code === 11000) {
        throw new ApiError(409, ErrorCode.CONFLICT, "This email already has a GarnishTable account. Sign in, then open this link again.", {
          reason: "email_has_account",
        });
      }
      throw err;
    }
    const { business } = await provisionOwnerBusiness(user._id, input.restaurant);
    await linkIntentToBusiness(intent, business.id as string, user._id);
    return { user: (await User.findById(user._id))!, viaEmail };
  } catch (err) {
    await releaseLock(intent);
    if (user) {
      // The account exists now; a retry goes through the signed-in path (it reuses the restaurant).
      logger.error("pay-now account created but the purchase was not linked yet", { intentId: intent.id, userId: user.id, error: (err as Error).message });
    }
    throw err;
  }
}

/** Attaches a paid purchase to the signed-in owner (their email already had an account), creating
 *  their restaurant first if they have none. */
export async function claimGuestCheckoutForUser(input: { token: string; userId: string; restaurant?: CreateBusinessSelfServeInput; termsAccepted?: boolean; legalVersion: string }) {
  const { intent } = await lockPaidIntent(input.token);
  try {
    const user = await User.findById(input.userId);
    if (!user) throw ApiError.unauthorized("User no longer exists");
    if (user.businessId) {
      if (user.role !== "restaurant_owner") throw ApiError.forbidden("Only the restaurant's owner can add a plan to it.");
    } else if (user.role !== "customer" && user.role !== "restaurant_owner") {
      throw ApiError.forbidden("This account can't own a restaurant. Sign in with the restaurant owner's account.");
    }
    if (user.businessId) {
      const live = await Subscription.exists({ ownerType: "business", ownerId: user.businessId, status: { $in: LIVE_STATUSES }, providerSubscriptionId: { $exists: true } });
      if (live) throw ApiError.conflict("This restaurant already has a paid plan. Contact us so we can sort out the second payment.");
    } else if (!input.restaurant) {
      throw new ApiError(400, ErrorCode.VALIDATION_ERROR, "Name your restaurant to finish setting up.", { reason: "restaurant_required" });
    } else {
      if (!user.legalAcceptedAt && input.termsAccepted !== true) {
        throw new ApiError(400, ErrorCode.VALIDATION_ERROR, "Accept the Terms of Service and Privacy Policy to continue.", { reason: "terms_required" });
      }
      await assertRestaurantSlugAvailable(input.restaurant.slug);
    }
    await assertStillBilled(intent);

    let businessId = user.businessId?.toString();
    if (!businessId) {
      if (!user.legalAcceptedAt) {
        user.legalAcceptedAt = new Date();
        user.legalVersion = input.legalVersion;
        await user.save();
      }
      businessId = (await provisionOwnerBusiness(user._id, input.restaurant!)).business.id as string;
    }
    try {
      await linkIntentToBusiness(intent, businessId, user._id);
    } catch (err) {
      if (err instanceof DuplicateLiveSubscriptionError) throw ApiError.conflict("This restaurant already has an active plan. Contact us so we can sort out the second payment.");
      throw err;
    }
    return (await User.findById(user._id))!;
  } catch (err) {
    await releaseLock(intent);
    throw err;
  }
}

/** For platform-admin visibility / alerting: paid purchases nobody has set up yet. */
export async function listUnclaimedPurchases(olderThan: Date) {
  return CheckoutIntent.find({ status: "paid", paidAt: { $lt: olderThan } }).select("planCode paidPlanCode email paidAt providerSubscriptionId").lean();
}

