import mongoose from "mongoose";
import { connectDB } from "../config/db.js";
import { findDuplicates } from "../services/indexMaintenance.service.js";

/**
 * Phase 49 — CLI entry point. See services/indexMaintenance.service.ts for the actual logic.
 * Read-only — never writes, deletes, or picks a "winner". See that file's doc comment for when
 * this is useful and why it doesn't try to be exhaustive.
 *
 * Usage: npm run --workspace apps/api db:check-duplicates
 */
async function run() {
  await connectDB();

  const results = await findDuplicates();
  console.log(`[check-duplicates] ran ${results.length} checks against ${mongoose.connection.name}`);
  let anyFound = false;
  for (const r of results) {
    if (r.violations.length === 0) {
      console.log(`[check-duplicates]   OK — no duplicates: ${r.label}`);
      continue;
    }
    anyFound = true;
    console.warn(`[check-duplicates]   FOUND ${r.violations.length} duplicate group(s): ${r.label}`);
    for (const v of r.violations.slice(0, 10)) {
      console.warn(`[check-duplicates]     ${JSON.stringify(v.key)} — ${v.count} documents`);
    }
  }
  console.log(anyFound ? "[check-duplicates] duplicates found — see above, do not resolve automatically" : "[check-duplicates] done — no duplicates found");

  await mongoose.disconnect();
}

run().catch((err) => {
  console.error("[check-duplicates] failed", err);
  process.exit(1);
});
