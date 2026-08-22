import mongoose from "mongoose";
import { connectDB } from "../config/db.js";
import {
  findDuplicateRestaurantOwners,
  backfillBusinessesForRestaurants,
  syncUsersToBusinessLocation,
} from "../services/businessLocationMigration.service.js";

/**
 * Phase 18 — CLI entry point. Backfills the new Business/Location foundation onto every
 * pre-Phase-18 Restaurant and User. Idempotent and safely re-runnable (mirrors seed.ts's
 * conventions). See services/businessLocationMigration.service.ts for the actual migration logic
 * (kept separate so it has no top-level CLI-only code and can be imported directly by tests), and
 * docs/multi-tenant-storefront-architecture.md's Phase 18 section for the full design rationale.
 *
 * Structured as two independent, separately idempotent passes (not one combined transaction) so it
 * stays a safe stopgap to re-run even after the initial backfill — createRestaurant/inviteStaff
 * were also updated to keep new records correctly populated going forward, but this script remains
 * a safety net if anything ever slips through outside those two paths (a direct DB write, a bug).
 */
async function migrate() {
  await connectDB();

  const duplicateOwners = await findDuplicateRestaurantOwners();
  if (duplicateOwners.length > 0) {
    console.error(
      "[migrate] pre-flight check failed: the following ownerId(s) are used by more than one Restaurant — " +
        "resolve this manually before running the migration, since the naive migration would incorrectly " +
        "split one real business into several:",
      duplicateOwners.map((d) => d.toString())
    );
    process.exit(1);
  }
  console.log("[migrate] pre-flight check passed: every Restaurant has a unique ownerId");

  await backfillBusinessesForRestaurants();
  await syncUsersToBusinessLocation();

  await mongoose.disconnect();
  console.log("[migrate] done");
}

migrate().catch((err) => {
  console.error("[migrate] failed", err);
  process.exit(1);
});
