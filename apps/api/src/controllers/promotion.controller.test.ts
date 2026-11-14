import { afterAll, beforeAll, describe, expect, it } from "@jest/globals";
import request from "supertest";
import { createApp } from "../app.js";
import { connectDB } from "../config/db.js";
import { Category } from "../models/Category.js";
import { MenuItem } from "../models/MenuItem.js";
import { Order } from "../models/Order.js";
import { Promotion } from "../models/Promotion.js";
import { Restaurant } from "../models/Restaurant.js";
import { User } from "../models/User.js";
import { LoyaltyAccount, LoyaltyTransaction } from "../models/LoyaltyAccount.js";
import { Counter } from "../models/Counter.js";
import {
  closeTestConnections,
  createTestCategory,
  createTestMenuItem,
  createTestRestaurant,
  createTestUser,
  tokenFor,
} from "../test-utils/fixtures.js";

const app = createApp();

let restaurantA: Awaited<ReturnType<typeof createTestRestaurant>>;
let restaurantB: Awaited<ReturnType<typeof createTestRestaurant>>;
let categoryA: Awaited<ReturnType<typeof createTestCategory>>;
let menuItemA: Awaited<ReturnType<typeof createTestMenuItem>>;
let ownerAToken: string;
let managerAToken: string;
let staffAToken: string;
let customerToken: string;
let customerId: string;

beforeAll(async () => {
  await connectDB();
  restaurantA = await createTestRestaurant({
    settings: { orderingEnabled: true, pickupEnabled: true, deliveryEnabled: false, minOrderAmount: 0, taxRate: 0.1, deliveryFee: 0 },
  });
  restaurantB = await createTestRestaurant();
  categoryA = await createTestCategory(restaurantA._id);
  menuItemA = await createTestMenuItem(restaurantA._id, categoryA._id, { price: 20 });

  const ownerA = await createTestUser("restaurant_owner", restaurantA._id);
  const managerA = await createTestUser("restaurant_manager", restaurantA._id);
  const staffA = await createTestUser("restaurant_staff", restaurantA._id);
  const customer = await createTestUser("customer");

  ownerAToken = tokenFor(ownerA);
  managerAToken = tokenFor(managerA);
  staffAToken = tokenFor(staffA);
  customerToken = tokenFor(customer);
  customerId = customer.id;
});

afterAll(async () => {
  const ids = [restaurantA._id, restaurantB._id];
  await Promise.all([
    Order.deleteMany({ restaurantId: { $in: ids } }),
    Promotion.deleteMany({ restaurantId: { $in: ids } }),
    MenuItem.deleteMany({ restaurantId: { $in: ids } }),
    Category.deleteMany({ restaurantId: { $in: ids } }),
    User.deleteMany({ restaurantId: { $in: ids } }),
    LoyaltyAccount.deleteMany({ restaurantId: { $in: ids } }),
    LoyaltyTransaction.deleteMany({ restaurantId: { $in: ids } }),
    Counter.deleteMany({ _id: { $in: ids } }),
    Restaurant.deleteMany({ _id: { $in: ids } }),
  ]);
  await User.deleteOne({ _id: customerId });
  await closeTestConnections();
});

function code() {
  // Base36 keeps this well under the 20-char max the validation schema enforces (a plain
  // decimal Date.now() + random suffix can run to 21 chars and get spuriously rejected).
  return `T${Date.now().toString(36).toUpperCase()}${Math.floor(Math.random() * 1000)}`;
}

describe("promotion management (restaurant.promotions.manage)", () => {
  it("owner can create a percentage promotion", async () => {
    const res = await request(app)
      .post(`/api/v1/restaurants/${restaurantA.id}/promotions`)
      .set("Authorization", `Bearer ${ownerAToken}`)
      .send({ code: code(), name: "10% off", type: "percentage", value: 10 });
    expect(res.status).toBe(201);
    expect(res.body.data.promotion.value).toBe(10);
    expect(res.body.data.promotion.usageCount).toBe(0);
  });

  it("manager can also create promotions", async () => {
    const res = await request(app)
      .post(`/api/v1/restaurants/${restaurantA.id}/promotions`)
      .set("Authorization", `Bearer ${managerAToken}`)
      .send({ code: code(), name: "Manager promo", type: "fixed", value: 5 });
    expect(res.status).toBe(201);
  });

  it("staff cannot create promotions", async () => {
    const res = await request(app)
      .post(`/api/v1/restaurants/${restaurantA.id}/promotions`)
      .set("Authorization", `Bearer ${staffAToken}`)
      .send({ code: code(), name: "Should fail", type: "fixed", value: 5 });
    expect(res.status).toBe(403);
  });

  it("rejects a percentage discount over 100", async () => {
    const res = await request(app)
      .post(`/api/v1/restaurants/${restaurantA.id}/promotions`)
      .set("Authorization", `Bearer ${ownerAToken}`)
      .send({ code: code(), name: "Too much", type: "percentage", value: 150 });
    expect(res.status).toBe(400);
  });

  it("rejects a duplicate code within the same restaurant", async () => {
    const c = code();
    const first = await request(app)
      .post(`/api/v1/restaurants/${restaurantA.id}/promotions`)
      .set("Authorization", `Bearer ${ownerAToken}`)
      .send({ code: c, name: "First", type: "fixed", value: 2 });
    expect(first.status).toBe(201);

    const second = await request(app)
      .post(`/api/v1/restaurants/${restaurantA.id}/promotions`)
      .set("Authorization", `Bearer ${ownerAToken}`)
      .send({ code: c, name: "Duplicate", type: "fixed", value: 3 });
    expect(second.status).toBe(409);
  });

  it("owner can deactivate a promotion", async () => {
    const create = await request(app)
      .post(`/api/v1/restaurants/${restaurantA.id}/promotions`)
      .set("Authorization", `Bearer ${ownerAToken}`)
      .send({ code: code(), name: "Deactivate me", type: "fixed", value: 1 });
    const id = create.body.data.promotion.id;

    const res = await request(app)
      .patch(`/api/v1/restaurants/${restaurantA.id}/promotions/${id}`)
      .set("Authorization", `Bearer ${ownerAToken}`)
      .send({ isActive: false });
    expect(res.status).toBe(200);
    expect(res.body.data.promotion.isActive).toBe(false);
  });
});

describe("checking a promo code (customer-facing, read-only)", () => {
  it("returns valid:true with the correct discount for a percentage code", async () => {
    const c = code();
    await request(app)
      .post(`/api/v1/restaurants/${restaurantA.id}/promotions`)
      .set("Authorization", `Bearer ${ownerAToken}`)
      .send({ code: c, name: "20% off", type: "percentage", value: 20 });

    const res = await request(app)
      .post(`/api/v1/restaurants/${restaurantA.id}/promotions/check`)
      .set("Authorization", `Bearer ${customerToken}`)
      .send({ code: c, subtotal: 50 });
    expect(res.status).toBe(200);
    expect(res.body.data.valid).toBe(true);
    expect(res.body.data.discount).toBe(10);
  });

  it("returns valid:false (not a 400/500) for a code that doesn't exist", async () => {
    const res = await request(app)
      .post(`/api/v1/restaurants/${restaurantA.id}/promotions/check`)
      .set("Authorization", `Bearer ${customerToken}`)
      .send({ code: "DOES-NOT-EXIST", subtotal: 50 });
    expect(res.status).toBe(200);
    expect(res.body.data.valid).toBe(false);
    expect(res.body.data.reason).toBeTruthy();
  });

  it("returns valid:false when the subtotal is below the code's minimum order amount", async () => {
    const c = code();
    await request(app)
      .post(`/api/v1/restaurants/${restaurantA.id}/promotions`)
      .set("Authorization", `Bearer ${ownerAToken}`)
      .send({ code: c, name: "Big spend only", type: "fixed", value: 5, minOrderAmount: 100 });

    const res = await request(app)
      .post(`/api/v1/restaurants/${restaurantA.id}/promotions/check`)
      .set("Authorization", `Bearer ${customerToken}`)
      .send({ code: c, subtotal: 20 });
    expect(res.status).toBe(200);
    expect(res.body.data.valid).toBe(false);
  });

  it("returns valid:false once a usage-limited code is exhausted", async () => {
    const c = code();
    const create = await request(app)
      .post(`/api/v1/restaurants/${restaurantA.id}/promotions`)
      .set("Authorization", `Bearer ${ownerAToken}`)
      .send({ code: c, name: "One-time", type: "fixed", value: 1, usageLimit: 1 });
    await Promotion.findByIdAndUpdate(create.body.data.promotion.id, { usageCount: 1 });

    const res = await request(app)
      .post(`/api/v1/restaurants/${restaurantA.id}/promotions/check`)
      .set("Authorization", `Bearer ${customerToken}`)
      .send({ code: c, subtotal: 20 });
    expect(res.body.data.valid).toBe(false);
  });
});

// QA-001 (browser audit, 2026-11-08) — a signed-out customer applying a code saw "Missing access
// token". The check is now public; every rule still runs server-side and the order re-checks.
describe("checking a promo code while signed out (QA-001)", () => {
  async function createCode(body: Record<string, unknown>, restaurantId = restaurantA.id as string, token = ownerAToken) {
    const c = code();
    const res = await request(app)
      .post(`/api/v1/restaurants/${restaurantId}/promotions`)
      .set("Authorization", `Bearer ${token}`)
      .send({ code: c, name: "QA-001", ...body });
    expect(res.status).toBe(201);
    return { code: c, id: res.body.data.promotion.id as string };
  }
  const check = (codeValue: string, subtotal: number, restaurantId = restaurantA.id as string) =>
    request(app).post(`/api/v1/restaurants/${restaurantId}/promotions/check`).send({ code: codeValue, subtotal });

  it("a valid code applies without an account, with the same discount a signed-in customer gets", async () => {
    const { code: c } = await createCode({ type: "percentage", value: 10 });
    const anon = await check(c, 40);
    const signedIn = await request(app)
      .post(`/api/v1/restaurants/${restaurantA.id}/promotions/check`)
      .set("Authorization", `Bearer ${customerToken}`)
      .send({ code: c, subtotal: 40 });
    expect(anon.status).toBe(200);
    expect(anon.body.data).toMatchObject({ valid: true, discount: 4 });
    expect(signedIn.body.data).toEqual(anon.body.data);
    // Only the code's public terms come back — no usage counts, limits, ids or owner data.
    expect(Object.keys(anon.body.data.promotion).sort()).toEqual(["code", "name", "type", "value"]);
  });

  it("refuses unknown, expired, inactive, exhausted and below-minimum codes with a customer-friendly reason", async () => {
    const expired = await createCode({ type: "fixed", value: 2, startDate: new Date(Date.now() - 2 * 86_400_000).toISOString(), endDate: new Date(Date.now() - 86_400_000).toISOString() });
    const inactive = await createCode({ type: "fixed", value: 2 });
    await Promotion.findByIdAndUpdate(inactive.id, { isActive: false });
    const exhausted = await createCode({ type: "fixed", value: 2, usageLimit: 1 });
    await Promotion.findByIdAndUpdate(exhausted.id, { usageCount: 1 });
    const minimum = await createCode({ type: "fixed", value: 2, minOrderAmount: 100 });

    const cases: Array<[string, RegExp]> = [
      ["NO-SUCH-CODE", /invalid promo code/i],
      [expired.code, /expired/i],
      [inactive.code, /no longer active/i],
      [exhausted.code, /usage limit/i],
      [minimum.code, /minimum order/i],
    ];
    for (const [c, reason] of cases) {
      const res = await check(c, 20);
      expect({ c, status: res.status, valid: res.body.data.valid }).toEqual({ c, status: 200, valid: false });
      expect(res.body.data.reason).toMatch(reason);
      expect(JSON.stringify(res.body)).not.toMatch(/token|unauthori[sz]ed/i);
    }
  });

  it("a code from another restaurant never applies (cross-restaurant attempt)", async () => {
    const ownerB = await createTestUser("restaurant_owner", restaurantB._id);
    const { code: bCode } = await createCode({ type: "percentage", value: 50 }, restaurantB.id as string, tokenFor(ownerB));
    expect((await check(bCode, 50, restaurantB.id as string)).body.data.valid).toBe(true);
    const res = await check(bCode, 50, restaurantA.id as string);
    expect(res.body.data).toMatchObject({ valid: false });
  });

  it("a malformed or unknown restaurant id is a plain refusal, not an error", async () => {
    for (const id of ["not-an-id", "6aaaaaaaaaaaaaaaaaaaaaaa"]) {
      const res = await check("ANY", 10, id);
      expect(res.status).toBe(200);
      expect(res.body.data.valid).toBe(false);
    }
  });

  it("managing promotions still requires the owner's permission", async () => {
    expect((await request(app).get(`/api/v1/restaurants/${restaurantA.id}/promotions`)).status).toBe(401);
    const create = await request(app)
      .post(`/api/v1/restaurants/${restaurantA.id}/promotions`)
      .send({ code: code(), name: "x", type: "fixed", value: 1 });
    expect(create.status).toBe(401);
    const asCustomer = await request(app).get(`/api/v1/restaurants/${restaurantA.id}/promotions`).set("Authorization", `Bearer ${customerToken}`);
    expect(asCustomer.status).toBe(403);
  });
});

describe("promo codes at checkout — server-side pricing, never trusting the client", () => {
  it("applies a valid promo code's discount to the order total and increments usageCount", async () => {
    const c = code();
    const create = await request(app)
      .post(`/api/v1/restaurants/${restaurantA.id}/promotions`)
      .set("Authorization", `Bearer ${ownerAToken}`)
      .send({ code: c, name: "5 off", type: "fixed", value: 5 });
    const promotionId = create.body.data.promotion.id;

    const res = await request(app)
      .post(`/api/v1/restaurants/${restaurantA.id}/orders`)
      .set("Authorization", `Bearer ${customerToken}`)
      .send({
        orderType: "pickup",
        items: [{ menuItemId: menuItemA.id, quantity: 1, selectedModifiers: [] }],
        promoCode: c,
      });

    expect(res.status).toBe(201);
    // subtotal 20, promo -5 => taxable 15, tax 10% => 1.5, total 16.5
    expect(res.body.data.order.promoCode).toBe(c);
    expect(res.body.data.order.promoDiscount).toBe(5);
    expect(res.body.data.order.total).toBeCloseTo(16.5, 2);

    const promo = await Promotion.findById(promotionId);
    expect(promo!.usageCount).toBe(1);
  });

  it("rejects checkout with an invalid promo code rather than silently ignoring it", async () => {
    const res = await request(app)
      .post(`/api/v1/restaurants/${restaurantA.id}/orders`)
      .set("Authorization", `Bearer ${customerToken}`)
      .send({
        orderType: "pickup",
        items: [{ menuItemId: menuItemA.id, quantity: 1, selectedModifiers: [] }],
        promoCode: "NOT-A-REAL-CODE",
      });
    expect(res.status).toBe(400);
  });

  it("ignores a client-sent discount amount — only the server-computed discount is ever applied", async () => {
    const c = code();
    await request(app)
      .post(`/api/v1/restaurants/${restaurantA.id}/promotions`)
      .set("Authorization", `Bearer ${ownerAToken}`)
      .send({ code: c, name: "1 off", type: "fixed", value: 1 });

    const res = await request(app)
      .post(`/api/v1/restaurants/${restaurantA.id}/orders`)
      .set("Authorization", `Bearer ${customerToken}`)
      .send({
        orderType: "pickup",
        items: [{ menuItemId: menuItemA.id, quantity: 1, selectedModifiers: [] }],
        promoCode: c,
        promoDiscount: 999, // not a real field on the schema — must be silently dropped
        discount: 999,
      });

    expect(res.status).toBe(201);
    expect(res.body.data.order.promoDiscount).toBe(1);
    // subtotal 20, promo -1 => taxable 19, tax 10% => 1.9, total 20.9
    expect(res.body.data.order.total).toBeCloseTo(20.9, 2);
  });

  it("a promo code from restaurant B cannot be applied to a restaurant A order", async () => {
    const c = code();
    await request(app)
      .post(`/api/v1/restaurants/${restaurantB.id}/promotions`)
      .set("Authorization", `Bearer ${tokenFor(await createTestUser("restaurant_owner", restaurantB._id))}`)
      .send({ code: c, name: "Restaurant B only", type: "fixed", value: 5 });

    const res = await request(app)
      .post(`/api/v1/restaurants/${restaurantA.id}/orders`)
      .set("Authorization", `Bearer ${customerToken}`)
      .send({
        orderType: "pickup",
        items: [{ menuItemId: menuItemA.id, quantity: 1, selectedModifiers: [] }],
        promoCode: c,
      });
    expect(res.status).toBe(400);
  });

  it("under true concurrency, two simultaneous orders against a usageLimit:1 promo code never both succeed (Phase 16)", async () => {
    const c = code();
    await request(app)
      .post(`/api/v1/restaurants/${restaurantA.id}/promotions`)
      .set("Authorization", `Bearer ${ownerAToken}`)
      .send({ code: c, name: "One use only", type: "fixed", value: 1, usageLimit: 1 });

    const [a, b] = await Promise.all([
      request(app)
        .post(`/api/v1/restaurants/${restaurantA.id}/orders`)
        .set("Authorization", `Bearer ${customerToken}`)
        .send({ orderType: "pickup", items: [{ menuItemId: menuItemA.id, quantity: 1, selectedModifiers: [] }], promoCode: c }),
      request(app)
        .post(`/api/v1/restaurants/${restaurantA.id}/orders`)
        .set("Authorization", `Bearer ${customerToken}`)
        .send({ orderType: "pickup", items: [{ menuItemId: menuItemA.id, quantity: 1, selectedModifiers: [] }], promoCode: c }),
    ]);

    const statuses = [a.status, b.status].sort();
    // One order wins (201), the other loses the race and its whole transaction aborts (409) —
    // never both 201, which would mean usageCount silently exceeded usageLimit. See
    // promotion.service.ts's recordPromoUsage.
    expect(statuses).toEqual([201, 409]);

    const promo = await Promotion.findOne({ restaurantId: restaurantA.id, code: c });
    expect(promo!.usageCount).toBe(1);
  });
});
