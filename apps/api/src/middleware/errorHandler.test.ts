import { afterAll, beforeAll, describe, expect, it, jest } from "@jest/globals";
import type { NextFunction, Request, Response } from "express";
import mongoose from "mongoose";
import request from "supertest";
import { createApp } from "../app.js";
import { connectDB } from "../config/db.js";
import { closeTestConnections } from "../test-utils/fixtures.js";
import { ApiError } from "../utils/ApiError.js";
import { errorHandler } from "./errorHandler.js";

/** Phase 88 — client mistakes must be 4xx with a safe message, never a 500 (production QA findings). */
const app = createApp();

beforeAll(async () => {
  await connectDB();
});

afterAll(async () => {
  await closeTestConnections();
});

type FakeRes = Response & { body: unknown };
function fakeRes(): FakeRes {
  const state = { locals: { requestId: "req-1" }, statusCode: 0, body: undefined as unknown } as { locals: Record<string, unknown>; statusCode: number; body: unknown; status?: unknown; json?: unknown };
  state.status = jest.fn((code: number) => { state.statusCode = code; return state; });
  state.json = jest.fn((body: unknown) => { state.body = body; return state; });
  return state as unknown as FakeRes;
}
const req = { method: "GET", path: "/x" } as Request;
const next = (() => undefined) as NextFunction;

describe("errorHandler (unit)", () => {
  it("maps a body-parser JSON syntax error to 400 without the parser's message", () => {
    const err = Object.assign(new SyntaxError("Unexpected token n in JSON at position 1: {not json"), { type: "entity.parse.failed", status: 400, expose: true });
    const res = fakeRes();
    errorHandler(err, req, res, next);
    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ success: false, error: { code: "VALIDATION_ERROR", message: "Request body is not valid JSON." }, requestId: "req-1" });
    expect(JSON.stringify(res.body)).not.toMatch(/Unexpected token|position|not json/);
  });

  it("keeps body-parser's own 4xx status for other body errors (413 too large)", () => {
    const res = fakeRes();
    errorHandler(Object.assign(new Error("request entity too large"), { type: "entity.too.large", status: 413 }), req, res, next);
    expect(res.statusCode).toBe(413);
    expect((res.body as { error: { code: string } }).error.code).toBe("VALIDATION_ERROR");
  });

  it("maps a Mongoose CastError to 400 naming the field, never echoing the value", () => {
    const err = new mongoose.Error.CastError("ObjectId", "not-an-id", "_id");
    const res = fakeRes();
    errorHandler(err, req, res, next);
    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ success: false, error: { code: "VALIDATION_ERROR", message: "Invalid id." }, requestId: "req-1" });
    expect(JSON.stringify(res.body)).not.toMatch(/not-an-id|Cast to|ObjectId/);
  });

  it("names a non-_id field", () => {
    const res = fakeRes();
    errorHandler(new mongoose.Error.CastError("ObjectId", "zzz", "restaurantId"), req, res, next);
    expect((res.body as { error: { message: string } }).error.message).toBe("Invalid restaurantId.");
  });

  it("does not treat lookalike errors as client errors", () => {
    const res = fakeRes();
    errorHandler(Object.assign(new Error("boom"), { type: "entity.parse.failed", status: 500 }), req, res, next);
    expect(res.statusCode).toBe(500);
    const res2 = fakeRes();
    errorHandler(Object.assign(new Error("boom"), { type: "something.else", status: 400 }), req, res2, next);
    expect(res2.statusCode).toBe(500);
  });

  it("still passes ApiError through and keeps unknown errors as a generic 500", () => {
    const res = fakeRes();
    errorHandler(ApiError.notFound("Menu not found"), req, res, next);
    expect(res.statusCode).toBe(404);
    const res2 = fakeRes();
    errorHandler(new Error("database exploded at /app/secret/path.ts:12"), req, res2, next);
    expect(res2.statusCode).toBe(500);
    expect(res2.body).toEqual({ success: false, error: { code: "INTERNAL_ERROR", message: "Internal server error" }, requestId: "req-1" });
  });
});

describe("errorHandler through the real app (exact production QA requests)", () => {
  it("POST /api/v1/auth/login with malformed JSON → 400, safe message, no stack", async () => {
    const res = await request(app).post("/api/v1/auth/login").set("Content-Type", "application/json").send("{not json");
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toEqual({ code: "VALIDATION_ERROR", message: "Request body is not valid JSON." });
    expect(res.text).not.toMatch(/\bat\s+\S+\s+\(|node_modules|SyntaxError|position/);
  });

  it("malformed JSON is handled the same way on every endpoint (public contact form)", async () => {
    const res = await request(app).post("/api/v1/public/contact").set("Content-Type", "application/json").send('{"name": ');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("an oversized JSON body → 413, not 500", async () => {
    const res = await request(app).post("/api/v1/auth/login").set("Content-Type", "application/json").send(JSON.stringify({ email: "a@b.co", password: "x".repeat(200_000) }));
    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("GET /api/v1/restaurants/not-an-id/menu → 400 Invalid id, not a CastError 500", async () => {
    const res = await request(app).get("/api/v1/restaurants/not-an-id/menu");
    expect(res.status).toBe(400);
    expect(res.body.error).toEqual({ code: "VALIDATION_ERROR", message: "Invalid id." });
    expect(res.text).not.toMatch(/Cast to ObjectId|not-an-id/);
  });

  it("a well-formed but unknown id still gets the endpoint's own not-found answer", async () => {
    const res = await request(app).get(`/api/v1/restaurants/${new mongoose.Types.ObjectId().toString()}/menu`);
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
  });
});
