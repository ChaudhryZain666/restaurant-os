import mongoose from "mongoose";
import { connectDB } from "../config/db.js";
import { env } from "../config/env.js";
import { bootstrapPlatformAdmin } from "../services/platformAdminBootstrap.service.js";

/**
 * Phase 43 — the ONLY production-safe way to provision a platform_admin account. Requires a real
 * email + password supplied via environment variables; refuses to run with no credential supplied,
 * and never falls back to any default. Never logs the password — only the email and outcome.
 *
 * Usage:
 *   PLATFORM_ADMIN_EMAIL=you@example.com PLATFORM_ADMIN_PASSWORD='...' \
 *     npm run bootstrap:platform-admin -w apps/api
 *
 * Safe to re-run: if an account with this email already exists as platform_admin, it is left
 * completely untouched (including its password) — see platformAdminBootstrap.service.ts.
 */
async function run() {
  if (!env.PLATFORM_ADMIN_EMAIL || !env.PLATFORM_ADMIN_PASSWORD) {
    console.error(
      "[bootstrap-platform-admin] PLATFORM_ADMIN_EMAIL and PLATFORM_ADMIN_PASSWORD must both be set — refusing to run with no credential supplied."
    );
    process.exit(1);
  }

  await connectDB();
  const result = await bootstrapPlatformAdmin(env.PLATFORM_ADMIN_EMAIL, env.PLATFORM_ADMIN_PASSWORD);
  console.log(`[bootstrap-platform-admin] ${result.outcome}: ${result.email}`);
  await mongoose.disconnect();
}

run().catch((err) => {
  console.error("[bootstrap-platform-admin] failed", err);
  process.exit(1);
});
