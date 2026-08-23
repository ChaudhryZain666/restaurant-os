import mongoose from "mongoose";
import { connectDB } from "../config/db.js";
import { backfillLocationCounts } from "../services/locationCountBackfill.service.js";

/**
 * Phase 27 — CLI entry point, mirroring backfillSubscriptions.ts's shape exactly. REQUIRED
 * one-time deployment step for this phase (see docs/commercial-decisions.md): without it, every
 * pre-existing multi-location business's location LIMIT is computed against an artificially-low
 * locationCount of 0, which is harmless today (the no-subscription default is generous — see
 * entitlementLimit.service.ts) but would become a real problem the moment that business ever gets
 * a real subscription whose plan defines max_locations.
 *
 * Usage: npm run --workspace apps/api migrate:backfill-location-counts -- --dry-run
 */
async function migrate() {
  const dryRun = process.argv.includes("--dry-run");
  await connectDB();

  console.log(`[backfill-location-counts] starting${dryRun ? " (dry run — no writes will be committed)" : ""}`);
  const summary = await backfillLocationCounts({ dryRun });

  for (const entry of summary) {
    console.log(
      `[backfill-location-counts] business ${entry.businessId} (${entry.businessName}): ${entry.previousCount} -> ${entry.realCount}`
    );
  }
  console.log(`[backfill-location-counts] done. corrected=${summary.length}`);

  await mongoose.disconnect();
}

migrate().catch((err) => {
  console.error("[backfill-location-counts] failed", err);
  process.exit(1);
});
