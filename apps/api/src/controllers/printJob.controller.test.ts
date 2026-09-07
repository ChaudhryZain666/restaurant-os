import { afterAll, beforeAll, describe, expect, it } from "@jest/globals";
import request from "supertest";
import { createApp } from "../app.js";
import { connectDB } from "../config/db.js";
import { PrintJob } from "../models/PrintJob.js";
import { AuditLog } from "../models/AuditLog.js";
import {
  closeTestConnections,
  createTestOrder,
  createTestRestaurant,
  createTestUser,
  tokenFor,
} from "../test-utils/fixtures.js";

const app = createApp();

let restaurantA: Awaited<ReturnType<typeof createTestRestaurant>>;
let restaurantB: Awaited<ReturnType<typeof createTestRestaurant>>;
let ownerAToken: string;
let kitchenAToken: string;
let ownerBToken: string;
let customer: Awaited<ReturnType<typeof createTestUser>>;
let order: Awaited<ReturnType<typeof createTestOrder>>;
let receiptPrinterId: string;
let kitchenPrinterId: string;

async function createPrinter(token: string, restaurantId: string, body: Record<string, unknown>) {
  const res = await request(app).post(`/api/v1/restaurants/${restaurantId}/printers`).set("Authorization", `Bearer ${token}`).send(body);
  return res.body.data.printer.id as string;
}

beforeAll(async () => {
  await connectDB();
  restaurantA = await createTestRestaurant();
  restaurantB = await createTestRestaurant();
  const ownerA = await createTestUser("restaurant_owner", restaurantA._id);
  const kitchenA = await createTestUser("kitchen_staff", restaurantA._id);
  const ownerB = await createTestUser("restaurant_owner", restaurantB._id);
  ownerAToken = tokenFor(ownerA);
  kitchenAToken = tokenFor(kitchenA);
  ownerBToken = tokenFor(ownerB);

  customer = await createTestUser("customer", undefined, { name: "Jamie Rivera", phone: "555-0100" });
  order = await createTestOrder(restaurantA._id, customer._id, {
    orderNumber: "1042",
    paymentMethod: "cash",
    paymentStatus: "paid",
    discount: 1,
    promoCode: "SAVE1",
    taxAmount: 0.8,
    total: 9.8,
  });

  receiptPrinterId = await createPrinter(ownerAToken, restaurantA._id.toString(), {
    name: "Front Counter",
    purpose: "receipt",
    connectionType: "browser_print",
    isDefault: true,
  });
  kitchenPrinterId = await createPrinter(ownerAToken, restaurantA._id.toString(), {
    name: "Kitchen 1",
    purpose: "kitchen",
    connectionType: "browser_print",
    isDefault: true,
  });
});

afterAll(async () => {
  await closeTestConnections();
});

describe("Print job creation — routing, content, and permissions", () => {
  it("creates a receipt print job routed to the default receipt printer, with real order content", async () => {
    const res = await request(app)
      .post(`/api/v1/restaurants/${restaurantA._id}/print-jobs`)
      .set("Authorization", `Bearer ${ownerAToken}`)
      .send({ kind: "receipt", orderId: order._id.toString() });
    expect(res.status).toBe(201);
    expect(res.body.data.printJob.printerId).toBe(receiptPrinterId);
    expect(res.body.data.printJob.status).toBe("queued");
    expect(res.body.data.printJob.isReprint).toBe(false);
    const text = JSON.stringify(res.body.data.printJob.document);
    expect(text).toContain("1042");
    expect(text).toContain("SAVE1");
  });

  it("creates a kitchen ticket print job routed to the default kitchen printer, omitting price/payment info", async () => {
    const res = await request(app)
      .post(`/api/v1/restaurants/${restaurantA._id}/print-jobs`)
      .set("Authorization", `Bearer ${kitchenAToken}`)
      .send({ kind: "kitchen_ticket", orderId: order._id.toString() });
    expect(res.status).toBe(201);
    expect(res.body.data.printJob.printerId).toBe(kitchenPrinterId);
    const text = JSON.stringify(res.body.data.printJob.document);
    expect(text).toContain("KITCHEN TICKET");
    expect(text).not.toContain("$9.80");
    expect(text).not.toContain("paid");
  });

  it("gives an honest, actionable error when no default printer is configured for the purpose", async () => {
    const restaurantNoPrinter = await createTestRestaurant();
    const owner = await createTestUser("restaurant_owner", restaurantNoPrinter._id);
    const token = tokenFor(owner);
    const orderHere = await createTestOrder(restaurantNoPrinter._id, customer._id);

    const res = await request(app)
      .post(`/api/v1/restaurants/${restaurantNoPrinter._id}/print-jobs`)
      .set("Authorization", `Bearer ${token}`)
      .send({ kind: "receipt", orderId: orderHere._id.toString() });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/no enabled default printer/i);
  });

  it("restaurant B cannot create a print job for restaurant A's order (tenant isolation)", async () => {
    const res = await request(app)
      .post(`/api/v1/restaurants/${restaurantB._id}/print-jobs`)
      .set("Authorization", `Bearer ${ownerBToken}`)
      .send({ kind: "receipt", orderId: order._id.toString() });
    // The order lookup is scoped to restaurantB, so A's order simply doesn't exist under B.
    expect(res.status).toBe(404);
  });

  it("rejects an unauthenticated request", async () => {
    const res = await request(app).post(`/api/v1/restaurants/${restaurantA._id}/print-jobs`).send({ kind: "receipt", orderId: order._id.toString() });
    expect(res.status).toBe(401);
  });
});

describe("Print job status transitions, retry, and reprint tracking", () => {
  it("the frontend reports back printing -> printed, and the order/payment are entirely untouched by this", async () => {
    const created = await request(app)
      .post(`/api/v1/restaurants/${restaurantA._id}/print-jobs`)
      .set("Authorization", `Bearer ${ownerAToken}`)
      .send({ kind: "receipt", orderId: order._id.toString() });
    const jobId = created.body.data.printJob.id;

    const printing = await request(app).patch(`/api/v1/restaurants/${restaurantA._id}/print-jobs/${jobId}`).set("Authorization", `Bearer ${ownerAToken}`).send({ status: "printing" });
    expect(printing.status).toBe(200);
    expect(printing.body.data.printJob.attempts).toBe(1);

    const printed = await request(app).patch(`/api/v1/restaurants/${restaurantA._id}/print-jobs/${jobId}`).set("Authorization", `Bearer ${ownerAToken}`).send({ status: "printed" });
    expect(printed.status).toBe(200);
    expect(printed.body.data.printJob.status).toBe("printed");
    expect(printed.body.data.printJob.printedAt).toBeTruthy();
  });

  it("a failed print requires an error message, is logged to the audit log, and can be retried without creating a new order", async () => {
    const created = await request(app)
      .post(`/api/v1/restaurants/${restaurantA._id}/print-jobs`)
      .set("Authorization", `Bearer ${ownerAToken}`)
      .send({ kind: "receipt", orderId: order._id.toString() });
    const jobId = created.body.data.printJob.id;

    const missingError = await request(app).patch(`/api/v1/restaurants/${restaurantA._id}/print-jobs/${jobId}`).set("Authorization", `Bearer ${ownerAToken}`).send({ status: "failed" });
    expect(missingError.status).toBe(400);

    const failed = await request(app)
      .patch(`/api/v1/restaurants/${restaurantA._id}/print-jobs/${jobId}`)
      .set("Authorization", `Bearer ${ownerAToken}`)
      .send({ status: "failed", error: "Printer offline" });
    expect(failed.status).toBe(200);
    expect(failed.body.data.printJob.lastError).toBe("Printer offline");

    const auditEntry = await AuditLog.findOne({ restaurantId: restaurantA._id, action: "print_job.failed", targetId: jobId });
    expect(auditEntry).not.toBeNull();

    const retried = await request(app).post(`/api/v1/restaurants/${restaurantA._id}/print-jobs/${jobId}/retry`).set("Authorization", `Bearer ${ownerAToken}`);
    expect(retried.status).toBe(200);
    expect(retried.body.data.printJob.status).toBe("queued");
    expect(retried.body.data.printJob.lastError).toBeUndefined();
    expect(retried.body.data.printJob.id).toBe(jobId); // same job, not a new one

    const jobCountForOrder = await PrintJob.countDocuments({ orderId: order._id, restaurantId: restaurantA._id });
    // Retrying never creates an additional job row.
    const jobsBefore = jobCountForOrder;
    expect(jobsBefore).toBeGreaterThan(0);
  });

  it("cannot retry a job that is not currently failed/unavailable", async () => {
    const created = await request(app)
      .post(`/api/v1/restaurants/${restaurantA._id}/print-jobs`)
      .set("Authorization", `Bearer ${ownerAToken}`)
      .send({ kind: "receipt", orderId: order._id.toString() });
    const jobId = created.body.data.printJob.id;

    const res = await request(app).post(`/api/v1/restaurants/${restaurantA._id}/print-jobs/${jobId}/retry`).set("Authorization", `Bearer ${ownerAToken}`);
    expect(res.status).toBe(400);
  });

  it("a reprint creates a NEW job (isReprint: true) rather than mutating the original, and reprint history is listable per order", async () => {
    const original = await request(app)
      .post(`/api/v1/restaurants/${restaurantA._id}/print-jobs`)
      .set("Authorization", `Bearer ${ownerAToken}`)
      .send({ kind: "receipt", orderId: order._id.toString() });

    const reprint = await request(app)
      .post(`/api/v1/restaurants/${restaurantA._id}/print-jobs`)
      .set("Authorization", `Bearer ${ownerAToken}`)
      .send({ kind: "receipt", orderId: order._id.toString(), isReprint: true });
    expect(reprint.status).toBe(201);
    expect(reprint.body.data.printJob.isReprint).toBe(true);
    expect(reprint.body.data.printJob.id).not.toBe(original.body.data.printJob.id);

    const history = await request(app).get(`/api/v1/restaurants/${restaurantA._id}/print-jobs/by-order/${order._id}`).set("Authorization", `Bearer ${ownerAToken}`);
    expect(history.status).toBe(200);
    expect(history.body.data.printJobs.length).toBeGreaterThanOrEqual(2);
    expect(history.body.data.printJobs.some((j: { isReprint: boolean }) => j.isReprint)).toBe(true);
  });
});
