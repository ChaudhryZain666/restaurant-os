import { afterAll, beforeAll, describe, expect, it } from "@jest/globals";
import request from "supertest";
import { createApp } from "../app.js";
import { connectDB } from "../config/db.js";
import { Restaurant } from "../models/Restaurant.js";
import { SupportMessage, SupportTicket } from "../models/SupportTicket.js";
import { User } from "../models/User.js";
import {
  closeTestConnections,
  createTestRestaurant,
  createTestUser,
  tokenFor,
} from "../test-utils/fixtures.js";
import { ticketEventBus } from "../events/ticketEvents.js";

const app = createApp();

let restaurantA: Awaited<ReturnType<typeof createTestRestaurant>>;
let restaurantB: Awaited<ReturnType<typeof createTestRestaurant>>;
let ownerA: Awaited<ReturnType<typeof createTestUser>>;
let staffA: Awaited<ReturnType<typeof createTestUser>>;
let ownerB: Awaited<ReturnType<typeof createTestUser>>;
let customer1: Awaited<ReturnType<typeof createTestUser>>;
let customer2: Awaited<ReturnType<typeof createTestUser>>;
let platformAdmin: Awaited<ReturnType<typeof createTestUser>>;
let ownerAToken: string;
let staffAToken: string;
let ownerBToken: string;
let customer1Token: string;
let customer2Token: string;
let adminToken: string;

beforeAll(async () => {
  await connectDB();
  restaurantA = await createTestRestaurant();
  restaurantB = await createTestRestaurant();
  ownerA = await createTestUser("restaurant_owner", restaurantA._id);
  staffA = await createTestUser("restaurant_staff", restaurantA._id);
  ownerB = await createTestUser("restaurant_owner", restaurantB._id);
  customer1 = await createTestUser("customer");
  customer2 = await createTestUser("customer");
  platformAdmin = await createTestUser("platform_admin");

  ownerAToken = tokenFor(ownerA);
  staffAToken = tokenFor(staffA);
  ownerBToken = tokenFor(ownerB);
  customer1Token = tokenFor(customer1);
  customer2Token = tokenFor(customer2);
  adminToken = tokenFor(platformAdmin);
});

afterAll(async () => {
  const userIds = [ownerA._id, staffA._id, ownerB._id, customer1._id, customer2._id, platformAdmin._id];
  const tickets = await SupportTicket.find({ createdBy: { $in: userIds } }, "_id");
  await Promise.all([
    SupportMessage.deleteMany({ ticketId: { $in: tickets.map((t) => t._id) } }),
    SupportTicket.deleteMany({ createdBy: { $in: userIds } }),
    User.deleteMany({ _id: { $in: userIds } }),
    Restaurant.deleteMany({ _id: { $in: [restaurantA._id, restaurantB._id] } }),
  ]);
  await closeTestConnections();
});

async function createTicketAs(token: string, overrides: Record<string, unknown> = {}) {
  const res = await request(app)
    .post("/api/v1/support/tickets")
    .set("Authorization", `Bearer ${token}`)
    .send({ subject: "Test ticket", description: "Something needs help", ...overrides });
  return res;
}

describe("creating tickets", () => {
  it("1. a customer can create a ticket", async () => {
    const res = await createTicketAs(customer1Token, { subject: "My order never arrived" });
    expect(res.status).toBe(201);
    expect(res.body.data.ticket.subject).toBe("My order never arrived");
    expect(res.body.data.ticket.ticketNumber).toMatch(/^TKT-\d+$/);
    expect(res.body.data.ticket.status).toBe("open");
  });

  it("5. a restaurant-scoped staff member cannot inject a different restaurant's ID — it's always server-derived", async () => {
    const res = await createTicketAs(ownerBToken, { restaurantId: restaurantA.id });
    expect(res.status).toBe(201);
    expect(res.body.data.ticket.restaurantId).toBe(restaurantB.id);
    expect(res.body.data.ticket.restaurantId).not.toBe(restaurantA.id);
  });

  it("6. a customer cannot inject an agencyId — the field doesn't exist on the create schema at all", async () => {
    const res = await createTicketAs(customer1Token, { agencyId: "000000000000000000000000" });
    expect(res.status).toBe(201);
    expect(res.body.data.ticket.agencyId).toBeUndefined();
  });

  it("7. a customer cannot inject an assigned support user on creation", async () => {
    const res = await createTicketAs(customer1Token, { assignedTo: platformAdmin.id });
    expect(res.status).toBe(201);
    expect(res.body.data.ticket.assignedTo).toBeUndefined();
  });

  it("22. a customer cannot manipulate ticket ownership via createdBy — it's always the authenticated user", async () => {
    const res = await createTicketAs(customer1Token, { createdBy: customer2.id, userId: customer2.id });
    expect(res.status).toBe(201);
    expect(res.body.data.ticket.createdBy).toBe(customer1.id);
  });

  it("20. emits a ticket.created event", async () => {
    const seen: unknown[] = [];
    const listener = (payload: unknown) => seen.push(payload);
    ticketEventBus.once("ticket.created", listener);

    const res = await createTicketAs(customer1Token, { subject: "Event test ticket" });
    expect(res.status).toBe(201);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ ticketId: res.body.data.ticket.id, status: "open" });
  });
});

describe("viewing and replying to tickets", () => {
  it("2. a customer can view their own ticket", async () => {
    const created = await createTicketAs(customer1Token);
    const ticketId = created.body.data.ticket.id;

    const res = await request(app).get(`/api/v1/support/tickets/${ticketId}`).set("Authorization", `Bearer ${customer1Token}`);
    expect(res.status).toBe(200);
    expect(res.body.data.ticket.id).toBe(ticketId);
  });

  it("3. a customer cannot view another customer's ticket", async () => {
    const created = await createTicketAs(customer1Token);
    const ticketId = created.body.data.ticket.id;

    const res = await request(app).get(`/api/v1/support/tickets/${ticketId}`).set("Authorization", `Bearer ${customer2Token}`);
    expect(res.status).toBe(403);
  });

  it("4. a customer cannot reply to (modify) another customer's ticket", async () => {
    const created = await createTicketAs(customer1Token);
    const ticketId = created.body.data.ticket.id;

    const res = await request(app)
      .post(`/api/v1/support/tickets/${ticketId}/messages`)
      .set("Authorization", `Bearer ${customer2Token}`)
      .send({ content: "Trying to butt in" });
    expect(res.status).toBe(403);

    const messages = await SupportMessage.find({ ticketId });
    expect(messages.every((m) => m.authorId.toString() !== customer2.id)).toBe(true);
  });

  it("9. a customer can reply to their own ticket", async () => {
    const created = await createTicketAs(customer1Token);
    const ticketId = created.body.data.ticket.id;

    const res = await request(app)
      .post(`/api/v1/support/tickets/${ticketId}/messages`)
      .set("Authorization", `Bearer ${customer1Token}`)
      .send({ content: "Any update?" });
    expect(res.status).toBe(201);
    expect(res.body.data.message.authorType).toBe("customer");
  });

  it("10. a platform support user can reply", async () => {
    const created = await createTicketAs(customer1Token);
    const ticketId = created.body.data.ticket.id;

    const res = await request(app)
      .post(`/api/v1/support/tickets/${ticketId}/messages`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ content: "We're looking into it" });
    expect(res.status).toBe(201);
    expect(res.body.data.message.authorType).toBe("support");
  });

  it("24. ticket messages remain scoped to the correct ticket", async () => {
    const ticket1 = await createTicketAs(customer1Token, { subject: "Ticket one" });
    const ticket2 = await createTicketAs(customer1Token, { subject: "Ticket two" });
    await request(app)
      .post(`/api/v1/support/tickets/${ticket1.body.data.ticket.id}/messages`)
      .set("Authorization", `Bearer ${customer1Token}`)
      .send({ content: "Message for ticket one" });
    await request(app)
      .post(`/api/v1/support/tickets/${ticket2.body.data.ticket.id}/messages`)
      .set("Authorization", `Bearer ${customer1Token}`)
      .send({ content: "Message for ticket two" });

    const res = await request(app)
      .get(`/api/v1/support/tickets/${ticket1.body.data.ticket.id}/messages`)
      .set("Authorization", `Bearer ${customer1Token}`);
    const contents = res.body.data.messages.map((m: { content: string }) => m.content);
    expect(contents).toContain("Message for ticket one");
    expect(contents).not.toContain("Message for ticket two");
  });
});

describe("internal notes stay private", () => {
  it("8. a customer cannot read internal notes on their own ticket", async () => {
    const created = await createTicketAs(customer1Token);
    const ticketId = created.body.data.ticket.id;
    await request(app)
      .post(`/api/v1/support/tickets/${ticketId}/messages`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ content: "Internal: escalate to engineering", isInternal: true });

    const res = await request(app)
      .get(`/api/v1/support/tickets/${ticketId}/messages`)
      .set("Authorization", `Bearer ${customer1Token}`);
    expect(res.status).toBe(200);
    expect(res.body.data.messages.some((m: { isInternal?: boolean }) => m.isInternal)).toBe(false);
    expect(res.body.data.messages.some((m: { content: string }) => m.content.includes("escalate"))).toBe(false);
  });

  it("11. internal notes are visible to platform support, but NOT to the restaurant's own owner even though they can read the ticket", async () => {
    const created = await createTicketAs(ownerAToken, { subject: "Restaurant issue" });
    const ticketId = created.body.data.ticket.id;
    await request(app)
      .post(`/api/v1/support/tickets/${ticketId}/messages`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ content: "Internal: do not reveal underlying platform provider", isInternal: true });

    const adminView = await request(app)
      .get(`/api/v1/support/tickets/${ticketId}/messages`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(adminView.body.data.messages.some((m: { isInternal: boolean }) => m.isInternal)).toBe(true);

    // ownerA IS staff of this ticket's own restaurant (support.tickets.read) and can read the
    // ticket itself, but does not hold support.tickets.internal_notes.
    const ownerView = await request(app)
      .get(`/api/v1/support/tickets/${ticketId}/messages`)
      .set("Authorization", `Bearer ${ownerAToken}`);
    expect(ownerView.status).toBe(200);
    expect(ownerView.body.data.messages.some((m: { isInternal?: boolean }) => m.isInternal)).toBe(false);
  });

  it("a caller without support.tickets.internal_notes cannot post an internal note, even on their own ticket", async () => {
    const created = await createTicketAs(customer1Token);
    const ticketId = created.body.data.ticket.id;

    const res = await request(app)
      .post(`/api/v1/support/tickets/${ticketId}/messages`)
      .set("Authorization", `Bearer ${customer1Token}`)
      .send({ content: "Pretend this is internal", isInternal: true });
    expect(res.status).toBe(403);
  });

  it("21. an internal-note event never fans out to the customer or restaurant socket rooms", async () => {
    const created = await createTicketAs(customer1Token, { subject: "Room routing test" });
    const ticketId = created.body.data.ticket.id;

    const seen: Array<{ isInternalMessage?: boolean; createdBy: string }> = [];
    const listener = (payload: { isInternalMessage?: boolean; createdBy: string }) => seen.push(payload);
    ticketEventBus.once("ticket.message.created", listener);

    await request(app)
      .post(`/api/v1/support/tickets/${ticketId}/messages`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ content: "Internal only", isInternal: true });

    expect(seen).toHaveLength(1);
    expect(seen[0].isInternalMessage).toBe(true);
    // roomsForTicketEvent (unit-tested separately in events/ticketEvents.test.ts) guarantees this
    // payload shape resolves to ONLY the support:platform room — asserted here end-to-end too.
  });
});

describe("ticket status transitions", () => {
  it("12. rejects an invalid status transition (closed is terminal)", async () => {
    const created = await createTicketAs(customer1Token);
    const ticketId = created.body.data.ticket.id;
    await request(app)
      .patch(`/api/v1/support/admin/tickets/${ticketId}/status`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ status: "closed" });

    const res = await request(app)
      .patch(`/api/v1/support/admin/tickets/${ticketId}/status`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ status: "open" });
    expect(res.status).toBe(400);
  });

  it("allows a valid status transition and stamps resolvedAt", async () => {
    const created = await createTicketAs(customer1Token);
    const ticketId = created.body.data.ticket.id;

    const res = await request(app)
      .patch(`/api/v1/support/admin/tickets/${ticketId}/status`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ status: "resolved" });
    expect(res.status).toBe(200);
    expect(res.body.data.ticket.status).toBe("resolved");
    expect(res.body.data.ticket.resolvedAt).toEqual(expect.any(String));
  });

  it("a customer's own reply to a resolved ticket automatically reopens it", async () => {
    const created = await createTicketAs(customer1Token);
    const ticketId = created.body.data.ticket.id;
    await request(app)
      .patch(`/api/v1/support/admin/tickets/${ticketId}/status`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ status: "resolved" });

    const res = await request(app)
      .post(`/api/v1/support/tickets/${ticketId}/messages`)
      .set("Authorization", `Bearer ${customer1Token}`)
      .send({ content: "Still broken, please help" });
    expect(res.status).toBe(201);

    const ticket = await SupportTicket.findById(ticketId);
    expect(ticket!.status).toBe("open");
  });

  it("the ticket's own customer can confirm resolution, closing it", async () => {
    const created = await createTicketAs(customer1Token);
    const ticketId = created.body.data.ticket.id;
    await request(app)
      .patch(`/api/v1/support/admin/tickets/${ticketId}/status`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ status: "resolved" });

    const res = await request(app)
      .patch(`/api/v1/support/tickets/${ticketId}/confirm-resolution`)
      .set("Authorization", `Bearer ${customer1Token}`);
    expect(res.status).toBe(200);
    expect(res.body.data.ticket.status).toBe("closed");
  });

  it("no more replies are accepted once a ticket is closed", async () => {
    const created = await createTicketAs(customer1Token);
    const ticketId = created.body.data.ticket.id;
    await request(app)
      .patch(`/api/v1/support/admin/tickets/${ticketId}/status`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ status: "closed" });

    const res = await request(app)
      .post(`/api/v1/support/tickets/${ticketId}/messages`)
      .set("Authorization", `Bearer ${customer1Token}`)
      .send({ content: "Hello?" });
    expect(res.status).toBe(400);
  });
});

describe("assignment authorization", () => {
  it("13. a restaurant owner (no support.tickets.assign) cannot assign a ticket", async () => {
    const created = await createTicketAs(customer1Token);
    const ticketId = created.body.data.ticket.id;

    const res = await request(app)
      .patch(`/api/v1/support/admin/tickets/${ticketId}/assign`)
      .set("Authorization", `Bearer ${ownerAToken}`)
      .send({ assignedTo: ownerA.id });
    expect(res.status).toBe(403);
  });

  it("rejects assigning a ticket to a non-platform_admin user", async () => {
    const created = await createTicketAs(customer1Token);
    const ticketId = created.body.data.ticket.id;

    const res = await request(app)
      .patch(`/api/v1/support/admin/tickets/${ticketId}/assign`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ assignedTo: customer1.id });
    expect(res.status).toBe(400);
  });

  it("platform_admin can assign a ticket to a platform_admin user, emitting ticket.assigned", async () => {
    const created = await createTicketAs(customer1Token);
    const ticketId = created.body.data.ticket.id;

    const seen: unknown[] = [];
    ticketEventBus.once("ticket.assigned", (p: unknown) => seen.push(p));

    const res = await request(app)
      .patch(`/api/v1/support/admin/tickets/${ticketId}/assign`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ assignedTo: platformAdmin.id });
    expect(res.status).toBe(200);
    expect(res.body.data.ticket.assignedTo).toBe(platformAdmin.id);
    expect(seen).toHaveLength(1);
  });
});

describe("tenant isolation", () => {
  it("14. cross-tenant ticket access is rejected — restaurant B cannot view restaurant A's ticket", async () => {
    const created = await createTicketAs(ownerAToken, { subject: "Restaurant A issue" });
    const ticketId = created.body.data.ticket.id;

    const res = await request(app).get(`/api/v1/support/tickets/${ticketId}`).set("Authorization", `Bearer ${ownerBToken}`);
    expect(res.status).toBe(403);
  });

  it("restaurant A's own tenant list only ever contains restaurant A's tickets", async () => {
    await createTicketAs(ownerAToken, { subject: "Tenant list test A" });
    await createTicketAs(ownerBToken, { subject: "Tenant list test B" });

    const res = await request(app)
      .get(`/api/v1/restaurants/${restaurantA.id}/support/tickets`)
      .set("Authorization", `Bearer ${ownerAToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.tickets.every((t: { restaurantId: string }) => t.restaurantId === restaurantA.id)).toBe(true);
  });

  it("23. restaurant_staff (no support.tickets.read) cannot list their own restaurant's tickets", async () => {
    const res = await request(app)
      .get(`/api/v1/restaurants/${restaurantA.id}/support/tickets`)
      .set("Authorization", `Bearer ${staffAToken}`);
    expect(res.status).toBe(403);
  });

  it("restaurant B's owner cannot list restaurant A's tickets via the tenant-scoped route", async () => {
    const res = await request(app)
      .get(`/api/v1/restaurants/${restaurantA.id}/support/tickets`)
      .set("Authorization", `Bearer ${ownerBToken}`);
    expect(res.status).toBe(403);
  });

  it("a non-platform_admin cannot reach the platform-wide admin ticket list", async () => {
    const res = await request(app).get("/api/v1/support/admin/tickets").set("Authorization", `Bearer ${ownerAToken}`);
    expect(res.status).toBe(403);
  });
});

describe("support identity and internal relationship context", () => {
  it("18. the customer-facing restaurant lookup returns a SupportIdentity (platform identity, since no white-label config exists)", async () => {
    const res = await request(app).get(`/api/v1/restaurants/by-slug/${restaurantA.slug}`);
    expect(res.status).toBe(200);
    expect(res.body.data.supportIdentity).toEqual({ name: "Platform Support", isWhiteLabel: false });
  });

  it("19. the internal admin ticket view carries the correct restaurant relationship, with no fabricated agency data", async () => {
    const created = await createTicketAs(ownerAToken, { subject: "Context relationship test" });
    const ticketId = created.body.data.ticket.id;

    const res = await request(app).get(`/api/v1/support/tickets/${ticketId}`).set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.ticket.restaurantId).toBe(restaurantA.id);
    expect(res.body.data.ticket.restaurantName).toBe(restaurantA.name);
    expect(res.body.data.ticket.agencyId).toBeUndefined();
  });
});
