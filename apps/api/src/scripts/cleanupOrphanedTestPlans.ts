import mongoose from "mongoose";
import { connectDB } from "../config/db.js";
import { Plan } from "../models/Plan.js";
import { Subscription } from "../models/Subscription.js";

/**
 * Phase 54 — one-time remediation for the exact contamination .env.test's own comment already
 * documents: before Phase 46 pointed Jest at its own database (restaurant_platform_test),
 * test-utils/fixtures.ts's createTestPlan() (and the ad hoc Plan.create() calls in
 * subscription.controller.test.ts / billingWebhook.controller.test.ts) created real, uncleaned-up
 * documents directly in the shared dev database. Phase 46 made that structurally impossible going
 * forward — this script only cleans up what already landed there before that fix existed.
 *
 * Every plan this fixture ever creates is named literally "Test Plan" (see createTestPlan's own
 * `name: "Test Plan"` — never varied, never a real commercial plan's name), so that's an exact,
 * unambiguous marker — not a heuristic guess. Confirmed live against the dev database before writing
 * this: all matches had empty `pricing` arrays (structurally incapable of being a real, checkout-
 * able plan) and every referencing Subscription was a `trialing` e2e-test artifact a few days old.
 * Subscriptions pointing at a plan with no pricing are the same contamination, not separately
 * meaningful data — deleting the plan and leaving a dangling subscription would just move the
 * breakage, not fix it, so both are removed together.
 *
 * Safe to re-run (no-op once clean). Never touches any plan/subscription that isn't a "Test Plan"
 * match — no broad "delete all subscriptions" or "delete all plans" of any kind.
 *
 * Usage: npm run --workspace apps/api cleanup:test-plans
 */
async function cleanup() {
  await connectDB();

  const junkPlans = await Plan.find({ name: "Test Plan" }).select("_id");
  const planIds = junkPlans.map((p) => p._id);

  if (planIds.length === 0) {
    console.log("[cleanup-test-plans] nothing to clean up");
    await mongoose.disconnect();
    return;
  }

  const { deletedCount: subsDeleted } = await Subscription.deleteMany({ planId: { $in: planIds } });
  const { deletedCount: plansDeleted } = await Plan.deleteMany({ _id: { $in: planIds } });

  console.log(`[cleanup-test-plans] deleted plans=${plansDeleted} subscriptions=${subsDeleted}`);

  await mongoose.disconnect();
}

cleanup().catch((err) => {
  console.error("[cleanup-test-plans] failed", err);
  process.exit(1);
});
