import { afterAll, beforeAll, describe, expect, it } from "@jest/globals";
import request from "supertest";
import { createApp } from "../app.js";
import { connectDB } from "../config/db.js";
import { Order } from "../models/Order.js";
import { Restaurant } from "../models/Restaurant.js";
import { Table } from "../models/Table.js";
import { User } from "../models/User.js";
import {
  closeTestConnections,
  createTestOrder,
  createTestRestaurant,
  createTestTable,
  createTestUser,
  tokenFor,
} from "../test-utils/fixtures.js";

const app = createApp();

let restaurantA: Awaited<ReturnType<typeof createTestRestaurant>>;
let restaurantB: Awaited<ReturnType<typeof createTestRestaurant>>;
let ownerAToken: string;
let managerAToken: string;
let staffAToken: string;
let ownerBToken: string;
let customerToken: string;

beforeAll(async () => {
  await connectDB();
  restaurantA = await createTestRestaurant({
    settings: {
      orderingEnabled: true,
      pickupEnabled: true,
      deliveryEnabled: true,
      dineInEnabled: true,
      minOrderAmount: 0,
      taxRate: 0.1,
      deliveryFee: 5,
    },
  });
  restaurantB = await createTestRestaurant();

  const ownerA = await createTestUser("restaurant_owner", restaurantA._id);
  const managerA = await createTestUser("restaurant_manager", restaurantA._id);
  const staffA = await createTestUser("restaurant_staff", restaurantA._id);
  const ownerB = await createTestUser("restaurant_owner", restaurantB._id);
  const customer = await createTestUser("customer");

  ownerAToken = tokenFor(ownerA);
  managerAToken = tokenFor(managerA);
  staffAToken = tokenFor(staffA);
  ownerBToken = tokenFor(ownerB);
  customerToken = tokenFor(customer);
});

afterAll(async () => {
  const ids = [restaurantA._id, restaurantB._id];
  await Promise.all([
    Table.deleteMany({ restaurantId: { $in: ids } }),
    Order.deleteMany({ restaurantId: { $in: ids } }),
    User.deleteMany({ restaurantId: { $in: ids } }),
    Restaurant.deleteMany({ _id: { $in: ids } }),
  ]);
  await closeTestConnections();
});

describe("table CRUD + RBAC", () => {
  it("owner can create a table", async () => {
    const res = await request(app)
      .post(`/api/v1/restaurants/${restaurantA.id}/tables`)
      .set("Authorization", `Bearer ${ownerAToken}`)
      .send({ name: "Table 1", capacity: 4, section: "Main" });

    expect(res.status).toBe(201);
    expect(res.body.data.table.name).toBe("Table 1");
    expect(res.body.data.table.capacity).toBe(4);
    expect(res.body.data.table.isActive).toBe(true);
    // The token exists server-side but the create response only needs to confirm it isn't blank.
    expect(res.body.data.table.qrToken).toEqual(expect.any(String));
  });

  it("manager can create a table (restaurant.tables.manage)", async () => {
    const res = await request(app)
      .post(`/api/v1/restaurants/${restaurantA.id}/tables`)
      .set("Authorization", `Bearer ${managerAToken}`)
      .send({ name: "Table 2", capacity: 2 });

    expect(res.status).toBe(201);
  });

  it("staff cannot create a table (lacks restaurant.tables.manage)", async () => {
    const res = await request(app)
      .post(`/api/v1/restaurants/${restaurantA.id}/tables`)
      .set("Authorization", `Bearer ${staffAToken}`)
      .send({ name: "Should fail", capacity: 2 });

    expect(res.status).toBe(403);
  });

  it("restaurant B's owner cannot create a table under restaurant A (IDOR)", async () => {
    const res = await request(app)
      .post(`/api/v1/restaurants/${restaurantA.id}/tables`)
      .set("Authorization", `Bearer ${ownerBToken}`)
      .send({ name: "Cross-tenant attempt", capacity: 2 });

    expect(res.status).toBe(403);
  });

  it("a customer cannot manage tables at all", async () => {
    const res = await request(app)
      .get(`/api/v1/restaurants/${restaurantA.id}/tables`)
      .set("Authorization", `Bearer ${customerToken}`);

    expect(res.status).toBe(403);
  });

  it("owner can update a table's name/capacity/section", async () => {
    const table = await createTestTable(restaurantA._id);
    const res = await request(app)
      .patch(`/api/v1/restaurants/${restaurantA.id}/tables/${table.id}`)
      .set("Authorization", `Bearer ${ownerAToken}`)
      .send({ name: "Renamed", capacity: 8, section: "Patio" });

    expect(res.status).toBe(200);
    expect(res.body.data.table.name).toBe("Renamed");
    expect(res.body.data.table.capacity).toBe(8);
    expect(res.body.data.table.section).toBe("Patio");
  });

  it("owner can deactivate then reactivate a table", async () => {
    const table = await createTestTable(restaurantA._id);
    const deactivate = await request(app)
      .patch(`/api/v1/restaurants/${restaurantA.id}/tables/${table.id}`)
      .set("Authorization", `Bearer ${ownerAToken}`)
      .send({ isActive: false });
    expect(deactivate.body.data.table.isActive).toBe(false);

    const reactivate = await request(app)
      .patch(`/api/v1/restaurants/${restaurantA.id}/tables/${table.id}`)
      .set("Authorization", `Bearer ${ownerAToken}`)
      .send({ isActive: true });
    expect(reactivate.body.data.table.isActive).toBe(true);
  });

  it("restaurant B cannot update restaurant A's table by guessing its ID", async () => {
    const table = await createTestTable(restaurantA._id);
    const res = await request(app)
      .patch(`/api/v1/restaurants/${restaurantA.id}/tables/${table.id}`)
      .set("Authorization", `Bearer ${ownerBToken}`)
      .send({ name: "Hijacked" });

    expect(res.status).toBe(403);
    const stored = await Table.findById(table.id);
    expect(stored!.name).not.toBe("Hijacked");
  });

  it("deletes a table with no active orders", async () => {
    const table = await createTestTable(restaurantA._id);
    const res = await request(app)
      .delete(`/api/v1/restaurants/${restaurantA.id}/tables/${table.id}`)
      .set("Authorization", `Bearer ${ownerAToken}`);

    expect(res.status).toBe(204);
    expect(await Table.findById(table.id)).toBeNull();
  });

  it("blocks deleting a table that has an active dine-in order", async () => {
    const table = await createTestTable(restaurantA._id);
    await createTestOrder(restaurantA._id, (await createTestUser("customer"))._id, {
      orderType: "dine_in",
      tableId: table._id,
      tableName: table.name,
      status: "preparing",
    });

    const res = await request(app)
      .delete(`/api/v1/restaurants/${restaurantA.id}/tables/${table.id}`)
      .set("Authorization", `Bearer ${ownerAToken}`);

    expect(res.status).toBe(409);
    expect(await Table.findById(table.id)).not.toBeNull();
  });

  it("restaurant B cannot delete restaurant A's table by guessing its ID", async () => {
    const table = await createTestTable(restaurantA._id);
    const res = await request(app)
      .delete(`/api/v1/restaurants/${restaurantA.id}/tables/${table.id}`)
      .set("Authorization", `Bearer ${ownerBToken}`);

    expect(res.status).toBe(403);
    expect(await Table.findById(table.id)).not.toBeNull();
  });
});

describe("table status derivation", () => {
  it("reports available with no active orders, occupied with one, and counts multiple simultaneous orders", async () => {
    const table = await createTestTable(restaurantA._id);
    const customer = await createTestUser("customer");

    const listEmpty = await request(app)
      .get(`/api/v1/restaurants/${restaurantA.id}/tables`)
      .set("Authorization", `Bearer ${ownerAToken}`);
    const rowEmpty = listEmpty.body.data.tables.find((t: { id: string }) => t.id === table.id);
    expect(rowEmpty.status).toBe("available");
    expect(rowEmpty.activeOrderCount).toBe(0);

    const order1 = await createTestOrder(restaurantA._id, customer._id, {
      orderType: "dine_in",
      tableId: table._id,
      tableName: table.name,
      status: "preparing",
    });
    const order2 = await createTestOrder(restaurantA._id, customer._id, {
      orderType: "dine_in",
      tableId: table._id,
      tableName: table.name,
      status: "pending",
    });
    // A completed order at the same table must not count toward "occupied".
    await createTestOrder(restaurantA._id, customer._id, {
      orderType: "dine_in",
      tableId: table._id,
      tableName: table.name,
      status: "completed",
    });

    const listOccupied = await request(app)
      .get(`/api/v1/restaurants/${restaurantA.id}/tables`)
      .set("Authorization", `Bearer ${ownerAToken}`);
    const rowOccupied = listOccupied.body.data.tables.find((t: { id: string }) => t.id === table.id);
    expect(rowOccupied.status).toBe("occupied");
    expect(rowOccupied.activeOrderCount).toBe(2);
    expect(rowOccupied.activeOrderNumbers.sort()).toEqual([order1.orderNumber, order2.orderNumber].sort());
  });
});

describe("QR generation and regeneration", () => {
  it("returns a data-URL QR image and a /t/ URL for a table", async () => {
    const table = await createTestTable(restaurantA._id);
    const res = await request(app)
      .get(`/api/v1/restaurants/${restaurantA.id}/tables/${table.id}/qr`)
      .set("Authorization", `Bearer ${ownerAToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.qrDataUrl).toMatch(/^data:image\/png;base64,/);
    // Phase 8: restaurant-scoped QR URL — /r/:restaurantSlug/t/:qrToken, not the old bare /t/:token.
    expect(res.body.data.url).toContain(`/r/${restaurantA.slug}/t/${table.qrToken}`);
    // The QR payload must never leak database internals — no restaurantId, no admin path.
    expect(res.body.data.url).not.toContain(restaurantA.id);
  });

  it("regenerating rotates the token so the old QR code stops resolving", async () => {
    const table = await createTestTable(restaurantA._id);
    const oldToken = table.qrToken;

    const regen = await request(app)
      .post(`/api/v1/restaurants/${restaurantA.id}/tables/${table.id}/regenerate-qr`)
      .set("Authorization", `Bearer ${ownerAToken}`);
    expect(regen.status).toBe(200);
    expect(regen.body.data.table.qrToken).not.toBe(oldToken);

    const staleResolve = await request(app).get(`/api/v1/restaurants/${restaurantA.id}/tables/resolve/${oldToken}`);
    expect(staleResolve.status).toBe(404);

    const freshResolve = await request(app).get(
      `/api/v1/restaurants/${restaurantA.id}/tables/resolve/${regen.body.data.table.qrToken}`
    );
    expect(freshResolve.status).toBe(200);
  });

  it("staff cannot regenerate a table's QR (lacks restaurant.tables.manage)", async () => {
    const table = await createTestTable(restaurantA._id);
    const res = await request(app)
      .post(`/api/v1/restaurants/${restaurantA.id}/tables/${table.id}/regenerate-qr`)
      .set("Authorization", `Bearer ${staffAToken}`);

    expect(res.status).toBe(403);
  });
});

describe("public table resolve endpoint", () => {
  it("resolves a valid, active table with no authentication required", async () => {
    const table = await createTestTable(restaurantA._id, { name: "Patio 3", capacity: 6, section: "Patio" });
    const res = await request(app).get(`/api/v1/restaurants/${restaurantA.id}/tables/resolve/${table.qrToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.table).toEqual({ id: table.id, name: "Patio 3", capacity: 6, section: "Patio" });
    // Never leak the token itself or the restaurantId back out of a public endpoint.
    expect(res.body.data.table.qrToken).toBeUndefined();
    expect(res.body.data.table.restaurantId).toBeUndefined();
  });

  it("rejects an unknown token", async () => {
    const res = await request(app).get(`/api/v1/restaurants/${restaurantA.id}/tables/resolve/does-not-exist`);
    expect(res.status).toBe(404);
  });

  it("rejects a token for a deactivated table", async () => {
    const table = await createTestTable(restaurantA._id, { isActive: false });
    const res = await request(app).get(`/api/v1/restaurants/${restaurantA.id}/tables/resolve/${table.qrToken}`);
    expect(res.status).toBe(404);
  });

  it("rejects a valid token when queried under the wrong restaurantId (defense in depth)", async () => {
    const table = await createTestTable(restaurantA._id);
    const res = await request(app).get(`/api/v1/restaurants/${restaurantB.id}/tables/resolve/${table.qrToken}`);
    expect(res.status).toBe(404);
  });
});
