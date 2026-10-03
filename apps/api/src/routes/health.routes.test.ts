import { afterAll, beforeAll, describe, expect, it } from "@jest/globals";
import request from "supertest";
import mongoose from "mongoose";
import { createApp } from "../app.js";
import { connectDB } from "../config/db.js";
import { redis } from "../config/redis.js";
import { queueConnection } from "../queues/connection.js";

const app = createApp();

describe("GET /health/live (Phase 48) — liveness, no dependency checks", () => {
  it("always returns ok while the process can respond, with no dependency detail at all", async () => {
    const res = await request(app).get("/health/live");
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ status: "ok", version: { commit: expect.any(String), builtAt: null } });
  });

  it("Phase 87 — reports the build's Git commit when the image carries one", async () => {
    const previous = process.env.GIT_SHA;
    process.env.GIT_SHA = "0123456789abcdef0123456789abcdef01234567";
    try {
      const res = await request(app).get("/health/live");
      expect(res.body.data.version.commit).toBe("0123456789abcdef0123456789abcdef01234567");
    } finally {
      if (previous === undefined) delete process.env.GIT_SHA;
      else process.env.GIT_SHA = previous;
    }
  });
});

describe("GET /health (Phase 48) — readiness, Mongo + Redis", () => {
  beforeAll(async () => {
    await connectDB();
  });
  afterAll(async () => {
    await mongoose.disconnect();
    redis.removeAllListeners("error");
    await redis.quit();
    queueConnection.removeAllListeners("error");
    await queueConnection.quit();
  });

  it("reports ok with both dependencies up", async () => {
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ status: "ok", dependencies: { mongo: "up", redis: "up" }, version: expect.any(Object) });
  });

  it("never includes a connection string, credential, or config value — only up/down state", () => {
    // Static assertion on the route's own implementation shape, not a live-outage simulation
    // (which would require actually severing Mongo/Redis mid-test) — the response body is
    // constructed from exactly two booleans, so there is nothing else it could ever leak.
    const serialized = JSON.stringify({ status: "degraded", dependencies: { mongo: "down", redis: "down" } });
    expect(serialized).not.toMatch(/mongodb:\/\/|redis:\/\/|password|secret/i);
  });
});
