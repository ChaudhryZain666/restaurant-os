import { describe, expect, it } from "@jest/globals";
import request from "supertest";
import { createTlsAskApp } from "./tlsAskServer.js";
import type { CustomDomainDecision } from "../services/customDomain.service.js";

/**
 * Phase 86 — the HTTP contract Caddy relies on: 2xx = issue, anything else = refuse. The decision
 * itself is covered against a real database in services/customDomain.service.test.ts.
 */
const live = (hostname: string): CustomDomainDecision => ({ live: true, hostname, restaurantId: "secret-restaurant-id" });
const denied: CustomDomainDecision = { live: false, hostname: "orders.example.com", reason: "not_active" };

describe("TLS ask endpoint", () => {
  it("answers 200 for a live domain, with no tenant data in the body", async () => {
    const res = await request(createTlsAskApp(async (d) => live(String(d)))).get("/internal/tls/ask?domain=orders.example.com");
    expect(res.status).toBe(200);
    expect(res.text).toBe("ok");
    expect(res.text).not.toContain("secret-restaurant-id");
  });

  it("answers 403 for a refused domain, without saying why", async () => {
    const res = await request(createTlsAskApp(async () => denied)).get("/internal/tls/ask?domain=orders.example.com");
    expect(res.status).toBe(403);
    expect(res.text).toBe("denied");
    expect(res.text).not.toContain("not_active");
  });

  it("passes the raw query value to the shared decision (array / missing values are refused by it)", async () => {
    const seen: unknown[] = [];
    const app = createTlsAskApp(async (d) => {
      seen.push(d);
      return { live: false, hostname: null, reason: "malformed_hostname" };
    });
    expect((await request(app).get("/internal/tls/ask?domain=a.example.com&domain=b.example.com")).status).toBe(403);
    expect((await request(app).get("/internal/tls/ask")).status).toBe(403);
    expect(seen).toEqual([["a.example.com", "b.example.com"], undefined]);
  });

  it("fails closed with 503 when the decision cannot be made (e.g. database down)", async () => {
    const res = await request(
      createTlsAskApp(async () => {
        throw new Error("MongoNetworkError: connection refused to mongo:27017");
      })
    ).get("/internal/tls/ask?domain=orders.example.com");
    expect(res.status).toBe(503);
    expect(res.text).toBe("unavailable");
    expect(res.text).not.toContain("mongo");
  });

  it("exposes nothing else: other paths and methods are 404, and there is no write path", async () => {
    const app = createTlsAskApp(async (d) => live(String(d)));
    expect((await request(app).post("/internal/tls/ask?domain=orders.example.com")).status).toBe(404);
    expect((await request(app).get("/api/v1/public/plans")).status).toBe(404);
    expect((await request(app).get("/internal/tls/health")).status).toBe(200);
    expect((await request(app).get("/internal/tls/ask?domain=orders.example.com")).headers["x-powered-by"]).toBeUndefined();
  });
});
