import mongoose from "mongoose";
import { connectDB } from "../config/db.js";
import { ensureAllIndexes } from "../services/indexMaintenance.service.js";

/**
 * Phase 49 — CLI entry point. See services/indexMaintenance.service.ts for the actual logic (kept
 * separate so it has no top-level CLI-only code and can be imported directly by tests), and
 * docs/database-indexes-and-migrations.md for when/why to run this.
 *
 * Usage: npm run --workspace apps/api db:ensure-indexes
 */
async function run() {
  await connectDB();

  const { modelsProcessed, retired } = await ensureAllIndexes();
  console.log(`[ensure-indexes] built indexes for ${modelsProcessed.length} models`);
  for (const r of retired) {
    if (r.reason === "dropped") console.log(`[ensure-indexes]   dropped ${r.collection}.${r.indexName} (superseded by ${r.supersededBy})`);
    else if (r.reason === "already-gone") console.log(`[ensure-indexes]   skip ${r.collection}.${r.indexName} — already gone`);
    else console.warn(`[ensure-indexes]   NOT dropping ${r.collection}.${r.indexName} — replacement ${r.supersededBy} not found`);
  }
  console.log("[ensure-indexes] done");

  await mongoose.disconnect();
}

run().catch((err) => {
  console.error("[ensure-indexes] failed", err);
  process.exit(1);
});
