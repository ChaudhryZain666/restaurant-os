import { afterAll, beforeAll, describe, expect, it } from "@jest/globals";
import request from "supertest";
import { createApp } from "../app.js";
import { connectDB } from "../config/db.js";
import { Category } from "../models/Category.js";
import { MenuItem } from "../models/MenuItem.js";
import { Order } from "../models/Order.js";
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

// These match TestGeocodingProvider's fixture set exactly (services/geocoding/TestGeocodingProvider.ts)
// — this suite runs against GEOCODING_PROVIDER=test (apps/api/.env), the same real, selectable
// adapter the dev server and Playwright suite use, never a live third-party network call.
const SPRINGFIELD_QUERY = "1200 6th springfield";
const SPRINGFIELD_LAT = 39.7658;
const SPRINGFIELD_LNG = -89.6501;
const AUSTIN_QUERY = "austin congress";
const AUSTIN_LAT = 30.27;
const AUSTIN_LNG = -97.75;

let restaurantA: Awaited<ReturnType<typeof createTestRestaurant>>;
let restaurantB: Awaited<ReturnType<typeof createTestRestaurant>>;
let categoryA: Awaited<ReturnType<typeof createTestCategory>>;
let menuItemA: Awaited<ReturnType<typeof createTestMenuItem>>;
let customerToken: string;
let customerId: string;

beforeAll(async () => {
  await connectDB();

  // Restaurant A: Springfield, matches the fixture — a real delivery order to SPRINGFIELD_LAT/LNG
  // should be eligible.
  restaurantA = await createTestRestaurant({
    latitude: SPRINGFIELD_LAT,
    longitude: SPRINGFIELD_LNG,
    settings: {
      orderingEnabled: true,
      pickupEnabled: true,
      deliveryEnabled: true,
      minOrderAmount: 0,
      taxRate: 0.1,
      deliveryFee: 4.5,
      deliveryRadiusKm: 5,
    },
  });
  // Restaurant B: a completely different location (Austin) — proves a geocoded address's
  // eligibility is computed from EACH restaurant's own stored coordinates/radius/fee, never
  // shared with or leaked from another restaurant's configuration.
  restaurantB = await createTestRestaurant({
    latitude: AUSTIN_LAT,
    longitude: AUSTIN_LNG,
    settings: {
      orderingEnabled: true,
      pickupEnabled: true,
      deliveryEnabled: true,
      minOrderAmount: 0,
      taxRate: 0.1,
      deliveryFee: 999,
      deliveryRadiusKm: 5,
    },
  });
  categoryA = await createTestCategory(restaurantA._id);
  menuItemA = await createTestMenuItem(restaurantA._id, categoryA._id, { price: 12 });

  const customer = await createTestUser("customer");
  customerToken = tokenFor(customer);
  customerId = customer.id;
});

afterAll(async () => {
  const ids = [restaurantA._id, restaurantB._id];
  await Promise.all([
    Order.deleteMany({ restaurantId: { $in: ids } }),
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

describe("GET /geocoding/autocomplete", () => {
  it("requires authentication", async () => {
    const res = await request(app).get("/api/v1/geocoding/autocomplete").query({ q: SPRINGFIELD_QUERY });
    expect(res.status).toBe(401);
  });

  it("returns suggestions for a matching query", async () => {
    const res = await request(app)
      .get("/api/v1/geocoding/autocomplete")
      .query({ q: SPRINGFIELD_QUERY })
      .set("Authorization", `Bearer ${customerToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.suggestions.length).toBeGreaterThan(0);
    expect(res.body.data.suggestions[0]).toEqual({ id: expect.any(String), label: expect.any(String) });
  });

  it("returns an empty list (not an error) for text matching nothing", async () => {
    const res = await request(app)
      .get("/api/v1/geocoding/autocomplete")
      .query({ q: "nowhere on earth xyz" })
      .set("Authorization", `Bearer ${customerToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.suggestions).toEqual([]);
  });

  it("rejects an absurdly long query rather than passing it through to the provider", async () => {
    const res = await request(app)
      .get("/api/v1/geocoding/autocomplete")
      .query({ q: "a".repeat(500) })
      .set("Authorization", `Bearer ${customerToken}`);

    expect(res.status).toBe(400);
  });

  it("never includes provider credentials or internal details in the response", async () => {
    const res = await request(app)
      .get("/api/v1/geocoding/autocomplete")
      .query({ q: SPRINGFIELD_QUERY })
      .set("Authorization", `Bearer ${customerToken}`);
    expect(JSON.stringify(res.body)).not.toMatch(/api[_-]?key/i);
  });
});

describe("GET /geocoding/resolve/:suggestionId", () => {
  it("requires authentication", async () => {
    const res = await request(app).get("/api/v1/geocoding/resolve/whatever");
    expect(res.status).toBe(401);
  });

  it("resolves a suggestion id returned by autocomplete to its full geocoded result", async () => {
    const auto = await request(app)
      .get("/api/v1/geocoding/autocomplete")
      .query({ q: SPRINGFIELD_QUERY })
      .set("Authorization", `Bearer ${customerToken}`);
    const suggestionId = auto.body.data.suggestions[0].id;

    const res = await request(app)
      .get(`/api/v1/geocoding/resolve/${suggestionId}`)
      .set("Authorization", `Bearer ${customerToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.result.latitude).toBe(SPRINGFIELD_LAT);
    expect(res.body.data.result.longitude).toBe(SPRINGFIELD_LNG);
  });

  it("404s clearly (not a 500) for an id that was never issued", async () => {
    const res = await request(app)
      .get("/api/v1/geocoding/resolve/never-issued-id")
      .set("Authorization", `Bearer ${customerToken}`);
    expect(res.status).toBe(404);
    expect(res.body.error.message).not.toMatch(/stack|internal|exception/i);
  });
});

describe("POST /geocoding/geocode", () => {
  it("requires authentication", async () => {
    const res = await request(app).post("/api/v1/geocoding/geocode").send({ query: SPRINGFIELD_QUERY });
    expect(res.status).toBe(401);
  });

  it("geocodes a full address string in one shot", async () => {
    const res = await request(app)
      .post("/api/v1/geocoding/geocode")
      .set("Authorization", `Bearer ${customerToken}`)
      .send({ query: SPRINGFIELD_QUERY });

    expect(res.status).toBe(200);
    expect(res.body.data.result.latitude).toBe(SPRINGFIELD_LAT);
  });

  it("returns a clean 404 for no matching address, never a raw provider exception", async () => {
    const res = await request(app)
      .post("/api/v1/geocoding/geocode")
      .set("Authorization", `Bearer ${customerToken}`)
      .send({ query: "nowhere on earth xyz" });

    expect(res.status).toBe(404);
    expect(res.body.error.message).toBe("No matching address was found.");
  });

  it("rejects a missing query with a validation error, not a crash", async () => {
    const res = await request(app)
      .post("/api/v1/geocoding/geocode")
      .set("Authorization", `Bearer ${customerToken}`)
      .send({});
    expect(res.status).toBe(400);
  });
});

describe("geocoded coordinates flow into the real Phase 9 delivery pipeline (Part 15/20 integration)", () => {
  it("a resolved suggestion's coordinates are accepted by /delivery/check exactly like manually-entered ones", async () => {
    const auto = await request(app)
      .get("/api/v1/geocoding/autocomplete")
      .query({ q: SPRINGFIELD_QUERY })
      .set("Authorization", `Bearer ${customerToken}`);
    const resolved = await request(app)
      .get(`/api/v1/geocoding/resolve/${auto.body.data.suggestions[0].id}`)
      .set("Authorization", `Bearer ${customerToken}`);
    const { latitude, longitude } = resolved.body.data.result;

    const check = await request(app)
      .post(`/api/v1/restaurants/${restaurantA.id}/delivery/check`)
      .set("Authorization", `Bearer ${customerToken}`)
      .send({ latitude, longitude });

    expect(check.status).toBe(200);
    expect(check.body.data.eligible).toBe(true);
    expect(check.body.data.deliveryFee).toBe(4.5);
  });

  it("a full delivery order placed with geocoded coordinates snapshots them exactly, using real Haversine/eligibility (no mocking)", async () => {
    const geocode = await request(app)
      .post("/api/v1/geocoding/geocode")
      .set("Authorization", `Bearer ${customerToken}`)
      .send({ query: SPRINGFIELD_QUERY });
    const { latitude, longitude, formattedAddress } = geocode.body.data.result;

    const res = await request(app)
      .post(`/api/v1/restaurants/${restaurantA.id}/orders`)
      .set("Authorization", `Bearer ${customerToken}`)
      .send({
        orderType: "delivery",
        items: [{ menuItemId: menuItemA.id, quantity: 1, selectedModifiers: [] }],
        deliveryAddress: { line1: formattedAddress, city: "Springfield", latitude, longitude },
      });

    expect(res.status).toBe(201);
    const order = res.body.data.order;
    expect(order.deliveryFee).toBe(4.5);
    expect(order.deliveryAddress.latitude).toBe(SPRINGFIELD_LAT);
    expect(order.deliveryAddress.longitude).toBe(SPRINGFIELD_LNG);
    // Real Haversine distance for coincident restaurant/customer coordinates is 0 — proves the
    // actual delivery.service.ts math ran, not a stubbed/mocked eligibility result.
    expect(order.deliveryDistanceKm).toBe(0);
  });

  it("a geocoded address far outside the radius is still rejected by the real eligibility check", async () => {
    const geocode = await request(app)
      .post("/api/v1/geocoding/geocode")
      .set("Authorization", `Bearer ${customerToken}`)
      .send({ query: AUSTIN_QUERY });
    const { latitude, longitude } = geocode.body.data.result;
    expect(latitude).toBe(AUSTIN_LAT);
    expect(longitude).toBe(AUSTIN_LNG);

    const res = await request(app)
      .post(`/api/v1/restaurants/${restaurantA.id}/orders`)
      .set("Authorization", `Bearer ${customerToken}`)
      .send({
        orderType: "delivery",
        items: [{ menuItemId: menuItemA.id, quantity: 1, selectedModifiers: [] }],
        deliveryAddress: { line1: "200 Congress Ave", city: "Austin", latitude, longitude },
      });

    expect(res.status).toBe(400);
  });

  it("cross-tenant: the SAME geocoded coordinates are eligible for restaurant A but not restaurant B — each restaurant's own radius/fee is used, never shared or leaked", async () => {
    const geocode = await request(app)
      .post("/api/v1/geocoding/geocode")
      .set("Authorization", `Bearer ${customerToken}`)
      .send({ query: SPRINGFIELD_QUERY });
    const { latitude, longitude } = geocode.body.data.result;

    const checkA = await request(app)
      .post(`/api/v1/restaurants/${restaurantA.id}/delivery/check`)
      .set("Authorization", `Bearer ${customerToken}`)
      .send({ latitude, longitude });
    const checkB = await request(app)
      .post(`/api/v1/restaurants/${restaurantB.id}/delivery/check`)
      .set("Authorization", `Bearer ${customerToken}`)
      .send({ latitude, longitude });

    expect(checkA.body.data.eligible).toBe(true);
    expect(checkA.body.data.deliveryFee).toBe(4.5);
    // Restaurant B is really in Austin — the exact same Springfield coordinates are correctly far
    // outside ITS radius, proving B's own stored location (not A's) is what was actually checked.
    expect(checkB.body.data.eligible).toBe(false);
    expect(checkB.body.data.distanceKm).toBeGreaterThan(5);
    expect(checkB.body.data.deliveryFee).not.toBe(4.5);
  });
});
