import { afterAll, beforeAll, describe, expect, it } from "@jest/globals";
import { createHmac } from "node:crypto";
import request from "supertest";
import { createApp } from "../app.js";
import { connectDB } from "../config/db.js";
import { Business } from "../models/Business.js";
import { Restaurant } from "../models/Restaurant.js";
import { RestaurantPaymentAccount } from "../models/RestaurantPaymentAccount.js";
import { User } from "../models/User.js";
import { encryptCredentials } from "../utils/credentialEncryption.js";
import { closeTestConnections, createTestBusiness, createTestRestaurant, createTestUser } from "../test-utils/fixtures.js";

const app = createApp();

const businessIds: string[] = [];
const restaurantIds: string[] = [];
const userIds: string[] = [];
const accountIds: string[] = [];

beforeAll(async () => {
  await connectDB();
});

afterAll(async () => {
  await RestaurantPaymentAccount.deleteMany({ _id: { $in: accountIds } });
  await Restaurant.deleteMany({ _id: { $in: restaurantIds } });
  await Business.deleteMany({ _id: { $in: businessIds } });
  await User.deleteMany({ _id: { $in: userIds } });
  await closeTestConnections();
});

async function connectedStripeAccount(webhookSecret: string) {
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
    status: "active",
    encryptedCredentials: encryptCredentials({ secretKey: "sk_test_debug", webhookSecret }),
    credentialFingerprint: "sk_test_····dbug",
    connectedByUserId: owner._id,
  });
  accountIds.push(account.id as string);
  return account;
}

function signStripe(payload: object, secret: string) {
  const t = Math.floor(Date.now() / 1000);
  const rawBody = Buffer.from(JSON.stringify(payload), "utf-8");
  const v1 = createHmac("sha256", secret).update(`${t}.${rawBody.toString("utf-8")}`).digest("hex");
  return { rawBody, signatureHeader: `t=${t},v1=${v1}` };
}

describe("POST /webhooks/payments/:provider/:restaurantPaymentAccountId — BYOC webhook (Phase 35 audit fix)", () => {
  it("sets firstWebhookReceivedAt on the first real, correctly-signed event and never again after", async () => {
    const secret = "whsec_debug_secret";
    const account = await connectedStripeAccount(secret);
    expect(account.firstWebhookReceivedAt).toBeUndefined();

    const payload = {
      id: "evt_debug_1",
      type: "checkout.session.completed",
      data: { object: { id: "cs_debug_1", status: "complete", payment_status: "paid" } },
    };
    const { rawBody, signatureHeader } = signStripe(payload, secret);

    const res = await request(app)
      .post(`/api/v1/webhooks/payments/stripe/${account.id}`)
      .set("Content-Type", "application/json")
      .set("Stripe-Signature", signatureHeader)
      .send(rawBody.toString("utf-8"));
    expect(res.status).toBe(200);

    const afterFirst = await RestaurantPaymentAccount.findById(account._id);
    expect(afterFirst!.firstWebhookReceivedAt).toBeTruthy();
    // Mongoose's InferSchemaType doesn't carry this optional Date field through cleanly (same
    // known quirk restaurantProvider.ts's encryptedCredentials cast already works around) — the
    // field is real and Date-typed at runtime, confirmed by the .toBeTruthy() check above.
    const firstTimestamp = (afterFirst!.firstWebhookReceivedAt as Date).getTime();

    // A second, later event must never move the timestamp — it only ever marks the FIRST one.
    const payload2 = {
      id: "evt_debug_2",
      type: "checkout.session.completed",
      data: { object: { id: "cs_debug_2", status: "complete", payment_status: "paid" } },
    };
    const signed2 = signStripe(payload2, secret);
    await request(app)
      .post(`/api/v1/webhooks/payments/stripe/${account.id}`)
      .set("Content-Type", "application/json")
      .set("Stripe-Signature", signed2.signatureHeader)
      .send(signed2.rawBody.toString("utf-8"));

    const afterSecond = await RestaurantPaymentAccount.findById(account._id);
    expect((afterSecond!.firstWebhookReceivedAt as Date).getTime()).toBe(firstTimestamp);
  });

  it("never sets firstWebhookReceivedAt when the signature is invalid", async () => {
    const account = await connectedStripeAccount("whsec_real_secret");
    const payload = { id: "evt_bad", type: "checkout.session.completed", data: { object: { id: "cs_bad", status: "complete", payment_status: "paid" } } };
    const { rawBody } = signStripe(payload, "whsec_wrong_secret");

    const res = await request(app)
      .post(`/api/v1/webhooks/payments/stripe/${account.id}`)
      .set("Content-Type", "application/json")
      .set("Stripe-Signature", "t=1,v1=00")
      .send(rawBody.toString("utf-8"));
    expect(res.status).toBe(400);

    const stillUnset = await RestaurantPaymentAccount.findById(account._id);
    expect(stillUnset!.firstWebhookReceivedAt).toBeUndefined();
  });
});
