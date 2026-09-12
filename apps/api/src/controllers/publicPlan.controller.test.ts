import { afterAll, beforeAll, describe, expect, it } from "@jest/globals";
import request from "supertest";
import { createApp } from "../app.js";
import { connectDB } from "../config/db.js";
import { Plan } from "../models/Plan.js";
import { closeTestConnections, createTestPlan } from "../test-utils/fixtures.js";

const app = createApp();

let activePlan: Awaited<ReturnType<typeof createTestPlan>>;
let inactivePlan: Awaited<ReturnType<typeof createTestPlan>>;
let negotiatedPlan: Awaited<ReturnType<typeof createTestPlan>>;

beforeAll(async () => {
  await connectDB();
  activePlan = await createTestPlan({
    pricing: [{ interval: "monthly", amountCents: 7900, currency: "USD", providerPriceId: "mock_price_secret" }],
    isActive: true,
    metadata: { internalNote: "never expose this" },
  });
  inactivePlan = await createTestPlan({ isActive: false });
  // Phase 63 — a real, fully-functional, isActive plan (a future negotiated agency arrangement would
  // look exactly like this) that must still never appear in the public catalog.
  negotiatedPlan = await createTestPlan({ isActive: true, isPubliclyListed: false });
});

afterAll(async () => {
  await Plan.deleteMany({ _id: { $in: [activePlan._id, inactivePlan._id, negotiatedPlan._id] } });
  await closeTestConnections();
});

describe("Phase 28 — GET /public/plans", () => {
  it("requires no authentication at all", async () => {
    const res = await request(app).get("/api/v1/public/plans");
    expect(res.status).toBe(200);
  });

  it("returns only active plans", async () => {
    const res = await request(app).get("/api/v1/public/plans");
    const codes = res.body.data.plans.map((p: { code: string }) => p.code);
    expect(codes).toContain(activePlan.code);
    expect(codes).not.toContain(inactivePlan.code);
  });

  it("Phase 63 — never lists an isActive plan marked isPubliclyListed:false (a future negotiated/custom agency arrangement), even though it remains real and fully usable for a subscription", async () => {
    const res = await request(app).get("/api/v1/public/plans");
    const codes = res.body.data.plans.map((p: { code: string }) => p.code);
    expect(codes).not.toContain(negotiatedPlan.code);

    const reloaded = await Plan.findById(negotiatedPlan._id);
    expect(reloaded!.isActive).toBe(true); // still real, still selectable by a direct subscription
  });

  it("never leaks providerPriceId, providerProductId, or metadata", async () => {
    const res = await request(app).get("/api/v1/public/plans");
    const plan = res.body.data.plans.find((p: { code: string }) => p.code === activePlan.code);
    expect(plan).toBeDefined();
    expect(plan.pricing[0].providerPriceId).toBeUndefined();
    expect(plan.providerProductId).toBeUndefined();
    expect(plan.metadata).toBeUndefined();
    expect(plan.pricing[0].amountCents).toBe(7900);
    expect(plan.pricing[0].currency).toBe("USD");
  });
});
