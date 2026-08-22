import { describe, expect, it, jest } from "@jest/globals";
import type { Request, Response } from "express";
import { requireTenantMatch } from "./tenant.js";

function mockReq(overrides: Partial<Request> = {}): Request {
  return overrides as Request;
}

describe("requireTenantMatch", () => {
  it("allows a staff user acting on their own restaurant", async () => {
    const req = mockReq({
      user: { id: "u1", role: "restaurant_manager", restaurantId: "r1" },
      params: { restaurantId: "r1" },
    });
    const next = jest.fn();
    await requireTenantMatch()(req, {} as Response, next);
    expect(next).toHaveBeenCalledWith();
  });

  it("blocks a manager with no businessId from acting on a different restaurant, even via URL edit", async () => {
    const req = mockReq({
      user: { id: "u1", role: "restaurant_manager", restaurantId: "r1" },
      params: { restaurantId: "r2" },
    });
    const next = jest.fn();
    await requireTenantMatch()(req, {} as Response, next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 403 }));
  });

  it("lets platform_admin act across any restaurant", async () => {
    const req = mockReq({
      user: { id: "u1", role: "platform_admin" },
      params: { restaurantId: "any-restaurant" },
    });
    const next = jest.fn();
    await requireTenantMatch()(req, {} as Response, next);
    expect(next).toHaveBeenCalledWith();
  });

  // Phase 19 — staff/kitchen_staff's locationIds-based grant/deny is a pure, synchronous check
  // (no DB lookup needed, the ids are already on req.user from the JWT), so it's covered here as a
  // unit test. The owner/manager businessId-based fallback DOES need a real DB lookup
  // (Restaurant.findById) — rather than mock Mongoose here, that branch is covered by a real
  // integration test hitting actual restaurant-scoped routes in
  // controllers/business.controller.test.ts, matching this codebase's established preference for
  // exercising real behavior over mocks wherever practical.

  it("grants a staff user explicit access to a second location via locationIds, even with a different restaurantId in their JWT", async () => {
    const req = mockReq({
      user: { id: "u1", role: "restaurant_staff", restaurantId: "r1", locationIds: ["r1", "r2"] },
      params: { restaurantId: "r2" },
    });
    const next = jest.fn();
    await requireTenantMatch()(req, {} as Response, next);
    expect(next).toHaveBeenCalledWith();
  });

  it("denies a staff user a location NOT in their locationIds", async () => {
    const req = mockReq({
      user: { id: "u1", role: "restaurant_staff", restaurantId: "r1", locationIds: ["r1"] },
      params: { restaurantId: "r3" },
    });
    const next = jest.fn();
    await requireTenantMatch()(req, {} as Response, next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 403 }));
  });

  it("denies a kitchen_staff user with no locationIds at all, rather than throwing", async () => {
    const req = mockReq({
      user: { id: "u1", role: "kitchen_staff", restaurantId: "r1" },
      params: { restaurantId: "r2" },
    });
    const next = jest.fn();
    await requireTenantMatch()(req, {} as Response, next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 403 }));
  });

  it("denies an owner/manager with no businessId at all, without attempting a DB lookup", async () => {
    const req = mockReq({
      user: { id: "u1", role: "restaurant_owner", restaurantId: "r1" },
      params: { restaurantId: "r2" },
    });
    const next = jest.fn();
    await requireTenantMatch()(req, {} as Response, next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 403 }));
  });
});
