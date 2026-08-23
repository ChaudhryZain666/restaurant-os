import { afterAll, beforeAll, describe, expect, it } from "@jest/globals";
import request from "supertest";
import { createApp } from "../app.js";
import { connectDB } from "../config/db.js";
import { AuditLog } from "../models/AuditLog.js";
import { Category } from "../models/Category.js";
import { MenuItem } from "../models/MenuItem.js";
import { Order } from "../models/Order.js";
import { Promotion } from "../models/Promotion.js";
import { Restaurant } from "../models/Restaurant.js";
import { Business } from "../models/Business.js";
import { User } from "../models/User.js";
import { Counter } from "../models/Counter.js";
import {
  closeTestConnections,
  createTestBusiness,
  createTestCategory,
  createTestMenuItem,
  createTestRestaurant,
  createTestUser,
  tokenFor,
} from "../test-utils/fixtures.js";

const app = createApp();

let business: Awaited<ReturnType<typeof createTestBusiness>>;
let locationA: Awaited<ReturnType<typeof createTestRestaurant>>;
let locationB: Awaited<ReturnType<typeof createTestRestaurant>>;
let otherBusiness: Awaited<ReturnType<typeof createTestBusiness>>;
let otherLocation: Awaited<ReturnType<typeof createTestRestaurant>>;
let menuItemA: Awaited<ReturnType<typeof createTestMenuItem>>;
let menuItemB: Awaited<ReturnType<typeof createTestMenuItem>>;

let ownerToken: string;
let managerToken: string;
let staffToken: string;
let crossBusinessOwnerToken: string;
let customerToken: string;
let customerId: string;

function uniqueCode(prefix: string) {
  // promotionBaseSchema caps `code` at 20 chars — base36-encode to stay well within that
  // regardless of prefix length, rather than a decimal timestamp that can overflow it.
  const suffix = Date.now().toString(36).toUpperCase() + Math.random().toString(36).slice(2, 4).toUpperCase();
  return `${prefix}${suffix}`.slice(0, 20);
}

async function placeOrder(restaurantId: string, menuItemId: string, promoCode?: string) {
  const res = await request(app)
    .post(`/api/v1/restaurants/${restaurantId}/orders`)
    .set("Authorization", `Bearer ${customerToken}`)
    .send({
      orderType: "pickup",
      items: [{ menuItemId, quantity: 1, selectedModifiers: [] }],
      ...(promoCode ? { promoCode } : {}),
    });
  return res;
}

beforeAll(async () => {
  await connectDB();

  business = await createTestBusiness();
  const taxedSettings = { orderingEnabled: true, pickupEnabled: true, deliveryEnabled: false, minOrderAmount: 0, taxRate: 0.1, deliveryFee: 0 };
  locationA = await createTestRestaurant({ businessId: business._id, settings: taxedSettings });
  locationB = await createTestRestaurant({ businessId: business._id, settings: taxedSettings });
  otherBusiness = await createTestBusiness();
  otherLocation = await createTestRestaurant({ businessId: otherBusiness._id, settings: taxedSettings });

  const categoryA = await createTestCategory(locationA._id);
  menuItemA = await createTestMenuItem(locationA._id, categoryA._id, { price: 20 });
  const categoryB = await createTestCategory(locationB._id);
  menuItemB = await createTestMenuItem(locationB._id, categoryB._id, { price: 20 });

  const owner = await createTestUser("restaurant_owner", locationA._id, { businessId: business._id });
  const manager = await createTestUser("restaurant_manager", locationA._id, { businessId: business._id });
  const staff = await createTestUser("restaurant_staff", locationA._id, { businessId: business._id, locationIds: [locationA._id] });
  const crossBusinessOwner = await createTestUser("restaurant_owner", otherLocation._id, { businessId: otherBusiness._id });
  const customer = await createTestUser("customer");

  ownerToken = tokenFor(owner);
  managerToken = tokenFor(manager);
  staffToken = tokenFor(staff);
  crossBusinessOwnerToken = tokenFor(crossBusinessOwner);
  customerToken = tokenFor(customer);
  customerId = customer.id as string;
});

afterAll(async () => {
  const businessIds = [business._id, otherBusiness._id];
  const restaurantIds = [locationA._id, locationB._id, otherLocation._id];
  await Promise.all([
    Order.deleteMany({ restaurantId: { $in: restaurantIds } }),
    Promotion.deleteMany({ $or: [{ businessId: { $in: businessIds } }, { restaurantId: { $in: restaurantIds } }] }),
    MenuItem.deleteMany({ restaurantId: { $in: restaurantIds } }),
    Category.deleteMany({ restaurantId: { $in: restaurantIds } }),
    Counter.deleteMany({ _id: { $in: restaurantIds } }),
    AuditLog.deleteMany({ restaurantId: { $in: restaurantIds } }),
    User.deleteMany({ businessId: { $in: businessIds } }),
    Restaurant.deleteMany({ businessId: { $in: businessIds } }),
    Business.deleteMany({ _id: { $in: businessIds } }),
    User.deleteOne({ _id: customerId }),
  ]);
  await closeTestConnections();
});

describe("POST /businesses/:businessId/promotions — create + authorization", () => {
  it("owner can create a business promotion targeting a selected location", async () => {
    const code = uniqueCode("BIZ");
    const res = await request(app)
      .post(`/api/v1/businesses/${business.id}/promotions`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ code, name: "Business Promo", type: "fixed", value: 5, locationIds: [locationA.id] });
    expect(res.status).toBe(201);
    expect(res.body.data.promotion.businessId).toBe(business.id);
    expect(res.body.data.promotion.locationIds).toEqual([locationA.id]);
    expect(res.body.data.promotion.restaurantId).toBeUndefined();
  });

  it("manager can also create a business promotion", async () => {
    const res = await request(app)
      .post(`/api/v1/businesses/${business.id}/promotions`)
      .set("Authorization", `Bearer ${managerToken}`)
      .send({ code: uniqueCode("MGR"), name: "Manager Promo", type: "fixed", value: 5, locationIds: [locationA.id] });
    expect(res.status).toBe(201);
  });

  it("staff cannot create a business promotion", async () => {
    const res = await request(app)
      .post(`/api/v1/businesses/${business.id}/promotions`)
      .set("Authorization", `Bearer ${staffToken}`)
      .send({ code: uniqueCode("STAFF"), name: "Nope", type: "fixed", value: 5, locationIds: [locationA.id] });
    expect(res.status).toBe(403);
  });

  it("a cross-business owner cannot create a promotion for this business", async () => {
    const res = await request(app)
      .post(`/api/v1/businesses/${business.id}/promotions`)
      .set("Authorization", `Bearer ${crossBusinessOwnerToken}`)
      .send({ code: uniqueCode("XB"), name: "Nope", type: "fixed", value: 5, locationIds: [locationA.id] });
    expect(res.status).toBe(403);
  });

  it("rejects a locationId that doesn't belong to this business", async () => {
    const res = await request(app)
      .post(`/api/v1/businesses/${business.id}/promotions`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ code: uniqueCode("FOREIGN"), name: "Nope", type: "fixed", value: 5, locationIds: [otherLocation.id] });
    expect(res.status).toBe(400);
  });

  it("rejects a duplicate code within the same business but allows the same code in a different business", async () => {
    const code = uniqueCode("DUP");
    const first = await request(app)
      .post(`/api/v1/businesses/${business.id}/promotions`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ code, name: "First", type: "fixed", value: 5, locationIds: [locationA.id] });
    expect(first.status).toBe(201);

    const duplicate = await request(app)
      .post(`/api/v1/businesses/${business.id}/promotions`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ code, name: "Duplicate", type: "fixed", value: 5, locationIds: [locationA.id] });
    expect(duplicate.status).toBe(409);

    const otherBusinessSame = await request(app)
      .post(`/api/v1/businesses/${otherBusiness.id}/promotions`)
      .set("Authorization", `Bearer ${crossBusinessOwnerToken}`)
      .send({ code, name: "Same code, different business", type: "fixed", value: 5, locationIds: [otherLocation.id] });
    expect(otherBusinessSame.status).toBe(201);
  });

  it("writes an audit log entry only for the targeted location, not sibling locations", async () => {
    const code = uniqueCode("AUDIT");
    const res = await request(app)
      .post(`/api/v1/businesses/${business.id}/promotions`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ code, name: "Audited Promo", type: "fixed", value: 5, locationIds: [locationA.id] });

    const entryAtA = await AuditLog.findOne({ restaurantId: locationA._id, action: "promotion.created", "metadata.code": code });
    const entryAtB = await AuditLog.findOne({ restaurantId: locationB._id, action: "promotion.created", "metadata.code": code });
    expect(entryAtA).not.toBeNull();
    expect(entryAtB).toBeNull();
    expect(entryAtA?.metadata).toMatchObject({ scope: "business" });
    void res;
  });
});

describe("business promotion location targeting — the core security proof", () => {
  it("applies at the selected location but is rejected at an unselected location of the same business", async () => {
    const code = uniqueCode("TARGET");
    await request(app)
      .post(`/api/v1/businesses/${business.id}/promotions`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ code, name: "Targeted", type: "fixed", value: 5, locationIds: [locationA.id] });

    // subtotal 20, discount -5 => taxable 15, tax 10% => 1.5, total 16.5 — same discount->tax
    // ordering the location-scoped promotion suite already proves, now for a business-scoped one.
    const atA = await placeOrder(locationA.id, menuItemA.id, code);
    expect(atA.status).toBe(201);
    expect(atA.body.data.order.total).toBeCloseTo(16.5);

    const atB = await placeOrder(locationB.id, menuItemB.id, code);
    expect(atB.status).toBe(400);
    expect(atB.body.error.message).toMatch(/invalid promo code/i);
  });

  it("applies at BOTH locations once the promotion is edited to target both", async () => {
    const code = uniqueCode("EXPAND");
    const createRes = await request(app)
      .post(`/api/v1/businesses/${business.id}/promotions`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ code, name: "Expanding", type: "fixed", value: 5, locationIds: [locationA.id] });
    const id = createRes.body.data.promotion.id as string;

    const stillRejected = await placeOrder(locationB.id, menuItemB.id, code);
    expect(stillRejected.status).toBe(400);

    await request(app)
      .patch(`/api/v1/businesses/${business.id}/promotions/${id}`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ locationIds: [locationA.id, locationB.id] });

    const nowApplies = await placeOrder(locationB.id, menuItemB.id, code);
    expect(nowApplies.status).toBe(201);
    expect(nowApplies.body.data.order.total).toBeCloseTo(16.5);
  });

  it("stops applying once deactivated", async () => {
    const code = uniqueCode("DEACT");
    const createRes = await request(app)
      .post(`/api/v1/businesses/${business.id}/promotions`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ code, name: "Deactivate me", type: "fixed", value: 5, locationIds: [locationA.id] });
    const id = createRes.body.data.promotion.id as string;

    await request(app)
      .patch(`/api/v1/businesses/${business.id}/promotions/${id}`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ isActive: false });

    const res = await placeOrder(locationA.id, menuItemA.id, code);
    expect(res.status).toBe(400);
  });

  it("resolves exactly one winner under concurrent redemption at usageLimit:1", async () => {
    const code = uniqueCode("RACE");
    await request(app)
      .post(`/api/v1/businesses/${business.id}/promotions`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ code, name: "Race", type: "fixed", value: 1, locationIds: [locationA.id, locationB.id], usageLimit: 1 });

    const [a, b] = await Promise.all([
      placeOrder(locationA.id, menuItemA.id, code),
      placeOrder(locationB.id, menuItemB.id, code),
    ]);
    const statuses = [a.status, b.status].sort((x, y) => x - y);
    expect(statuses).toEqual([201, 409]);

    const promo = await Promotion.findOne({ code });
    expect(promo?.usageCount).toBe(1);
  });
});

describe("GET /restaurants/:restaurantId/promotions — business promotions surfaced read-only", () => {
  it("shows a targeted business promotion tagged scope:business, and never at an unselected sibling location", async () => {
    const code = uniqueCode("LIST");
    await request(app)
      .post(`/api/v1/businesses/${business.id}/promotions`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ code, name: "Listed", type: "fixed", value: 5, locationIds: [locationA.id] });

    const atA = await request(app)
      .get(`/api/v1/restaurants/${locationA.id}/promotions`)
      .set("Authorization", `Bearer ${ownerToken}`);
    const entryAtA = atA.body.data.promotions.find((p: { code: string }) => p.code === code);
    expect(entryAtA?.scope).toBe("business");

    const atB = await request(app)
      .get(`/api/v1/restaurants/${locationB.id}/promotions`)
      .set("Authorization", `Bearer ${ownerToken}`);
    const entryAtB = atB.body.data.promotions.find((p: { code: string }) => p.code === code);
    expect(entryAtB).toBeUndefined();
  });

  it("a pre-existing location-only promotion still works completely unaffected", async () => {
    const code = uniqueCode("LOCONLY");
    const createRes = await request(app)
      .post(`/api/v1/restaurants/${locationA.id}/promotions`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ code, name: "Location Only", type: "fixed", value: 5 });
    expect(createRes.status).toBe(201);
    expect(createRes.body.data.promotion.scope).toBeUndefined(); // location-create response is unchanged shape

    const order = await placeOrder(locationA.id, menuItemA.id, code);
    expect(order.status).toBe(201);
    expect(order.body.data.order.total).toBeCloseTo(16.5);

    // Never resolvable at a sibling location — the original, unchanged restaurantId-only guarantee.
    const atB = await placeOrder(locationB.id, menuItemB.id, code);
    expect(atB.status).toBe(400);
  });
});
