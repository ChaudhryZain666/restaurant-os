import { afterAll, describe, expect, it } from "@jest/globals";
import request from "supertest";
import { createApp } from "./app.js";
import { redis } from "./config/redis.js";

const app = createApp();

afterAll(async () => {
  await redis.quit();
});

describe("app", () => {
  it("returns a consistent error envelope for unknown routes", async () => {
    const res = await request(app).get("/api/v1/this-route-does-not-exist");
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({
      success: false,
      error: { code: "NOT_FOUND" },
    });
    expect(res.body.requestId).toEqual(expect.any(String));
  });

  it("echoes back a caller-supplied X-Request-Id header", async () => {
    const res = await request(app).get("/api/v1/this-route-does-not-exist").set("X-Request-Id", "test-123");
    expect(res.headers["x-request-id"]).toBe("test-123");
  });

  it("serves the Swagger UI at /api/docs", async () => {
    const res = await request(app).get("/api/docs/");
    expect(res.status).toBe(200);
    expect(res.text).toContain("swagger");
  });

  it("rejects unauthenticated access to a protected route", async () => {
    const res = await request(app).post("/api/v1/restaurants").send({ name: "x", slug: "x", ownerId: "x" });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("UNAUTHORIZED");
  });
});
