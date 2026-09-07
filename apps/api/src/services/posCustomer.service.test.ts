import { afterAll, beforeAll, describe, expect, it, jest } from "@jest/globals";
import bcrypt from "bcryptjs";
import { connectDB } from "../config/db.js";
import { User } from "../models/User.js";
import { closeTestConnections } from "../test-utils/fixtures.js";
import { resolvePosCustomerId } from "./posCustomer.service.js";

const userIds: string[] = [];

beforeAll(async () => {
  await connectDB();
});

afterAll(async () => {
  await User.deleteMany({ _id: { $in: userIds } });
  await closeTestConnections();
});

describe("resolvePosCustomerId", () => {
  it("re-verifies and returns an explicitly-selected existing customerId", async () => {
    const customer = await User.create({ name: "Returning Customer", email: `pos-cust-${Date.now()}@test.local`, passwordHash: "x", role: "customer" });
    userIds.push(customer.id as string);

    const id = await resolvePosCustomerId({ customerId: customer.id as string });
    expect(id).toBe(customer.id);
  });

  it("reuses an existing customer account when the given email already belongs to one", async () => {
    const email = `pos-existing-${Date.now()}@test.local`;
    const customer = await User.create({ name: "Existing Walk-in", email, passwordHash: "x", role: "customer" });
    userIds.push(customer.id as string);

    const id = await resolvePosCustomerId({ name: "Walk-in", email });
    expect(id).toBe(customer.id);
  });

  it("creates a brand-new real customer account for a first-time walk-in", async () => {
    const email = `pos-new-${Date.now()}@test.local`;
    const id = await resolvePosCustomerId({ name: "New Walk-in", email });
    userIds.push(id);

    const created = await User.findById(id);
    expect(created?.role).toBe("customer");
    expect(created?.isDemoAccount).not.toBe(true);
  });

  it("(Phase 49) reuses the existing account rather than throwing when User.create() races a concurrently-committed duplicate email", async () => {
    const email = `pos-race-${Date.now()}@test.local`;
    const winner = await User.create({ name: "Race Winner", email, passwordHash: await bcrypt.hash("Password123!", 12), role: "customer" });
    userIds.push(winner.id as string);

    // Simulates the race deterministically: the email-provided reuse check above (findOne) ran
    // before this row committed, so it saw nothing — the exact condition the try/catch around
    // User.create() exists to recover from by re-resolving to the winner instead of failing the
    // whole POS order.
    const findOneSpy = jest.spyOn(User, "findOne").mockResolvedValueOnce(null);
    try {
      const id = await resolvePosCustomerId({ name: "Race Loser", email });
      expect(id).toBe(winner.id);
    } finally {
      findOneSpy.mockRestore();
    }
  });
});
