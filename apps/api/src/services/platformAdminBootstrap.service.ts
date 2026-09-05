import bcrypt from "bcryptjs";
import { User } from "../models/User.js";

export interface BootstrapPlatformAdminResult {
  email: string;
  outcome: "created" | "unchanged";
}

/**
 * Phase 43 — the ONLY production-safe way to provision a platform_admin account. Deliberately
 * minimal and idempotent-safe-by-default: if an account with this email already exists, it is left
 * completely untouched (including its password) rather than silently rotated — a re-run with a
 * different password is never a surprise credential change. If that existing account has some OTHER
 * role, this refuses rather than silently promoting an unrelated account to platform_admin.
 *
 * Takes the email/password as plain parameters (never reads env vars itself) so it stays a pure,
 * easily-testable function — scripts/bootstrapPlatformAdmin.ts is the thin CLI wrapper that reads
 * PLATFORM_ADMIN_EMAIL/PLATFORM_ADMIN_PASSWORD and validates their presence before calling this.
 */
export async function bootstrapPlatformAdmin(email: string, password: string): Promise<BootstrapPlatformAdminResult> {
  const existing = await User.findOne({ email });
  if (existing) {
    if (existing.role !== "platform_admin") {
      throw new Error(`An account with email "${email}" already exists with role "${existing.role}" — refusing to touch it.`);
    }
    return { email, outcome: "unchanged" };
  }

  const passwordHash = await bcrypt.hash(password, 12);
  await User.create({ name: "Platform Admin", email, passwordHash, role: "platform_admin" });
  return { email, outcome: "created" };
}
