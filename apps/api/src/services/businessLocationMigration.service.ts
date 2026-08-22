import mongoose from "mongoose";
import { STAFF_ROLES } from "@restaurant/validation";
import { Restaurant } from "../models/Restaurant.js";
import { Business } from "../models/Business.js";
import { User } from "../models/User.js";

/**
 * Phase 18 — the actual migration logic backfilling Business/Location onto pre-Phase-18 data,
 * split out from scripts/migrateToBusinessLocation.ts so it has no top-level CLI-only code (no
 * `import.meta`/process.exit) and can be imported directly by tests. See that script for the CLI
 * entry point, and docs/multi-tenant-storefront-architecture.md's Phase 18 section for the design
 * rationale.
 */

/**
 * Fail loudly, not silently, if the naive one-Business-per-Restaurant migration below would be
 * wrong for any NOT-YET-MIGRATED restaurant. Today's pre-Phase-18 model already can't cleanly
 * represent one person owning two restaurants (User.restaurantId is a single field), but nothing
 * in the schema stops bad legacy data (a manual DB edit, a bug) from having two Restaurant docs
 * share one ownerId — migrating that naively would mint two separate Businesses for what might
 * actually be one real business, which the migration should refuse to guess at.
 *
 * Scoped to `businessId: {$exists: false}` — restaurants that already went through Phase 18 (or
 * were created afterward via createRestaurant's businessId branch) are EXPECTED to share an
 * ownerId with their sibling locations under the same business, since that's the whole point of
 * the new multi-location capability. Without this scope, re-running the migration as a stopgap
 * after even one real multi-location business exists would falsely block on its own legitimate
 * locations.
 */
export async function findDuplicateRestaurantOwners(): Promise<mongoose.Types.ObjectId[]> {
  const duplicateOwners = await Restaurant.aggregate<{ _id: mongoose.Types.ObjectId; count: number }>([
    { $match: { businessId: { $exists: false } } },
    { $group: { _id: "$ownerId", count: { $sum: 1 } } },
    { $match: { count: { $gt: 1 } } },
  ]);
  return duplicateOwners.map((d) => d._id);
}

/** Pass 1: create a Business for every Restaurant that doesn't have one yet, transaction-wrapped
 *  per restaurant. Idempotent — only touches restaurants missing businessId. */
export async function backfillBusinessesForRestaurants(): Promise<number> {
  const restaurantsNeedingBusiness = await Restaurant.find({ businessId: { $exists: false } });
  console.log(`[migrate] pass 1: ${restaurantsNeedingBusiness.length} restaurant(s) need a Business`);

  for (const restaurant of restaurantsNeedingBusiness) {
    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        const [business] = await Business.create(
          [
            {
              name: restaurant.name,
              slug: restaurant.slug,
              description: restaurant.description,
              logo: restaurant.logo,
              coverImage: restaurant.coverImage,
              ownerId: restaurant.ownerId,
              // Mirrored exactly from the source Restaurant — documented explicitly (see the ADR)
              // so nobody later wonders why a Business is "suspended" with no enforcement anywhere:
              // nothing currently reads Business.status to gate anything, this just keeps the field
              // consistent with reality rather than defaulting it to something that doesn't match.
              status: restaurant.status,
              brandColor: restaurant.settings?.brandColor,
            },
          ],
          { session }
        );
        await Restaurant.updateOne({ _id: restaurant._id }, { $set: { businessId: business._id } }, { session });
        console.log(`[migrate] created Business "${business.name}" (${business.id}) for Restaurant ${restaurant.id}`);
      });
    } finally {
      await session.endSession();
    }
  }
  return restaurantsNeedingBusiness.length;
}

/** Pass 2: sync businessId/locationIds onto every User that has a restaurantId but no businessId
 *  yet. Idempotent — only touches users missing businessId. Users whose restaurant hasn't been
 *  migrated yet (shouldn't happen after pass 1, but a re-run against a partially-migrated database
 *  could hit this) are skipped cleanly rather than crashing. */
export async function syncUsersToBusinessLocation(): Promise<{ synced: number; skipped: number }> {
  const usersNeedingSync = await User.find({
    restaurantId: { $exists: true },
    businessId: { $exists: false },
  });
  console.log(`[migrate] pass 2: ${usersNeedingSync.length} user(s) need businessId/locationIds`);

  let synced = 0;
  let skipped = 0;
  for (const user of usersNeedingSync) {
    const restaurant = await Restaurant.findById(user.restaurantId);
    if (!restaurant?.businessId) {
      skipped += 1;
      continue;
    }
    user.businessId = restaurant.businessId;
    if ((STAFF_ROLES as readonly string[]).includes(user.role)) {
      user.locationIds = [restaurant._id];
    }
    await user.save();
    synced += 1;
  }
  console.log(`[migrate] pass 2: synced ${synced} user(s), skipped ${skipped} (restaurant not yet migrated)`);
  return { synced, skipped };
}
