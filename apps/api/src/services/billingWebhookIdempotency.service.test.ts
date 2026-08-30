import { afterAll, afterEach, beforeAll, describe, expect, it, jest } from "@jest/globals";
import request from "supertest";
import { createApp } from "../app.js";
import { connectDB } from "../config/db.js";
import { Business } from "../models/Business.js";
import { BillingWebhookEvent } from "../models/BillingWebhookEvent.js";
import { Plan } from "../models/Plan.js";
import { Restaurant } from "../models/Restaurant.js";
import { Subscription } from "../models/Subscription.js";
import { User } from "../models/User.js";
import { getMockBillingProvider } from "../billing/index.js";
import { closeTestConnections, createTestBusiness, createTestPlan, createTestRestaurant, createTestUser } from "../test-utils/fixtures.js";

/**
 * Phase 40.1 — proves the real gap Phase 40's live Paddle verification found and the fix
 * (claimWebhookEventForProcessing in subscription.service.ts): a checkout-completion webhook must
 * be idempotent once genuinely processed, but still RETRYABLE if a transient failure (a real
 * provider.retrieveSubscription() call failing) interrupts it before it finishes — the old logic
 * treated ANY duplicate-key marker as "already handled," permanently losing an event whose only
 * real attempt failed partway through.
 *
 * jest.spyOn is used to force exactly one real, genuine transient failure from the actual
 * MockBillingProvider singleton the app itself uses — not a fake shortcut, the standard technique
 * for reproducing "the external call fails once" deterministically.
 */
const app = createApp();

const businessIds: string[] = [];
const restaurantIds: string[] = [];
const userIds: string[] = [];
let plan: Awaited<ReturnType<typeof createTestPlan>>;

beforeAll(async () => {
  await connectDB();
  plan = await createTestPlan({ pricing: [{ interval: "monthly", amountCents: 5900, currency: "USD", providerPriceId: "mock_price_1" }] });
});

afterEach(() => {
  jest.restoreAllMocks();
});

afterAll(async () => {
  await Promise.all([
    Subscription.deleteMany({ ownerType: "business", ownerId: { $in: businessIds } }),
    BillingWebhookEvent.deleteMany({}), // no businessId scoping possible — small, test-only collection
    User.deleteMany({ _id: { $in: userIds } }),
    Restaurant.deleteMany({ _id: { $in: restaurantIds } }),
    Business.deleteMany({ _id: { $in: businessIds } }),
    Plan.deleteOne({ _id: plan._id }),
  ]);
  await closeTestConnections();
});

function postWebhook(rawBody: Buffer, signatureHeader: string) {
  return request(app).post("/api/v1/webhooks/billing/mock").set("Content-Type", "application/json").set("x-billing-signature", signatureHeader).send(rawBody.toString("utf-8"));
}

async function newBusinessOwner() {
  const business = await createTestBusiness();
  const location = await createTestRestaurant({ businessId: business._id });
  const owner = await createTestUser("restaurant_owner", location._id, { businessId: business._id });
  businessIds.push(business.id as string);
  restaurantIds.push(location.id as string);
  userIds.push(owner.id as string);
  return { business, owner };
}

async function newCheckoutCompletionPayload() {
  const { business, owner } = await newBusinessOwner();
  const provider = getMockBillingProvider();
  const customer = await provider.createCustomer({ ownerType: "business", ownerId: business.id as string, email: owner.email!, name: owner.name! });
  const checkout = await provider.createCheckoutSession({
    providerCustomerId: customer.providerCustomerId,
    providerPriceId: "mock_price_1",
    metadata: { ownerType: "business", ownerId: business.id as string, planCode: plan.code, billingInterval: "monthly" },
    successUrl: "https://admin.example.com/billing-checkout-complete",
    cancelUrl: "https://admin.example.com/billing",
  });
  const token = (checkout.url as string).split("/mock-checkout/")[1];
  const payload = provider.completeCheckoutSession(token);
  return { business, provider, payload };
}

describe("Phase 40.1 — checkout-completion webhook: idempotent after success, retryable after transient failure", () => {
  it("Test 1 — successful first delivery: processed exactly once", async () => {
    const { business, provider, payload } = await newCheckoutCompletionPayload();
    const { rawBody, signatureHeader } = provider.signPayload(payload);

    const res = await postWebhook(rawBody, signatureHeader);
    expect(res.status).toBe(200);

    const stored = await Subscription.findOne({ ownerType: "business", ownerId: business._id });
    expect(stored!.status).toBe("active");

    const record = await BillingWebhookEvent.findOne({ provider: "mock", eventId: payload.eventId as string });
    expect(record).not.toBeNull();
    expect(record!.processedAt).toBeDefined();
    expect(record!.processingStartedAt).toBeUndefined();
  });

  it("Test 2 — successful duplicate delivery: safe no-op, no duplicate subscription or event record", async () => {
    const { business, provider, payload } = await newCheckoutCompletionPayload();
    const { rawBody, signatureHeader } = provider.signPayload(payload);

    const first = await postWebhook(rawBody, signatureHeader);
    const second = await postWebhook(rawBody, signatureHeader);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);

    const eventCount = await BillingWebhookEvent.countDocuments({ provider: "mock", eventId: payload.eventId as string });
    expect(eventCount).toBe(1);
    const subCount = await Subscription.countDocuments({ ownerType: "business", ownerId: business._id });
    expect(subCount).toBe(1);
  });

  it("Test 3 — a transient processing failure leaves the event genuinely retryable, never falsely marked processed", async () => {
    const { business, provider, payload } = await newCheckoutCompletionPayload();
    const { rawBody, signatureHeader } = provider.signPayload(payload);

    jest.spyOn(provider, "retrieveSubscription").mockRejectedValueOnce(new Error("transient failure — simulated"));

    const res = await postWebhook(rawBody, signatureHeader);
    expect(res.status).toBe(500);

    const record = await BillingWebhookEvent.findOne({ provider: "mock", eventId: payload.eventId as string });
    expect(record).not.toBeNull();
    expect(record!.processedAt).toBeUndefined(); // must NOT be falsely marked done
    expect(record!.processingStartedAt).toBeUndefined(); // cleared -> retryable
    expect(record!.processingError).toContain("transient failure");

    const stored = await Subscription.findOne({ ownerType: "business", ownerId: business._id });
    expect(stored).toBeNull(); // nothing was half-created
  });

  it("Test 4 — retrying the identical event after the transient failure clears now succeeds, with no duplicate side effects", async () => {
    const { business, provider, payload } = await newCheckoutCompletionPayload();
    const { rawBody, signatureHeader } = provider.signPayload(payload);

    jest.spyOn(provider, "retrieveSubscription").mockRejectedValueOnce(new Error("transient failure — simulated"));
    const failedAttempt = await postWebhook(rawBody, signatureHeader);
    expect(failedAttempt.status).toBe(500);

    // No override this time — the real implementation runs, exactly like a genuine provider retry
    // arriving after the transient issue has cleared.
    const retried = await postWebhook(rawBody, signatureHeader);
    expect(retried.status).toBe(200);

    const stored = await Subscription.findOne({ ownerType: "business", ownerId: business._id });
    expect(stored!.status).toBe("active");
    const subCount = await Subscription.countDocuments({ ownerType: "business", ownerId: business._id });
    expect(subCount).toBe(1); // exactly one — the failed attempt never created a partial one

    const record = await BillingWebhookEvent.findOne({ provider: "mock", eventId: payload.eventId as string });
    expect(record!.processedAt).toBeDefined();
    expect(record!.processingStartedAt).toBeUndefined();
    // The stale error from the failed attempt is cleared on eventual success, not left to confuse a
    // future reader into thinking a successfully-processed event actually failed.
    expect(record!.processingError).toBeUndefined();
  });

  it("Test 5 — invalid signature: rejected, no state mutation, no idempotency record created at all", async () => {
    const { business, provider, payload } = await newCheckoutCompletionPayload();
    const { rawBody } = provider.signPayload(payload);

    const res = await postWebhook(rawBody, "sha256=0000000000000000000000000000000000000000000000000000000000000000");
    expect(res.status).toBe(400);

    const record = await BillingWebhookEvent.findOne({ provider: "mock", eventId: payload.eventId as string });
    expect(record).toBeNull();
    const stored = await Subscription.findOne({ ownerType: "business", ownerId: business._id });
    expect(stored).toBeNull();
  });

  it("Test 6 — tampered payload under an otherwise-valid-looking signature: rejected, no state mutation", async () => {
    const { business, provider, payload } = await newCheckoutCompletionPayload();
    const { signatureHeader } = provider.signPayload(payload); // signs the ORIGINAL payload...
    const tamperedBody = Buffer.from(JSON.stringify({ ...payload, status: "trialing" }), "utf-8"); // ...but this body is different

    const res = await postWebhook(tamperedBody, signatureHeader);
    expect(res.status).toBe(400);

    const stored = await Subscription.findOne({ ownerType: "business", ownerId: business._id });
    expect(stored).toBeNull();
  });
});
