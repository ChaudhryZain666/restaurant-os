import { describe, expect, it } from "@jest/globals";
import { getBillingProvider } from "../billing/index.js";
import { MockBillingProvider } from "../billing/MockBillingProvider.js";
import { env } from "../config/env.js";
import { assertSafeTestEnvironment, testEnvironmentProblems } from "./testEnvironmentGuard.js";

/** Phase 89 — the checks jest.setup.env.ts runs before every test file, and proof they held here. */
const SAFE = { BILLING_PROVIDER: "mock", MONGO_URI: "mongodb://localhost:27017/restaurant_platform_test" };

describe("testEnvironmentGuard", () => {
  it("accepts a local *_test database with the mock billing provider and no Paddle credentials", () => {
    expect(testEnvironmentProblems(SAFE)).toEqual([]);
    expect(testEnvironmentProblems({ ...SAFE, PADDLE_API_KEY: "", PADDLE_WEBHOOK_SECRET: "", PADDLE_CLIENT_TOKEN: "" })).toEqual([]);
    expect(testEnvironmentProblems({ ...SAFE, MONGO_URI: "mongodb://127.0.0.1:27017/restaurant_platform_test?replicaSet=rs0" })).toEqual([]);
  });

  it("refuses the Paddle provider (e.g. inherited from a shell that exported BILLING_PROVIDER=paddle) or an unset one", () => {
    expect(() => assertSafeTestEnvironment({ ...SAFE, BILLING_PROVIDER: "paddle" })).toThrow(/BILLING_PROVIDER is "paddle"/);
    expect(() => assertSafeTestEnvironment({ ...SAFE, BILLING_PROVIDER: undefined })).toThrow(/BILLING_PROVIDER is "\(unset\)"/);
  });

  it("refuses any loaded Paddle credential", () => {
    for (const key of ["PADDLE_API_KEY", "PADDLE_WEBHOOK_SECRET", "PADDLE_CLIENT_TOKEN"]) {
      expect(() => assertSafeTestEnvironment({ ...SAFE, [key]: "synthetic-value" })).toThrow(new RegExp(`${key} is set`));
    }
  });

  it("refuses the dev database, a remote database, or a missing/invalid URI", () => {
    expect(() => assertSafeTestEnvironment({ ...SAFE, MONGO_URI: "mongodb://localhost:27017/restaurant_platform" })).toThrow(/must end in "_test"/);
    expect(() => assertSafeTestEnvironment({ ...SAFE, MONGO_URI: "mongodb+srv://cluster0.example.net/app_test" })).toThrow(/local MongoDB/);
    expect(() => assertSafeTestEnvironment({ ...SAFE, MONGO_URI: "mongodb://db.example.net:27017/app_test" })).toThrow(/local MongoDB/);
    expect(() => assertSafeTestEnvironment({ ...SAFE, MONGO_URI: undefined })).toThrow(/MONGO_URI is not set/);
    expect(() => assertSafeTestEnvironment({ ...SAFE, MONGO_URI: "not a uri" })).toThrow(/not a valid URL/);
  });

  it("a real request to an external host is refused before it leaves the process", async () => {
    await expect(fetch("https://sandbox-api.paddle.com/subscriptions")).rejects.toThrow(/may not make real network requests/);
    await expect(fetch(new URL("https://api.stripe.com/v1/accounts"))).rejects.toThrow(/may not make real network requests/);
  });

  it("this test process passed the guard: mock billing provider, no Paddle credentials, local *_test database", () => {
    expect(testEnvironmentProblems(process.env)).toEqual([]);
    expect(env.BILLING_PROVIDER).toBe("mock");
    expect(getBillingProvider()).toBeInstanceOf(MockBillingProvider);
    expect(getBillingProvider().name).toBe("mock");
  });
});
