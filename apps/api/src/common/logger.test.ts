import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { logger } from "./logger.js";

describe("logger redaction (Phase 48)", () => {
  let spy: jest.SpiedFunction<typeof console.log>;

  beforeEach(() => {
    spy = jest.spyOn(console, "log").mockImplementation(() => undefined);
  });
  afterEach(() => {
    spy.mockRestore();
  });

  function loggedLine(): Record<string, unknown> {
    const raw = spy.mock.calls[0]?.[0] as string;
    return JSON.parse(raw);
  }

  it("redacts an exact-match sensitive key (pre-existing behavior)", () => {
    logger.info("test", { password: "hunter2" });
    expect(loggedLine().password).toBe("[REDACTED]");
  });

  it("redacts compound keys containing a sensitive word — smtpPassword, stripeSecretKey, webhookSecret, clientSecret, apiKey", () => {
    logger.info("test", {
      smtpPassword: "hunter2",
      stripeSecretKey: "sk_test_abc",
      webhookSecret: "whsec_abc",
      clientSecret: "cs_abc",
      apiKey: "key_abc",
      refreshToken: "rt_abc",
    });
    const line = loggedLine();
    expect(line.smtpPassword).toBe("[REDACTED]");
    expect(line.stripeSecretKey).toBe("[REDACTED]");
    expect(line.webhookSecret).toBe("[REDACTED]");
    expect(line.clientSecret).toBe("[REDACTED]");
    expect(line.apiKey).toBe("[REDACTED]");
    expect(line.refreshToken).toBe("[REDACTED]");
  });

  it("redacts nested objects and arrays, not just top-level keys", () => {
    logger.info("test", { nested: { password: "hunter2" }, list: [{ secret: "x" }] });
    const line = loggedLine();
    expect((line.nested as Record<string, unknown>).password).toBe("[REDACTED]");
    expect((line.list as Record<string, unknown>[])[0].secret).toBe("[REDACTED]");
  });

  it("never redacts an ordinary, non-sensitive field", () => {
    logger.info("test", { orderId: "abc123", restaurantId: "def456", jobId: "job-1", durationMs: 12.5 });
    const line = loggedLine();
    expect(line.orderId).toBe("abc123");
    expect(line.restaurantId).toBe("def456");
    expect(line.jobId).toBe("job-1");
    expect(line.durationMs).toBe(12.5);
  });

  it("writes info/debug to console.log, warn to console.warn, error to console.error", () => {
    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => undefined);
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);
    logger.warn("w");
    logger.error("e");
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalledTimes(1);
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });
});
