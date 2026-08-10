import { describe, expect, it, jest } from "@jest/globals";
import type { Request, Response } from "express";
import { requireTenantMatch } from "./tenant.js";

function mockReq(overrides: Partial<Request> = {}): Request {
  return overrides as Request;
}

describe("requireTenantMatch", () => {
  it("allows a staff user acting on their own restaurant", () => {
    const req = mockReq({
      user: { id: "u1", role: "restaurant_manager", restaurantId: "r1" },
      params: { restaurantId: "r1" },
    });
    const next = jest.fn();
    requireTenantMatch()(req, {} as Response, next);
    expect(next).toHaveBeenCalledWith();
  });

  it("blocks a staff user from acting on a different restaurant, even via URL edit", () => {
    const req = mockReq({
      user: { id: "u1", role: "restaurant_manager", restaurantId: "r1" },
      params: { restaurantId: "r2" },
    });
    const next = jest.fn();
    requireTenantMatch()(req, {} as Response, next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 403 }));
  });

  it("lets platform_admin act across any restaurant", () => {
    const req = mockReq({
      user: { id: "u1", role: "platform_admin" },
      params: { restaurantId: "any-restaurant" },
    });
    const next = jest.fn();
    requireTenantMatch()(req, {} as Response, next);
    expect(next).toHaveBeenCalledWith();
  });
});
