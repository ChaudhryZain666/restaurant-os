import mongoose from "mongoose";
import { connectDB } from "../config/db.js";
import { backfillSubscriptions } from "../services/subscriptionBackfill.service.js";

/**
 * Phase 24 — CLI entry point for grandfathering every pre-existing Business onto an `active`,
 * `provider: "internal"` Subscription (no real billing relationship — see
 * subscriptionBackfill.service.ts's header comment). Low-risk relative to migrateMenuToCanonical:
 * this only ever CREATES new Subscription documents, never modifies or deletes anything existing,
 * and is naturally idempotent (a business with any Subscription document is skipped).
 *
 * Usage: npm run --workspace apps/api migrate:backfill-subscriptions -- --dry-run
 */
async function migrate() {
  const dryRun = process.argv.includes("--dry-run");
  await connectDB();

  console.log(`[backfill-subscriptions] starting${dryRun ? " (dry run — no writes will be committed)" : ""}`);
  const summary = await backfillSubscriptions({ dryRun });

  const created = summary.filter((s) => s.action === "created");
  const skippedExisting = summary.filter((s) => s.action === "skipped-existing-subscription").length;
  const skippedNoPlan = summary.filter((s) => s.action === "skipped-no-owner-plan").length;

  for (const entry of created) {
    console.log(`[backfill-subscriptions] business ${entry.businessId} (${entry.businessName}): ${entry.action}`);
  }
  console.log(
    `[backfill-subscriptions] done. created=${created.length} skippedExisting=${skippedExisting} skippedNoOwnerPlan=${skippedNoPlan}`
  );
  if (skippedNoPlan > 0) {
    console.warn('[backfill-subscriptions] WARNING: no Plan with code "owner" was found — run the seed script first.');
  }

  await mongoose.disconnect();
}

migrate().catch((err) => {
  console.error("[backfill-subscriptions] failed", err);
  process.exit(1);
});
