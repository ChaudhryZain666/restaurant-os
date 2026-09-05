import mongoose from "mongoose";
import { connectDB } from "../config/db.js";
import { Restaurant } from "../models/Restaurant.js";
import { RestaurantPaymentAccount } from "../models/RestaurantPaymentAccount.js";

/**
 * Phase 42 — READ-ONLY audit, not a migration. Reports every restaurant with
 * settings.onlinePaymentEnabled=true that has no active RestaurantPaymentAccount — the exact
 * population the new BYOC-required safety gate (restaurant.controller.ts/payment.service.ts) now
 * prevents from growing, without touching any existing record. Per this phase's own instruction,
 * existing restaurants in this state must NOT be silently disabled or otherwise modified — this
 * script only lists them so the actual number is known, never mutates anything.
 *
 * Usage: npm run --workspace apps/api script -- src/scripts/auditOnlinePaymentsWithoutAccount.ts
 */
async function audit() {
  await connectDB();

  const candidates = await Restaurant.find({ "settings.onlinePaymentEnabled": true }).select("_id name slug businessId");
  console.log(`[audit-online-payments] ${candidates.length} restaurant(s) have online payments enabled`);

  const withoutAccount: { id: string; name: string; slug: string }[] = [];
  for (const restaurant of candidates) {
    const hasAccount = (await RestaurantPaymentAccount.exists({ restaurantId: restaurant._id, status: "active" })) !== null;
    if (!hasAccount) {
      withoutAccount.push({ id: restaurant.id as string, name: restaurant.name, slug: restaurant.slug });
    }
  }

  console.log(
    `[audit-online-payments] ${withoutAccount.length} of those have NO active connected payment account (would be blocked from re-enabling under the new gate; NOT modified by this script):`
  );
  for (const r of withoutAccount) {
    console.log(`[audit-online-payments]   - ${r.name} (${r.slug}, ${r.id})`);
  }

  await mongoose.disconnect();
}

audit().catch((err) => {
  console.error("[audit-online-payments] failed", err);
  process.exit(1);
});
