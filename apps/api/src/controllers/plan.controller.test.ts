import { afterAll, beforeAll, describe, expect, it } from "@jest/globals";
import request from "supertest";
import { createApp } from "../app.js";
import { connectDB } from "../config/db.js";
import { Plan } from "../models/Plan.js";
import { User } from "../models/User.js";
import { closeTestConnections, createTestPlan, createTestUser, tokenFor } from "../test-utils/fixtures.js";

const app = createApp();

let activePlan: Awaited<ReturnType<typeof createTestPlan>>;
let inactivePlan: Awaited<ReturnType<typeof createTestPlan>>;
let ownerToken: string;
let ownerId: string;

beforeAll(async () => {
  await connectDB();
  activePlan = await createTestPlan({ code: `plan-list-active-${Date.now()}`, isActive: true });
  inactivePlan = await createTestPlan({ code: `plan-list-inactive-${Date.now()}`, isActive: false });
  const owner = await createTestUser("restaurant_owner");
  ownerToken = tokenFor(owner);
  ownerId = owner.id as string;
});

afterAll(async () => {
  await Promise.all([
    Plan.deleteMany({ _id: { $in: [activePlan._id, inactivePlan._id] } }),
    User.deleteOne({ _id: ownerId }),
  ]);
  await closeTestConnections();
});

describe("GET /plans", () => {
  it("lists only active plans", async () => {
    const res = await request(app).get("/api/v1/plans").set("Authorization", `Bearer ${ownerToken}`);
    expect(res.status).toBe(200);
    const codes = res.body.data.plans.map((p: { code: string }) => p.code);
    expect(codes).toContain(activePlan.code);
    expect(codes).not.toContain(inactivePlan.code);
  });

  it("rejects an unauthenticated request", async () => {
    const res = await request(app).get("/api/v1/plans");
    expect(res.status).toBe(401);
  });
});
