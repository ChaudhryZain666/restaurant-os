import mongoose from "mongoose";
import { connectDB } from "../config/db.js";
import { migrateAllBusinessMenus } from "../services/menuBusinessMigration.service.js";

/**
 * Phase 20 — CLI entry point for migrating every business's per-location menu into the canonical
 * + per-location-override architecture. See services/menuBusinessMigration.service.ts for the
 * actual migration logic (kept separate so it has no top-level CLI-only code and can be imported
 * directly by tests), and docs/multi-tenant-storefront-architecture.md's Phase 20 section for the
 * full design rationale.
 *
 * NOT run against the real dev/production database yet — this phase builds and fixture-tests the
 * migration only. Before ever running this for real: mongodump the categories/menuitems/
 * modifiergroups collections first. Deletion of a multi-location business's sibling documents
 * (once matched/merged into canonical + override rows) is NOT byte-for-byte reversible — the
 * effective menu is fully reconstructible, but original document _ids are not recovered by a
 * rollback. Single-location businesses remain trivially reversible (their own documents are only
 * ever $set with businessId, never deleted) via `$unset businessId` on Category/MenuItem/
 * ModifierGroup plus deleting any (nonexistent, for a single-location business) override rows.
 *
 * Usage: npm run --workspace apps/api migrate:menu-canonical -- --dry-run
 */
async function migrate() {
  const dryRun = process.argv.includes("--dry-run");
  await connectDB();

  console.log(`[migrate-menu] starting${dryRun ? " (dry run — no writes will be committed)" : ""}`);
  const summaries = await migrateAllBusinessMenus({ dryRun });

  const migrated = summaries.filter((s) => !s.skippedAlreadyMigrated && !s.skippedNoLocations);
  const alreadyDone = summaries.filter((s) => s.skippedAlreadyMigrated).length;
  const noLocations = summaries.filter((s) => s.skippedNoLocations).length;

  for (const summary of migrated) {
    console.log(`[migrate-menu] business ${summary.businessId}:`, JSON.stringify(summary));
  }
  console.log(
    `[migrate-menu] done. migrated=${migrated.length} alreadyMigrated=${alreadyDone} noLocations=${noLocations}`
  );

  await mongoose.disconnect();
}

migrate().catch((err) => {
  console.error("[migrate-menu] failed", err);
  process.exit(1);
});
