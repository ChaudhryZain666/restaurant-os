import mongoose from "mongoose";
import { connectDB } from "../config/db.js";
import { env } from "../config/env.js";
import { assertSafeToRun, runE2eOrderCleanup } from "../services/e2eOrderCleanup.service.js";

/**
 * Thin entry point — the actual logic (and its safety rules) lives in
 * services/e2eOrderCleanup.service.ts, so it can be unit-tested directly rather than only through
 * this auto-invoking script (the same split scripts/seed.ts already uses for the plan catalog, via
 * planCatalogSeed.service.ts).
 *
 * Usage: npm run --workspace apps/api cleanup:e2e-orders
 */
async function cleanup() {
  assertSafeToRun(env.NODE_ENV);
  await connectDB();

  const result = await runE2eOrderCleanup();
  console.log(
    `[cleanup-e2e-orders] deleted orders=${result.deletedCount} (from ${result.e2eRestaurantCount} e2e restaurants and/or ${result.e2eCustomerCount} @test.local customers, older than 60 minutes)`
  );

  await mongoose.disconnect();
}

cleanup().catch((err) => {
  console.error("[cleanup-e2e-orders] failed", err);
  process.exit(1);
});
