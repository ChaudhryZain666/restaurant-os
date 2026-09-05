import mongoose from "mongoose";
import { connectDB } from "../config/db.js";
import { seedPlanCatalog } from "../services/planCatalogSeed.service.js";

/**
 * Phase 43 — PRODUCTION-SAFE. This script does exactly one thing: ensure the real commercial Plan
 * catalog exists (owner_starter/owner_growth/agency_growth_v2 active; every retired tier kept,
 * never deleted or price-mutated — see planCatalogSeed.service.ts's own header comment). It creates
 * NO User, Restaurant, or Business document — no platform admin, no demo restaurant, nothing with a
 * known/hardcoded password. Safe to run against a real production database.
 *
 * For local development, ALSO run `npm run seed:demo` afterward to get a demo restaurant, a
 * platform-admin login, and realistic sample data — see scripts/seed-demo-data.ts, which is
 * explicitly development/demo-only and must never be run against production.
 *
 * To provision a real platform administrator in production, use
 * `npm run bootstrap:platform-admin` (scripts/bootstrapPlatformAdmin.ts) with a real,
 * explicitly-supplied email/password — never this script, and never a hardcoded credential.
 */
async function seed() {
  await connectDB();
  await seedPlanCatalog();
  console.log(
    "[seed] ensured plan catalog (owner_starter, owner_growth, agency_growth_v2 active; owner_basic/owner_pro/agency_starter/agency_growth and legacy owner/agency retained inactive)"
  );
  console.log("[seed] done — no accounts were created. Run `npm run seed:demo` for local dev/demo data.");
  await mongoose.disconnect();
}

seed().catch((err) => {
  console.error("[seed] failed", err);
  process.exit(1);
});
