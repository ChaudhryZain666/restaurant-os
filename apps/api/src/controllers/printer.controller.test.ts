import { afterAll, beforeAll, describe, expect, it } from "@jest/globals";
import request from "supertest";
import { createApp } from "../app.js";
import { connectDB } from "../config/db.js";
import { Printer } from "../models/Printer.js";
import { AuditLog } from "../models/AuditLog.js";
import { closeTestConnections, createTestRestaurant, createTestUser, tokenFor } from "../test-utils/fixtures.js";

const app = createApp();

let restaurantA: Awaited<ReturnType<typeof createTestRestaurant>>;
let restaurantB: Awaited<ReturnType<typeof createTestRestaurant>>;
let ownerAToken: string;
let staffAToken: string;
let kitchenAToken: string;
let ownerBToken: string;

beforeAll(async () => {
  await connectDB();
  restaurantA = await createTestRestaurant();
  restaurantB = await createTestRestaurant();
  const ownerA = await createTestUser("restaurant_owner", restaurantA._id);
  const staffA = await createTestUser("restaurant_staff", restaurantA._id);
  const kitchenA = await createTestUser("kitchen_staff", restaurantA._id);
  const ownerB = await createTestUser("restaurant_owner", restaurantB._id);
  ownerAToken = tokenFor(ownerA);
  staffAToken = tokenFor(staffA);
  kitchenAToken = tokenFor(kitchenA);
  ownerBToken = tokenFor(ownerB);
});

afterAll(async () => {
  await closeTestConnections();
});

describe("Printer authorization", () => {
  it("rejects an unauthenticated request", async () => {
    const res = await request(app).get(`/api/v1/restaurants/${restaurantA._id}/printers`);
    expect(res.status).toBe(401);
  });

  it("front-of-house staff CAN list printers (operational visibility) but CANNOT create one (configuration)", async () => {
    const list = await request(app).get(`/api/v1/restaurants/${restaurantA._id}/printers`).set("Authorization", `Bearer ${staffAToken}`);
    expect(list.status).toBe(200);

    const create = await request(app)
      .post(`/api/v1/restaurants/${restaurantA._id}/printers`)
      .set("Authorization", `Bearer ${staffAToken}`)
      .send({ name: "Front Counter", purpose: "receipt", connectionType: "browser_print" });
    expect(create.status).toBe(403);
  });

  it("kitchen_staff cannot create a printer either", async () => {
    const res = await request(app)
      .post(`/api/v1/restaurants/${restaurantA._id}/printers`)
      .set("Authorization", `Bearer ${kitchenAToken}`)
      .send({ name: "Kitchen 1", purpose: "kitchen", connectionType: "browser_print" });
    expect(res.status).toBe(403);
  });

  it("restaurant B's owner cannot create or list a printer under restaurant A (tenant isolation)", async () => {
    const create = await request(app)
      .post(`/api/v1/restaurants/${restaurantA._id}/printers`)
      .set("Authorization", `Bearer ${ownerBToken}`)
      .send({ name: "Intruder", purpose: "receipt", connectionType: "browser_print" });
    expect(create.status).toBe(403);

    const list = await request(app).get(`/api/v1/restaurants/${restaurantA._id}/printers`).set("Authorization", `Bearer ${ownerBToken}`);
    expect(list.status).toBe(403);
  });
});

describe("Printer CRUD and default-printer exclusivity", () => {
  it("owner creates a printer", async () => {
    const res = await request(app)
      .post(`/api/v1/restaurants/${restaurantA._id}/printers`)
      .set("Authorization", `Bearer ${ownerAToken}`)
      .send({ name: "Front Counter", purpose: "receipt", connectionType: "browser_print", paperWidthMm: 80, isDefault: true });
    expect(res.status).toBe(201);
    expect(res.body.data.printer.isDefault).toBe(true);
    expect(res.body.data.printer.paperWidthMm).toBe(80);
  });

  it("setting a second printer as default for the same purpose unsets the first one's default flag", async () => {
    const second = await request(app)
      .post(`/api/v1/restaurants/${restaurantA._id}/printers`)
      .set("Authorization", `Bearer ${ownerAToken}`)
      .send({ name: "Back Counter", purpose: "receipt", connectionType: "browser_print", isDefault: true });
    expect(second.status).toBe(201);
    expect(second.body.data.printer.isDefault).toBe(true);

    const printers = await Printer.find({ restaurantId: restaurantA._id, purpose: "receipt" });
    const defaults = printers.filter((p) => p.isDefault);
    expect(defaults).toHaveLength(1);
    expect(defaults[0].name).toBe("Back Counter");
  });

  it("rejects an invalid loopback URL for a local_bridge printer's connectionConfig", async () => {
    const res = await request(app)
      .post(`/api/v1/restaurants/${restaurantA._id}/printers`)
      .set("Authorization", `Bearer ${ownerAToken}`)
      .send({
        name: "Bridge",
        purpose: "kitchen",
        connectionType: "local_bridge",
        connectionConfig: { bridgeUrl: "http://192.168.1.50:9100" },
      });
    expect(res.status).toBe(400);
  });

  it("accepts a genuine loopback URL for a local_bridge printer", async () => {
    const res = await request(app)
      .post(`/api/v1/restaurants/${restaurantA._id}/printers`)
      .set("Authorization", `Bearer ${ownerAToken}`)
      .send({
        name: "Bridge",
        purpose: "kitchen",
        connectionType: "local_bridge",
        connectionConfig: { bridgeUrl: "http://localhost:9100" },
      });
    expect(res.status).toBe(201);
  });

  it("owner updates a printer and can disable it", async () => {
    const created = await request(app)
      .post(`/api/v1/restaurants/${restaurantA._id}/printers`)
      .set("Authorization", `Bearer ${ownerAToken}`)
      .send({ name: "Bar", purpose: "bar", connectionType: "web_serial" });
    const printerId = created.body.data.printer.id;

    const updated = await request(app)
      .patch(`/api/v1/restaurants/${restaurantA._id}/printers/${printerId}`)
      .set("Authorization", `Bearer ${ownerAToken}`)
      .send({ isEnabled: false });
    expect(updated.status).toBe(200);
    expect(updated.body.data.printer.isEnabled).toBe(false);
  });

  it("owner deletes a printer", async () => {
    const created = await request(app)
      .post(`/api/v1/restaurants/${restaurantA._id}/printers`)
      .set("Authorization", `Bearer ${ownerAToken}`)
      .send({ name: "Temp", purpose: "bar", connectionType: "browser_print" });
    const printerId = created.body.data.printer.id;

    const deleted = await request(app).delete(`/api/v1/restaurants/${restaurantA._id}/printers/${printerId}`).set("Authorization", `Bearer ${ownerAToken}`);
    expect(deleted.status).toBe(204);

    const stillThere = await Printer.findById(printerId);
    expect(stillThere).toBeNull();
  });

  it("404s updating/deleting a printer that belongs to a different restaurant", async () => {
    const created = await request(app)
      .post(`/api/v1/restaurants/${restaurantB._id}/printers`)
      .set("Authorization", `Bearer ${ownerBToken}`)
      .send({ name: "B's Printer", purpose: "receipt", connectionType: "browser_print" });
    const printerId = created.body.data.printer.id;

    const crossTenantUpdate = await request(app)
      .patch(`/api/v1/restaurants/${restaurantA._id}/printers/${printerId}`)
      .set("Authorization", `Bearer ${ownerAToken}`)
      .send({ name: "Hijacked" });
    expect(crossTenantUpdate.status).toBe(404);
  });

  it("records an audit log entry on printer create/update/delete", async () => {
    const created = await request(app)
      .post(`/api/v1/restaurants/${restaurantA._id}/printers`)
      .set("Authorization", `Bearer ${ownerAToken}`)
      .send({ name: "Audited Printer", purpose: "bar", connectionType: "browser_print" });
    const printerId = created.body.data.printer.id;

    const createLog = await AuditLog.findOne({ restaurantId: restaurantA._id, action: "printer.created", targetId: printerId });
    expect(createLog).not.toBeNull();

    await request(app).patch(`/api/v1/restaurants/${restaurantA._id}/printers/${printerId}`).set("Authorization", `Bearer ${ownerAToken}`).send({ name: "Renamed" });
    const updateLog = await AuditLog.findOne({ restaurantId: restaurantA._id, action: "printer.updated", targetId: printerId });
    expect(updateLog).not.toBeNull();

    await request(app).delete(`/api/v1/restaurants/${restaurantA._id}/printers/${printerId}`).set("Authorization", `Bearer ${ownerAToken}`);
    const deleteLog = await AuditLog.findOne({ restaurantId: restaurantA._id, action: "printer.deleted", targetId: printerId });
    expect(deleteLog).not.toBeNull();
  });
});

describe("Test print", () => {
  it("creates a real, trackable PrintJob without touching any Order", async () => {
    const printer = await request(app)
      .post(`/api/v1/restaurants/${restaurantA._id}/printers`)
      .set("Authorization", `Bearer ${ownerAToken}`)
      .send({ name: "Test Print Target", purpose: "receipt", connectionType: "browser_print" });
    const printerId = printer.body.data.printer.id;

    const res = await request(app).post(`/api/v1/restaurants/${restaurantA._id}/printers/${printerId}/test-print`).set("Authorization", `Bearer ${ownerAToken}`);
    expect(res.status).toBe(201);
    expect(res.body.data.printJob.kind).toBe("test");
    expect(res.body.data.printJob.orderId).toBeUndefined();
    expect(res.body.data.printJob.status).toBe("queued");
    expect(res.body.data.printJob.document.title).toBe("Test print");
    expect(res.body.data.printJob.document.escposBase64.length).toBeGreaterThan(0);
  });

  it("staff cannot trigger a test print (configuration action)", async () => {
    const printer = await request(app)
      .post(`/api/v1/restaurants/${restaurantA._id}/printers`)
      .set("Authorization", `Bearer ${ownerAToken}`)
      .send({ name: "Another", purpose: "receipt", connectionType: "browser_print" });
    const printerId = printer.body.data.printer.id;

    const res = await request(app).post(`/api/v1/restaurants/${restaurantA._id}/printers/${printerId}/test-print`).set("Authorization", `Bearer ${staffAToken}`);
    expect(res.status).toBe(403);
  });
});
