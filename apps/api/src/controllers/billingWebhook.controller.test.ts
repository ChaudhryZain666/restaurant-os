import { afterAll, beforeAll, describe, expect, it } from "@jest/globals";
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
import { closeTestConnections, createTestBusiness, createTestPlan, createTestRestaurant, createTestUser, tokenFor } from "../test-utils/fixtures.js";

const app = createApp();

let plan: Awaited<ReturnType<typeof createTestPlan>>;

// Every test creates its own business via subscribedBusiness() — tracked here so afterAll can
// clean up precisely (this test file runs against the same shared dev DB as every other Jest
// worker, so a wildcard deleteMany({}) would destroy other tests'/other workers' fixtures).
const businessIds: string[] = [];
const restaurantIds: string[] = [];
const userIds: string[] = [];

async function subscribedBusiness() {
  const biz = await createTestBusiness();
  const loc = await createTestRestaurant({ businessId: biz._id });
  const owner = await createTestUser("restaurant_owner", loc._id, { businessId: biz._id });
  const token = tokenFor(owner);
  businessIds.push(biz.id as string);
  restaurantIds.push(loc.id as string);
  userIds.push(owner.id as string);

  const createRes = await request(app)
    .post(`/api/v1/businesses/${biz.id}/subscription`)
    .set("Authorization", `Bearer ${token}`)
    .send({ planCode: plan.code, billingInterval: "monthly" });
  const subscription = await Subscription.findById(createRes.body.data.subscription.id);

  return { business: biz, location: loc, owner, token, subscription: subscription! };
}

function postWebhook(rawBody: Buffer, signatureHeader: string) {
  return request(app)
    .post("/api/v1/webhooks/billing/mock")
    .set("Content-Type", "application/json")
    .set("x-billing-signature", signatureHeader)
    .send(rawBody.toString("utf-8"));
}

beforeAll(async () => {
  await connectDB();
  plan = await createTestPlan({ code: `webhook-test-${Date.now()}` });
});

afterAll(async () => {
  await Promise.all([
    Subscription.deleteMany({ ownerType: "business", ownerId: { $in: businessIds } }),
    BillingWebhookEvent.deleteMany({}), // no businessId/restaurantId to scope by — small, test-only collection
    User.deleteMany({ _id: { $in: userIds } }),
    Restaurant.deleteMany({ _id: { $in: restaurantIds } }),
    Business.deleteMany({ _id: { $in: businessIds } }),
    Plan.deleteOne({ _id: plan._id }),
  ]);
  await closeTestConnections();
});

describe("POST /webhooks/billing/:provider — signature verification", () => {
  it("accepts a validly-signed event and applies the subscription transition (trialing -> active)", async () => {
    const { subscription } = await subscribedBusiness();
    expect(subscription.status).toBe("trialing");

    const provider = getMockBillingProvider();
    const payload = provider.simulateEvent(subscription.providerSubscriptionId!, "active");
    const { rawBody, signatureHeader } = provider.signPayload(payload);

    const res = await postWebhook(rawBody, signatureHeader);
    expect(res.status).toBe(200);

    const stored = await Subscription.findById(subscription._id);
    expect(stored!.status).toBe("active");
  });

  it("rejects a request with no signature header", async () => {
    const { subscription } = await subscribedBusiness();
    const provider = getMockBillingProvider();
    const payload = provider.simulateEvent(subscription.providerSubscriptionId!, "active");
    const { rawBody } = provider.signPayload(payload);

    const res = await request(app).post("/api/v1/webhooks/billing/mock").set("Content-Type", "application/json").send(rawBody.toString("utf-8"));
    expect(res.status).toBe(400);
    const stored = await Subscription.findById(subscription._id);
    expect(stored!.status).toBe("trialing");
  });

  it("rejects a tampered signature", async () => {
    const { subscription } = await subscribedBusiness();
    const provider = getMockBillingProvider();
    const payload = provider.simulateEvent(subscription.providerSubscriptionId!, "active");
    const { rawBody } = provider.signPayload(payload);

    const res = await postWebhook(rawBody, "sha256=0000000000000000000000000000000000000000000000000000000000000000");
    expect(res.status).toBe(400);
    const stored = await Subscription.findById(subscription._id);
    expect(stored!.status).toBe("trialing");
  });

  it("rejects a webhook posted to the wrong provider path", async () => {
    const { subscription } = await subscribedBusiness();
    const provider = getMockBillingProvider();
    const payload = provider.simulateEvent(subscription.providerSubscriptionId!, "active");
    const { rawBody, signatureHeader } = provider.signPayload(payload);

    const res = await request(app)
      .post("/api/v1/webhooks/billing/stripe")
      .set("Content-Type", "application/json")
      .set("x-billing-signature", signatureHeader)
      .send(rawBody.toString("utf-8"));
    expect(res.status).toBe(400);
  });
});

describe("webhook idempotency and duplicate protection", () => {
  it("processing the same event twice does not double-apply or create a second event record", async () => {
    const { subscription } = await subscribedBusiness();
    const provider = getMockBillingProvider();
    const payload = provider.simulateEvent(subscription.providerSubscriptionId!, "active");
    const { rawBody, signatureHeader } = provider.signPayload(payload);

    const first = await postWebhook(rawBody, signatureHeader);
    const second = await postWebhook(rawBody, signatureHeader);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);

    const eventCount = await BillingWebhookEvent.countDocuments({ provider: "mock", eventId: payload.eventId as string });
    expect(eventCount).toBe(1);

    const stored = await Subscription.findById(subscription._id);
    expect(stored!.status).toBe("active");
  });

  it("under true concurrency, two simultaneous deliveries of the same event apply the transition exactly once", async () => {
    const { subscription } = await subscribedBusiness();
    const provider = getMockBillingProvider();
    const payload = provider.simulateEvent(subscription.providerSubscriptionId!, "active");
    const { rawBody, signatureHeader } = provider.signPayload(payload);

    const [a, b] = await Promise.all([postWebhook(rawBody, signatureHeader), postWebhook(rawBody, signatureHeader)]);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);

    const eventCount = await BillingWebhookEvent.countDocuments({ provider: "mock", eventId: payload.eventId as string });
    expect(eventCount).toBe(1);
    const stored = await Subscription.findById(subscription._id);
    expect(stored!.status).toBe("active");
  });

  it("an event for an unknown provider subscription reference is acknowledged but changes nothing", async () => {
    const provider = getMockBillingProvider();
    const { rawBody, signatureHeader } = provider.signPayload({
      eventId: `mock_evt_unknown_${Date.now()}`,
      eventType: "subscription.activated",
      providerSubscriptionId: `mock_sub_never_existed_${Date.now()}`,
      status: "active",
    });
    const res = await postWebhook(rawBody, signatureHeader);
    expect(res.status).toBe(200);
  });

  it("an invalid transition (e.g. reactivating an already-terminal cancelled subscription) is ignored, not reapplied", async () => {
    const { subscription } = await subscribedBusiness();
    const provider = getMockBillingProvider();

    // Drive it to a terminal state first via the real owner-facing cancel action (immediate, not
    // scheduled) isn't exposed over HTTP this phase — simulate the provider reporting a hard
    // cancellation directly instead, which the state machine accepts from "trialing".
    const cancelPayload = provider.simulateEvent(subscription.providerSubscriptionId!, "cancelled");
    const cancelSigned = provider.signPayload(cancelPayload);
    await postWebhook(cancelSigned.rawBody, cancelSigned.signatureHeader);
    const afterCancel = await Subscription.findById(subscription._id);
    expect(afterCancel!.status).toBe("expired"); // trialing + provider "cancelled" => our "expired"

    const reactivatePayload = provider.simulateEvent(subscription.providerSubscriptionId!, "active");
    const reactivateSigned = provider.signPayload(reactivatePayload);
    const res = await postWebhook(reactivateSigned.rawBody, reactivateSigned.signatureHeader);

    expect(res.status).toBe(200); // acknowledged, not an error
    const stored = await Subscription.findById(subscription._id);
    expect(stored!.status).toBe("expired"); // unchanged — expired is terminal
  });
});
