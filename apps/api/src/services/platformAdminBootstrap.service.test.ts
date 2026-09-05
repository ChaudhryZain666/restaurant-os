import { afterAll, beforeAll, describe, expect, it, jest } from "@jest/globals";
import { connectDB } from "../config/db.js";
import { User } from "../models/User.js";
import { closeTestConnections } from "../test-utils/fixtures.js";
import { bootstrapPlatformAdmin } from "./platformAdminBootstrap.service.js";

const userIds: string[] = [];

function testEmail(label: string) {
  return `bootstrap-test-${label}-${Date.now()}@test.local`;
}

beforeAll(async () => {
  await connectDB();
});

afterAll(async () => {
  await User.deleteMany({ _id: { $in: userIds } });
  await closeTestConnections();
});

describe("bootstrapPlatformAdmin (Phase 43 — the only production-safe admin provisioning path)", () => {
  it("creates a real platform_admin account when none exists", async () => {
    const email = testEmail("create");
    const result = await bootstrapPlatformAdmin(email, "a-real-secure-password-1");

    expect(result).toEqual({ email, outcome: "created" });
    const user = await User.findOne({ email });
    expect(user).not.toBeNull();
    expect(user!.role).toBe("platform_admin");
    userIds.push(user!.id as string);
  });

  it("is idempotent — re-running with the same email never changes the existing password", async () => {
    const email = testEmail("idempotent");
    await bootstrapPlatformAdmin(email, "first-password-123");
    const afterFirst = await User.findOne({ email });
    userIds.push(afterFirst!.id as string);
    const hashAfterFirst = afterFirst!.passwordHash;

    const second = await bootstrapPlatformAdmin(email, "a-totally-different-password-456");

    expect(second).toEqual({ email, outcome: "unchanged" });
    const afterSecond = await User.findOne({ email });
    // The password from the second call must never have been applied — re-running this is never a
    // surprise credential rotation.
    expect(afterSecond!.passwordHash).toBe(hashAfterFirst);
  });

  it("refuses to touch an existing account that isn't already platform_admin", async () => {
    const email = testEmail("conflict");
    const existing = await User.create({ name: "Some Customer", email, passwordHash: "irrelevant", role: "customer" });
    userIds.push(existing.id as string);

    await expect(bootstrapPlatformAdmin(email, "whatever-password-1")).rejects.toThrow(/already exists with role "customer"/);

    const stillCustomer = await User.findOne({ email });
    expect(stillCustomer!.role).toBe("customer");
  });

  it("never logs the supplied password anywhere", async () => {
    const email = testEmail("no-log");
    const password = "must-never-appear-in-any-log-output";
    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});

    const result = await bootstrapPlatformAdmin(email, password);
    userIds.push((await User.findOne({ email }))!.id as string);

    const allLoggedArgs = [...logSpy.mock.calls, ...errorSpy.mock.calls, ...warnSpy.mock.calls].flat().map((arg) => JSON.stringify(arg));
    expect(allLoggedArgs.some((arg) => arg.includes(password))).toBe(false);
    expect(result.outcome).toBe("created");

    logSpy.mockRestore();
    errorSpy.mockRestore();
    warnSpy.mockRestore();
  });
});
