import { afterAll, beforeAll, describe, expect, it } from "@jest/globals";
import request from "supertest";
import { createApp } from "../app.js";
import { connectDB } from "../config/db.js";
import { User } from "../models/User.js";
import { closeTestConnections, createTestUser, tokenFor } from "../test-utils/fixtures.js";

const app = createApp();

let customerA: Awaited<ReturnType<typeof createTestUser>>;
let customerB: Awaited<ReturnType<typeof createTestUser>>;
let tokenA: string;
let tokenB: string;

beforeAll(async () => {
  await connectDB();
  customerA = await createTestUser("customer");
  customerB = await createTestUser("customer");
  tokenA = tokenFor(customerA);
  tokenB = tokenFor(customerB);
});

afterAll(async () => {
  await User.deleteMany({ _id: { $in: [customerA._id, customerB._id] } });
  await closeTestConnections();
});

describe("saved addresses (customer-owned, identity-scoped)", () => {
  it("starts with an empty address list", async () => {
    const res = await request(app).get("/api/v1/users/me/addresses").set("Authorization", `Bearer ${tokenA}`);
    expect(res.status).toBe(200);
    expect(res.body.data.addresses).toEqual([]);
  });

  it("adding the first address makes it the default automatically", async () => {
    const res = await request(app)
      .post("/api/v1/users/me/addresses")
      .set("Authorization", `Bearer ${tokenA}`)
      .send({ line1: "1 Main St", city: "Springfield" });

    expect(res.status).toBe(201);
    expect(res.body.data.addresses).toHaveLength(1);
    expect(res.body.data.addresses[0].isDefault).toBe(true);
  });

  it("adding a second default address unsets the previous default", async () => {
    const res = await request(app)
      .post("/api/v1/users/me/addresses")
      .set("Authorization", `Bearer ${tokenA}`)
      .send({ line1: "2 Second St", city: "Springfield", isDefault: true });

    expect(res.status).toBe(201);
    const addresses: Array<{ line1: string; isDefault: boolean }> = res.body.data.addresses;
    expect(addresses).toHaveLength(2);
    expect(addresses.filter((a) => a.isDefault)).toHaveLength(1);
    expect(addresses.find((a) => a.line1 === "2 Second St")?.isDefault).toBe(true);
    expect(addresses.find((a) => a.line1 === "1 Main St")?.isDefault).toBe(false);
  });

  it("deleting the default address promotes another to default", async () => {
    const listRes = await request(app).get("/api/v1/users/me/addresses").set("Authorization", `Bearer ${tokenA}`);
    const defaultAddress = listRes.body.data.addresses.find((a: { isDefault: boolean }) => a.isDefault);

    const res = await request(app)
      .delete(`/api/v1/users/me/addresses/${defaultAddress.id}`)
      .set("Authorization", `Bearer ${tokenA}`);

    expect(res.status).toBe(200);
    const remaining: Array<{ isDefault: boolean }> = res.body.data.addresses;
    expect(remaining).toHaveLength(1);
    expect(remaining[0].isDefault).toBe(true);
  });

  it("a customer cannot update another customer's address by ID", async () => {
    const listRes = await request(app).get("/api/v1/users/me/addresses").set("Authorization", `Bearer ${tokenA}`);
    const addressId = listRes.body.data.addresses[0].id;

    const res = await request(app)
      .patch(`/api/v1/users/me/addresses/${addressId}`)
      .set("Authorization", `Bearer ${tokenB}`)
      .send({ city: "Hijacked" });

    expect(res.status).toBe(404);

    const stillA = await request(app).get("/api/v1/users/me/addresses").set("Authorization", `Bearer ${tokenA}`);
    expect(stillA.body.data.addresses[0].city).not.toBe("Hijacked");
  });

  it("a customer cannot delete another customer's address by ID", async () => {
    const listRes = await request(app).get("/api/v1/users/me/addresses").set("Authorization", `Bearer ${tokenA}`);
    const addressId = listRes.body.data.addresses[0].id;

    const res = await request(app)
      .delete(`/api/v1/users/me/addresses/${addressId}`)
      .set("Authorization", `Bearer ${tokenB}`);

    expect(res.status).toBe(404);

    const stillA = await request(app).get("/api/v1/users/me/addresses").set("Authorization", `Bearer ${tokenA}`);
    expect(stillA.body.data.addresses).toHaveLength(1);
  });

  it("rejects an address missing required fields", async () => {
    const res = await request(app)
      .post("/api/v1/users/me/addresses")
      .set("Authorization", `Bearer ${tokenA}`)
      .send({ city: "No street" });

    expect(res.status).toBe(400);
  });
});

describe("address coordinates (Phase 10 — geocoded or manually entered, both persist the same way)", () => {
  it("a legacy address saved without coordinates stays valid — no coordinates are invented", async () => {
    const res = await request(app)
      .post("/api/v1/users/me/addresses")
      .set("Authorization", `Bearer ${tokenB}`)
      .send({ line1: "10 No-Coords Ave", city: "Springfield" });

    expect(res.status).toBe(201);
    const address = res.body.data.addresses.find((a: { line1: string }) => a.line1 === "10 No-Coords Ave");
    expect(address.latitude).toBeUndefined();
    expect(address.longitude).toBeUndefined();
  });

  it("persists coordinates exactly as provided when an address is saved with them (as the autocomplete flow would send)", async () => {
    const res = await request(app)
      .post("/api/v1/users/me/addresses")
      .set("Authorization", `Bearer ${tokenB}`)
      .send({ line1: "20 Geocoded Blvd", city: "Springfield", latitude: 39.7658, longitude: -89.6501 });

    expect(res.status).toBe(201);
    const address = res.body.data.addresses.find((a: { line1: string }) => a.line1 === "20 Geocoded Blvd");
    expect(address.latitude).toBe(39.7658);
    expect(address.longitude).toBe(-89.6501);
  });

  it("updating a legacy (coordinate-less) address to add coordinates later works via PATCH — the 'edit to set location' flow", async () => {
    const create = await request(app)
      .post("/api/v1/users/me/addresses")
      .set("Authorization", `Bearer ${tokenB}`)
      .send({ line1: "30 Update Me St", city: "Springfield" });
    const addressId = create.body.data.addresses.find((a: { line1: string }) => a.line1 === "30 Update Me St").id;

    const res = await request(app)
      .patch(`/api/v1/users/me/addresses/${addressId}`)
      .set("Authorization", `Bearer ${tokenB}`)
      .send({ latitude: 39.7658, longitude: -89.6501 });

    expect(res.status).toBe(200);
    const updated = res.body.data.addresses.find((a: { id: string }) => a.id === addressId);
    expect(updated.latitude).toBe(39.7658);
    expect(updated.longitude).toBe(-89.6501);
    expect(updated.line1).toBe("30 Update Me St"); // untouched fields survive a partial update
  });

  it("rejects out-of-range coordinates rather than silently clamping them", async () => {
    const res = await request(app)
      .post("/api/v1/users/me/addresses")
      .set("Authorization", `Bearer ${tokenB}`)
      .send({ line1: "40 Bad Coords Rd", city: "Springfield", latitude: 200, longitude: -89.6501 });

    expect(res.status).toBe(400);
  });
});

describe("profile update (PATCH /auth/me)", () => {
  it("updates the authenticated user's own name and phone", async () => {
    const res = await request(app)
      .patch("/api/v1/auth/me")
      .set("Authorization", `Bearer ${tokenA}`)
      .send({ name: "Updated Name", phone: "+15551234567" });

    expect(res.status).toBe(200);
    expect(res.body.data.user.name).toBe("Updated Name");
    expect(res.body.data.user.phone).toBe("+15551234567");
  });

  it("does not allow role or restaurantId to be set via profile update", async () => {
    const res = await request(app)
      .patch("/api/v1/auth/me")
      .set("Authorization", `Bearer ${tokenA}`)
      .send({ role: "platform_admin", restaurantId: "000000000000000000000000" });

    expect(res.status).toBe(200);
    expect(res.body.data.user.role).toBe("customer");
    expect(res.body.data.user.restaurantId).toBeUndefined();
  });
});
