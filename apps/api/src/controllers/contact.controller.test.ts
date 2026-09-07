import { describe, expect, it } from "@jest/globals";
import request from "supertest";
import { createApp } from "../app.js";

const app = createApp();

describe("Phase 56 — POST /public/contact", () => {
  it("requires no authentication at all", async () => {
    const res = await request(app)
      .post("/api/v1/public/contact")
      .send({ name: "Jamie Rivera", email: "jamie@example.com", message: "Interested in the platform." });
    expect(res.status).toBe(201);
    expect(res.body.data.received).toBe(true);
  });

  it("accepts the minimal shape — only name and email required", async () => {
    const res = await request(app).post("/api/v1/public/contact").send({ name: "Jamie", email: "jamie2@example.com" });
    expect(res.status).toBe(201);
  });

  it("accepts the full LeadForm qualification shape", async () => {
    const res = await request(app).post("/api/v1/public/contact").send({
      name: "Jamie Rivera",
      email: "jamie3@example.com",
      businessName: "The Ember Kitchen",
      phone: "555-0100",
      role: "Restaurant owner",
      locationCount: 2,
      interests: ["Online ordering", "Delivery"],
      message: "Would like to see the demo.",
    });
    expect(res.status).toBe(201);
  });

  it("rejects a missing name", async () => {
    const res = await request(app).post("/api/v1/public/contact").send({ email: "jamie@example.com" });
    expect(res.status).toBe(400);
  });

  it("rejects an invalid email", async () => {
    const res = await request(app).post("/api/v1/public/contact").send({ name: "Jamie", email: "not-an-email" });
    expect(res.status).toBe(400);
  });

  it("rejects an unreasonably long message", async () => {
    const res = await request(app)
      .post("/api/v1/public/contact")
      .send({ name: "Jamie", email: "jamie@example.com", message: "a".repeat(5000) });
    expect(res.status).toBe(400);
  });

  it("strips unknown fields rather than erroring on them", async () => {
    const res = await request(app)
      .post("/api/v1/public/contact")
      .send({ name: "Jamie", email: "jamie4@example.com", notAField: "should be stripped" });
    expect(res.status).toBe(201);
  });
});
