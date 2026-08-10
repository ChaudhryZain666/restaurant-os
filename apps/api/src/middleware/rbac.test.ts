import { describe, expect, it, jest } from "@jest/globals";
import type { Request, Response } from "express";
import { requirePermission } from "./rbac.js";

function mockReq(overrides: Partial<Request> = {}): Request {
  return overrides as Request;
}

describe("requirePermission", () => {
  it("calls next() with no error when the role grants the permission", () => {
    const req = mockReq({ user: { id: "u1", role: "restaurant_owner" } });
    const next = jest.fn();
    requirePermission("restaurant.menu.write")(req, {} as Response, next);
    expect(next).toHaveBeenCalledWith();
  });

  it("calls next(ApiError) when the role does not grant the permission", () => {
    const req = mockReq({ user: { id: "u1", role: "kitchen_staff" } });
    const next = jest.fn();
    requirePermission("restaurant.menu.write")(req, {} as Response, next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 403 }));
  });

  it("calls next(ApiError) when there is no authenticated user", () => {
    const req = mockReq({});
    const next = jest.fn();
    requirePermission("restaurant.menu.write")(req, {} as Response, next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 401 }));
  });

  it("requires ALL listed permissions to be granted", () => {
    const req = mockReq({ user: { id: "u1", role: "restaurant_staff" } });
    const next = jest.fn();
    // restaurant_staff has menu.read but not menu.write
    requirePermission("restaurant.menu.read", "restaurant.menu.write")(req, {} as Response, next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 403 }));
  });
});
