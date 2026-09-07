import { Order } from "../models/Order.js";
import { Restaurant } from "../models/Restaurant.js";
import { User } from "../models/User.js";

const MIN_AGE_MS = 60 * 60 * 1000;

/**
 * Phase 55 — durable fix for the accumulated e2e order backlog Phase 54 discovered (a shared test
 * restaurant carrying 200+ generated orders, which turned out to be a genuine contributor to a real
 * Orders-page timeout — see order.controller.ts's Phase 55 pagination work, the actual fix for that
 * side of it). This is the other half: a safe way to actually remove the backlog itself, without
 * ever risking real data. Logic lives here (not directly in scripts/cleanupE2eOrders.ts) so it can
 * be unit-tested — the same split scripts/seed.ts already uses via planCatalogSeed.service.ts.
 *
 * Two independent, deterministic, already-universal markers this repo's own e2e suite already
 * follows in every spec (confirmed by inspection — every e2e-created restaurant slug starts with
 * "e2e-", every e2e-created user email ends in "@test.local"; neither pattern is ever used by seed
 * data, which uses "@restaurant.local"/"@demo-restaurant.local", or by any real signup path):
 *
 *   1. Any order placed against a restaurant whose OWN slug starts with "e2e-" — the entire
 *      restaurant exists solely for one test run, so every order against it is disposable by
 *      construction.
 *   2. Any order placed by a customer whose email ends in "@test.local" — covers specs that reuse
 *      a fixed test customer (e.g. "customer1@test.local") against the real seeded demo-restaurant,
 *      which is itself NOT touched or deleted here (only orders are), because demo-restaurant is
 *      shared, persistent seed data.
 *
 * Deliberately NOT in scope (see Phase 55 report for why): deleting the disposable e2e-* restaurants/
 * businesses/users themselves. That would need a real cascade across every collection a restaurant
 * touches (menu, tables, domains, payment accounts, subscriptions...) that no existing feature in
 * this codebase implements even for real restaurant deletion (restaurants are only ever suspended,
 * never hard-deleted) — building one is a materially bigger, separate piece of work than fixing the
 * proven order-backlog problem this targets.
 *
 * Safety:
 * - `assertSafeToRun` refuses to proceed when NODE_ENV=production — this has no legitimate
 *   production use; real customer orders are never disposable by either marker above.
 * - `minAgeMs` (default 1 hour) — never touches anything created within that window, so a test
 *   suite running concurrently with this script can never have its own in-progress assertions
 *   pulled out from under it.
 * - Only ever touches the Order collection. Never restaurants, businesses, or users.
 * - Idempotent — a second run against an already-clean database just deletes 0 documents.
 */
export function assertSafeToRun(nodeEnv: string): void {
  if (nodeEnv === "production") {
    throw new Error("refusing to run: NODE_ENV=production");
  }
}

export async function runE2eOrderCleanup(now: Date = new Date(), minAgeMs: number = MIN_AGE_MS): Promise<{
  deletedCount: number;
  e2eRestaurantCount: number;
  e2eCustomerCount: number;
}> {
  const cutoff = new Date(now.getTime() - minAgeMs);

  const e2eRestaurantIds = (await Restaurant.find({ slug: /^e2e-/ }).select("_id")).map((r) => r._id);
  const e2eCustomerIds = (await User.find({ email: /@test\.local$/i }).select("_id")).map((u) => u._id);

  if (e2eRestaurantIds.length === 0 && e2eCustomerIds.length === 0) {
    return { deletedCount: 0, e2eRestaurantCount: 0, e2eCustomerCount: 0 };
  }

  const { deletedCount } = await Order.deleteMany({
    createdAt: { $lt: cutoff },
    $or: [{ restaurantId: { $in: e2eRestaurantIds } }, { customerId: { $in: e2eCustomerIds } }],
  });

  return { deletedCount, e2eRestaurantCount: e2eRestaurantIds.length, e2eCustomerCount: e2eCustomerIds.length };
}
