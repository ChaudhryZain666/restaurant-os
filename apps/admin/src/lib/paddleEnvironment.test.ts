import { PaddleConfigurationError, resolvePaddleEnvironment } from "./paddleEnvironment";

describe("resolvePaddleEnvironment (Phase 85A)", () => {
  it("development/test: a sandbox session initialises Paddle.js for sandbox", () => {
    expect(resolvePaddleEnvironment({ environment: "sandbox", clientToken: "test_abc123" })).toBe("sandbox");
  });

  it("production: a production session initialises Paddle.js for production", () => {
    expect(resolvePaddleEnvironment({ environment: "production", clientToken: "live_abc123" })).toBe("production");
  });

  it("never falls back to sandbox when the session names no environment", () => {
    expect(() => resolvePaddleEnvironment({ clientToken: "live_abc123" })).toThrow(PaddleConfigurationError);
    expect(() => resolvePaddleEnvironment({ clientToken: "live_abc123" })).toThrow(/did not say which Paddle environment/);
  });

  it("rejects an unknown environment value with a clear message", () => {
    expect(() => resolvePaddleEnvironment({ environment: "live", clientToken: "live_abc123" })).toThrow(
      /"live" is not a Paddle environment/
    );
  });

  it("rejects a sandbox token paired with production, and a live token paired with sandbox", () => {
    expect(() => resolvePaddleEnvironment({ environment: "production", clientToken: "test_abc123" })).toThrow(
      /sandbox client token was paired with the production environment/
    );
    expect(() => resolvePaddleEnvironment({ environment: "sandbox", clientToken: "live_abc123" })).toThrow(
      /production client token was paired with the sandbox environment/
    );
  });

  it("rejects a missing client token", () => {
    expect(() => resolvePaddleEnvironment({ environment: "production" })).toThrow(/no Paddle client token/);
  });
});
