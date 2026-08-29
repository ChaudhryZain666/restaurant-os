// Phase 37 — the ONE centralized Stripe Connect webhook endpoint. Never prints
// env.STRIPE_CONNECT_WEBHOOK_SECRET; only ever uses it to compute a real signature locally.
import { afterAll, beforeAll, describe, expect, it } from "@jest/globals";
import { createHmac } from "node:crypto";
import request from "supertest";
import { createApp } from "../app.js";
import { connectDB } from "../config/db.js";
import { env } from "../config/env.js";
import { Business } from "../models/Business.js";
import { Restaurant } from "../models/Restaurant.js";
import { RestaurantPaymentAccount } from "../models/RestaurantPaymentAccount.js";
import { User } from "../models/User.js";
import { Payment } from "../models/Payment.js";
import { PaymentWebhookEvent } from "../models/PaymentWebhookEvent.js";
import { closeTestConnections, createTestBusiness, createTestOrder, createTestPayment, createTestRestaurant, createTestUser } from "../test-utils/fixtures.js";

const app = createApp();
const secret = env.STRIPE_CONNECT_WEBHOOK_SECRET!;

const businessIds: string[] = [];
const restaurantIds: string[] = [];
const userIds: string[] = [];
const accountIds: string[] = [];

beforeAll(async () => {
  await connectDB();
});

// Phase 38 fix — every test below uses a hardcoded evt_* id (needed since the assertions care about
// exact idempotency behavior for a SPECIFIC eventId). Without cleaning these up, a second run of
// this file collides with the unique {provider, eventId} index left over from the FIRST run,
// silently no-ops via the "duplicate event" branch, and every status-transition assertion fails —
// a real bug in this test's own hygiene, not in the application: reproduced by running this file
// twice in a row (even in full isolation, nothing else running) and seeing every previously-passing
// assertion fail on the second run.
const webhookEventIds = [
  "evt_unknown_1",
  "evt_activate_1",
  "evt_incomplete_1",
  "evt_deauth_1",
  "evt_sticky_1",
  "evt_dup_1",
  "evt_payment_1",
];

afterAll(async () => {
  await PaymentWebhookEvent.deleteMany({ provider: "stripe", eventId: { $in: webhookEventIds } });
  await Payment.deleteMany({ restaurantId: { $in: restaurantIds } });
  await RestaurantPaymentAccount.deleteMany({ _id: { $in: accountIds } });
  await Restaurant.deleteMany({ _id: { $in: restaurantIds } });
  await Business.deleteMany({ _id: { $in: businessIds } });
  await User.deleteMany({ _id: { $in: userIds } });
  await closeTestConnections();
});

function sign(payload: object) {
  const t = Math.floor(Date.now() / 1000);
  const rawBody = Buffer.from(JSON.stringify(payload), "utf-8");
  const v1 = createHmac("sha256", secret).update(`${t}.${rawBody.toString("utf-8")}`).digest("hex");
  return { rawBody, signatureHeader: `t=${t},v1=${v1}` };
}

async function connectedAccount(connectedAccountId: string, overrides: Record<string, unknown> = {}) {
  const business = await createTestBusiness();
  const restaurant = await createTestRestaurant({ businessId: business._id });
  const owner = await createTestUser("restaurant_owner", restaurant._id, { businessId: business._id });
  businessIds.push(business.id);
  restaurantIds.push(restaurant.id);
  userIds.push(owner.id as string);

  const account = await RestaurantPaymentAccount.create({
    restaurantId: restaurant._id,
    businessId: business._id,
    provider: "stripe",
    connectionMode: "platform_connect",
    status: "pending_verification",
    connectedAccountId,
    connectedByUserId: owner._id,
    ...overrides,
  });
  accountIds.push(account.id as string);
  return { account, restaurant, owner };
}

async function post(payload: object) {
  const { rawBody, signatureHeader } = sign(payload);
  return request(app)
    .post("/api/v1/webhooks/payments/stripe-connect")
    .set("Content-Type", "application/json")
    .set("Stripe-Signature", signatureHeader)
    .send(rawBody.toString("utf-8"));
}

describe("POST /webhooks/payments/stripe-connect", () => {
  it("rejects an invalid signature", async () => {
    const res = await request(app)
      .post("/api/v1/webhooks/payments/stripe-connect")
      .set("Content-Type", "application/json")
      .set("Stripe-Signature", "t=1,v1=00")
      .send(JSON.stringify({ id: "evt_x", type: "account.updated", account: "acct_x", data: { object: {} } }));
    expect(res.status).toBe(400);
  });

  it("rejects a malformed (but validly signed) event missing id/type/account", async () => {
    const res = await post({ data: { object: {} } });
    expect(res.status).toBe(400);
  });

  it("acknowledges (200) an event for an account this platform doesn't track, without erroring", async () => {
    const res = await post({
      id: "evt_unknown_1",
      type: "account.updated",
      account: "acct_never_connected_here",
      data: { object: { charges_enabled: true } },
    });
    expect(res.status).toBe(200);
  });

  it("account.updated with charges_enabled:true activates the account — real capability, not the redirect", async () => {
    const { account } = await connectedAccount("acct_connect_active_1");
    const res = await post({
      id: "evt_activate_1",
      type: "account.updated",
      account: "acct_connect_active_1",
      data: { object: { charges_enabled: true, payouts_enabled: true, requirements: { currently_due: [] } } },
    });
    expect(res.status).toBe(200);
    const stored = await RestaurantPaymentAccount.findById(account._id);
    expect(stored!.status).toBe("active");
    expect(stored!.chargesEnabled).toBe(true);
  });

  it("account.updated with charges_enabled:false and pending requirements sets action_required, not active", async () => {
    const { account } = await connectedAccount("acct_connect_incomplete_1");
    const res = await post({
      id: "evt_incomplete_1",
      type: "account.updated",
      account: "acct_connect_incomplete_1",
      data: { object: { charges_enabled: false, requirements: { currently_due: ["business_profile.url"] } } },
    });
    expect(res.status).toBe(200);
    const stored = await RestaurantPaymentAccount.findById(account._id);
    expect(stored!.status).toBe("action_required");
  });

  it("account.application.deauthorized disconnects the account", async () => {
    const { account } = await connectedAccount("acct_connect_deauth_1", { status: "active", chargesEnabled: true });
    const res = await post({
      id: "evt_deauth_1",
      type: "account.application.deauthorized",
      account: "acct_connect_deauth_1",
      data: { object: {} },
    });
    expect(res.status).toBe(200);
    const stored = await RestaurantPaymentAccount.findById(account._id);
    expect(stored!.status).toBe("disconnected");
  });

  it("a disconnected account stays disconnected even if a later account.updated reports charges_enabled:true", async () => {
    const { account } = await connectedAccount("acct_connect_sticky_1", { status: "disconnected" });
    const res = await post({
      id: "evt_sticky_1",
      type: "account.updated",
      account: "acct_connect_sticky_1",
      data: { object: { charges_enabled: true } },
    });
    expect(res.status).toBe(200);
    const stored = await RestaurantPaymentAccount.findById(account._id);
    expect(stored!.status).toBe("disconnected");
  });

  it("duplicate account.updated events are idempotent — only processed once", async () => {
    const { account } = await connectedAccount("acct_connect_dup_1");
    await post({
      id: "evt_dup_1",
      type: "account.updated",
      account: "acct_connect_dup_1",
      data: { object: { charges_enabled: true } },
    });
    const secondRes = await post({
      id: "evt_dup_1",
      type: "account.updated",
      account: "acct_connect_dup_1",
      data: { object: { charges_enabled: false } }, // different payload, same eventId — must be ignored
    });
    expect(secondRes.status).toBe(200);
    const stored = await RestaurantPaymentAccount.findById(account._id);
    // If the duplicate had been re-processed, status would have flipped back to action_required.
    expect(stored!.status).toBe("active");
    const eventCount = await PaymentWebhookEvent.countDocuments({ provider: "stripe", eventId: "evt_dup_1" });
    expect(eventCount).toBe(1);
  });

  it("checkout.session.completed converges a real Payment from pending to paid, and sets firstWebhookReceivedAt", async () => {
    const { account, restaurant, owner } = await connectedAccount("acct_connect_payment_1", { status: "active", chargesEnabled: true });
    const order = await createTestOrder(restaurant._id, owner._id, { total: 20, subtotal: 20 });
    const payment = await createTestPayment(restaurant._id, order._id, owner._id, {
      provider: "stripe",
      providerRef: "cs_connect_test_1",
      restaurantPaymentAccountId: account._id,
      amount: 20,
    });

    const res = await post({
      id: "evt_payment_1",
      type: "checkout.session.completed",
      account: "acct_connect_payment_1",
      data: { object: { id: "cs_connect_test_1", status: "complete", payment_status: "paid" } },
    });
    expect(res.status).toBe(200);

    const storedPayment = await Payment.findById(payment._id);
    expect(storedPayment!.status).toBe("paid");
    const storedAccount = await RestaurantPaymentAccount.findById(account._id);
    expect(storedAccount!.firstWebhookReceivedAt).toBeTruthy();
  });
});
