import { describe, expect, it } from "@jest/globals";
import { envSchema } from "./env.js";

// Every field with no default that safeParse would otherwise reject on regardless of the
// email-specific rules under test here.
const REQUIRED_BASE = {
  MONGO_URI: "mongodb://localhost:27017/test",
  REDIS_URL: "redis://localhost:6379",
  JWT_ACCESS_SECRET: "a".repeat(32),
  JWT_REFRESH_SECRET: "b".repeat(32),
};

describe("envSchema — production email safety (Phase 45)", () => {
  it("rejects NODE_ENV=production while EMAIL_PROVIDER is still the default console provider", () => {
    const result = envSchema.safeParse({ ...REQUIRED_BASE, NODE_ENV: "production" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.flatten().fieldErrors.EMAIL_PROVIDER?.[0]).toMatch(/EMAIL_PROVIDER=smtp/);
    }
  });

  it("rejects NODE_ENV=production with EMAIL_PROVIDER=smtp but missing SMTP_HOST/SMTP_PORT and EMAIL_FROM", () => {
    const result = envSchema.safeParse({ ...REQUIRED_BASE, NODE_ENV: "production", EMAIL_PROVIDER: "smtp" });
    expect(result.success).toBe(false);
    if (!result.success) {
      const fieldErrors = result.error.flatten().fieldErrors;
      expect(fieldErrors.SMTP_HOST?.[0]).toBeTruthy();
      expect(fieldErrors.EMAIL_FROM?.[0]).toBeTruthy();
    }
  });

  it("rejects NODE_ENV=production with SMTP_HOST/PORT set but EMAIL_FROM still missing", () => {
    const result = envSchema.safeParse({
      ...REQUIRED_BASE,
      NODE_ENV: "production",
      EMAIL_PROVIDER: "smtp",
      SMTP_HOST: "smtp.example.com",
      SMTP_PORT: "587",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.flatten().fieldErrors.EMAIL_FROM?.[0]).toBeTruthy();
    }
  });

  it("accepts NODE_ENV=production with EMAIL_PROVIDER=smtp fully configured, including real origins", () => {
    const result = envSchema.safeParse({
      ...REQUIRED_BASE,
      NODE_ENV: "production",
      EMAIL_PROVIDER: "smtp",
      SMTP_HOST: "smtp.example.com",
      SMTP_PORT: "587",
      EMAIL_FROM: "Tablecloth <hello@realdomain.example>",
      CLIENT_ORIGIN: "https://order.realdomain.example",
      ADMIN_ORIGIN: "https://admin.realdomain.example",
    });
    expect(result.success).toBe(true);
  });

  it("rejects NODE_ENV=production left on the default localhost ADMIN_ORIGIN/CLIENT_ORIGIN even with email fully configured", () => {
    const result = envSchema.safeParse({
      ...REQUIRED_BASE,
      NODE_ENV: "production",
      EMAIL_PROVIDER: "smtp",
      SMTP_HOST: "smtp.example.com",
      SMTP_PORT: "587",
      EMAIL_FROM: "Tablecloth <hello@realdomain.example>",
    });
    // No explicit CLIENT_ORIGIN/ADMIN_ORIGIN above — both fall back to their localhost defaults.
    expect(result.success).toBe(false);
    if (!result.success) {
      const fieldErrors = result.error.flatten().fieldErrors;
      expect(fieldErrors.CLIENT_ORIGIN?.[0]).toMatch(/localhost/);
      expect(fieldErrors.ADMIN_ORIGIN?.[0]).toMatch(/localhost/);
    }
  });

  it("accepts NODE_ENV=production with real, non-localhost CLIENT_ORIGIN/ADMIN_ORIGIN", () => {
    const result = envSchema.safeParse({
      ...REQUIRED_BASE,
      NODE_ENV: "production",
      EMAIL_PROVIDER: "smtp",
      SMTP_HOST: "smtp.example.com",
      SMTP_PORT: "587",
      EMAIL_FROM: "Tablecloth <hello@realdomain.example>",
      CLIENT_ORIGIN: "https://order.realdomain.example",
      ADMIN_ORIGIN: "https://admin.realdomain.example",
    });
    expect(result.success).toBe(true);
  });

  it("still allows the console provider outside production — development and test are unaffected", () => {
    expect(envSchema.safeParse({ ...REQUIRED_BASE, NODE_ENV: "development" }).success).toBe(true);
    expect(envSchema.safeParse({ ...REQUIRED_BASE, NODE_ENV: "test" }).success).toBe(true);
    // NODE_ENV itself defaults to "development" when entirely absent.
    expect(envSchema.safeParse({ ...REQUIRED_BASE }).success).toBe(true);
  });
});

describe("envSchema — AUTH_RATE_LIMIT_MAX (Phase 46)", () => {
  it("defaults to 30 (today's production/dev value) when unset", () => {
    const result = envSchema.safeParse({ ...REQUIRED_BASE });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.AUTH_RATE_LIMIT_MAX).toBe(30);
  });

  it("accepts an explicit override for local full-E2E-suite runs", () => {
    const result = envSchema.safeParse({ ...REQUIRED_BASE, AUTH_RATE_LIMIT_MAX: "1000" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.AUTH_RATE_LIMIT_MAX).toBe(1000);
  });

  it("rejects a non-positive value", () => {
    expect(envSchema.safeParse({ ...REQUIRED_BASE, AUTH_RATE_LIMIT_MAX: "0" }).success).toBe(false);
    expect(envSchema.safeParse({ ...REQUIRED_BASE, AUTH_RATE_LIMIT_MAX: "-5" }).success).toBe(false);
  });
});
