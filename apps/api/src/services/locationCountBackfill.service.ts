import { Business } from "../models/Business.js";
import { Restaurant } from "../models/Restaurant.js";

export interface LocationCountBackfillEntry {
  businessId: string;
  businessName: string;
  previousCount: number;
  realCount: number;
}

/**
 * Phase 27 migration — every Business created before this phase has `locationCount: 0` by schema
 * default, regardless of how many real Restaurant (location) documents it actually has, since
 * nothing incremented it until this phase's reserveLocationSlot started doing so on NEW location
 * creation. Recomputes the REAL count via Restaurant.countDocuments and sets it directly — safely
 * idempotent (recomputing and re-setting the same correct value twice is a no-op the second time),
 * unlike subscriptionBackfill.service.ts's "skip if already exists" shape, which this doesn't need:
 * there's no meaningful "already backfilled" state to skip, only a value that's either correct or
 * stale.
 */
export async function backfillLocationCounts(options: {
  dryRun: boolean;
  /** Scopes the scan to specific businesses — the real CLI run omits this (every Business), while
   *  tests pass their own fixture ids so this shared-DB migration never touches another test file's
   *  concurrently-running fixtures. */
  businessIds?: string[];
}): Promise<LocationCountBackfillEntry[]> {
  const businesses = await Business.find(options.businessIds ? { _id: { $in: options.businessIds } } : {}).select(
    "name locationCount"
  );
  const summary: LocationCountBackfillEntry[] = [];

  for (const business of businesses) {
    const realCount = await Restaurant.countDocuments({ businessId: business._id });
    if (realCount !== business.locationCount) {
      summary.push({
        businessId: business.id as string,
        businessName: business.name,
        previousCount: business.locationCount,
        realCount,
      });
      if (!options.dryRun) {
        await Business.updateOne({ _id: business._id }, { $set: { locationCount: realCount } });
      }
    }
  }

  return summary;
}
