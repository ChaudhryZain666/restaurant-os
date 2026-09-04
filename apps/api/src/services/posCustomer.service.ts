import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import type { PosCustomerInput } from "@restaurant/validation";
import { User } from "../models/User.js";
import { ApiError } from "../utils/ApiError.js";

/**
 * Resolves a POS order's `customerId` — every Order requires one (see Order.ts), and unlike the
 * customer-facing checkout, POS has no logged-in customer to derive it from. Two paths:
 *
 * 1. `{customerId}` — staff searched GET /restaurants/:id/customers (see customer.controller.ts)
 *    and picked a returning customer. Re-verified here (exists, role "customer", not deleted) —
 *    a client-supplied id is never trusted just because it looks like an ObjectId, same "never
 *    trust an id off the wire" discipline as every other tenant-scoped write in this codebase.
 * 2. `{name, phone?, email?}` — a walk-in with no account. If the email given already belongs to
 *    a real customer, that existing account is reused (so the same person's history stays
 *    connected across visits) rather than creating a duplicate. Otherwise a new, REAL customer
 *    account is created — NOT flagged isDemoAccount (that flag means something specific and
 *    different: a throwaway public-marketing-playground session excluded from real analytics; a
 *    walk-in POS sale is real revenue and should show up everywhere a normal customer's does).
 *    A synthetic, obviously-non-deliverable email is generated when none is given (the schema
 *    requires one) and a random, never-used password is set — mirrors auth.controller.ts's
 *    startDemoSession exactly, minus the isDemoAccount/demoExpiresAt fields.
 */
export async function resolvePosCustomerId(input: PosCustomerInput): Promise<string> {
  if ("customerId" in input) {
    const user = await User.findOne({ _id: input.customerId, role: "customer", deletedAt: { $exists: false } });
    if (!user) throw ApiError.badRequest("Selected customer could not be found");
    return user.id;
  }

  const { name, phone, email } = input;

  if (email) {
    const existing = await User.findOne({ email: email.toLowerCase(), role: "customer" });
    if (existing) return existing.id;
  }

  const resolvedEmail = email?.toLowerCase() ?? `walkin-${randomBytes(8).toString("hex")}@pos.local`;
  const passwordHash = await bcrypt.hash(randomBytes(16).toString("hex"), 12);
  const user = await User.create({
    name,
    email: resolvedEmail,
    phone,
    passwordHash,
    role: "customer",
  });
  return user.id;
}
