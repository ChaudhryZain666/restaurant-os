import { afterEach, describe, expect, it } from "@jest/globals";
import { env } from "../config/env.js";
import { marketplaceModeFor, uberEatsConnectionsClosed } from "./providerMode.js";

const saved = { nodeEnv: env.NODE_ENV, global: env.MARKETPLACE_PROVIDER_MODE, uber: env.UBER_EATS_PROVIDER_MODE, environment: env.UBER_EATS_ENVIRONMENT };
afterEach(() => {
  Object.assign(env, { NODE_ENV: saved.nodeEnv, MARKETPLACE_PROVIDER_MODE: saved.global, UBER_EATS_PROVIDER_MODE: saved.uber, UBER_EATS_ENVIRONMENT: saved.environment });
});

describe("marketplaceModeFor", () => {
  it("every provider follows MARKETPLACE_PROVIDER_MODE when no Uber Eats override is set", () => {
    Object.assign(env, { MARKETPLACE_PROVIDER_MODE: "mock", UBER_EATS_PROVIDER_MODE: undefined });
    expect(["uber_eats", "doordash", "foodpanda"].map((p) => marketplaceModeFor(p as never))).toEqual(["mock", "mock", "mock"]);
    env.MARKETPLACE_PROVIDER_MODE = "live";
    expect(["uber_eats", "doordash", "foodpanda"].map((p) => marketplaceModeFor(p as never))).toEqual(["live", "live", "live"]);
  });

  it("UBER_EATS_PROVIDER_MODE changes Uber Eats only — DoorDash and foodpanda keep the global mode", () => {
    Object.assign(env, { MARKETPLACE_PROVIDER_MODE: "mock", UBER_EATS_PROVIDER_MODE: "live" });
    expect(marketplaceModeFor("uber_eats")).toBe("live");
    expect(marketplaceModeFor("doordash")).toBe("mock");
    expect(marketplaceModeFor("foodpanda")).toBe("mock");

    Object.assign(env, { MARKETPLACE_PROVIDER_MODE: "live", UBER_EATS_PROVIDER_MODE: "mock" });
    expect(marketplaceModeFor("uber_eats")).toBe("mock");
    expect(marketplaceModeFor("doordash")).toBe("live");
  });
});

describe("uberEatsConnectionsClosed", () => {
  it("closed only for a production deployment running live Uber Eats against the sandbox", () => {
    Object.assign(env, { NODE_ENV: "production", MARKETPLACE_PROVIDER_MODE: "mock", UBER_EATS_PROVIDER_MODE: "live", UBER_EATS_ENVIRONMENT: "sandbox" });
    expect(uberEatsConnectionsClosed()).toBe(true);
  });

  it("open when Uber Eats points at production, when Uber Eats is mock, or outside production", () => {
    Object.assign(env, { NODE_ENV: "production", UBER_EATS_PROVIDER_MODE: "live", UBER_EATS_ENVIRONMENT: "production" });
    expect(uberEatsConnectionsClosed()).toBe(false);
    Object.assign(env, { NODE_ENV: "production", MARKETPLACE_PROVIDER_MODE: "mock", UBER_EATS_PROVIDER_MODE: undefined, UBER_EATS_ENVIRONMENT: "sandbox" });
    expect(uberEatsConnectionsClosed()).toBe(false);
    Object.assign(env, { NODE_ENV: "development", UBER_EATS_PROVIDER_MODE: "live", UBER_EATS_ENVIRONMENT: "sandbox" });
    expect(uberEatsConnectionsClosed()).toBe(false);
  });
});
