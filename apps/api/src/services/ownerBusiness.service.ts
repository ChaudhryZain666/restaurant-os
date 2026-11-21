import mongoose, { type ClientSession, type HydratedDocument, type Types } from "mongoose";
import type { CreateBusinessSelfServeInput } from "@restaurant/validation";
import { Business, type BusinessDoc } from "../models/Business.js";
import { Restaurant, type RestaurantDoc } from "../models/Restaurant.js";
import { User } from "../models/User.js";
import { ApiError } from "../utils/ApiError.js";
import { recordAuditEvent } from "./audit.service.js";

/**
 * Creates a user's FIRST business and its first restaurant (location), making the user its owner.
 * Moved out of business.controller.ts's createBusinessSelfServe (Launch, 2026-11-21) so the public
 * pay-now checkout's account set-up (guestCheckout.service.ts) provisions restaurants exactly the
 * same way. Callers do their own eligibility checks (email verification, legal acceptance, or a
 * verified payment); this enforces "no business yet" inside the transaction.
 */
export async function provisionOwnerBusiness(
  userId: string | Types.ObjectId,
  { name, slug, timezone, currency }: CreateBusinessSelfServeInput
): Promise<{ business: HydratedDocument<BusinessDoc>; restaurant: HydratedDocument<RestaurantDoc> }> {
  const existingSlug = await Restaurant.findOne({ slug });
  if (existingSlug) throw ApiError.conflict("That restaurant URL is already taken — try another");
  const existingBusinessSlug = await Business.findOne({ slug });
  if (existingBusinessSlug) throw ApiError.conflict("That restaurant URL is already taken — try another");

  const session = await mongoose.startSession();
  let business: HydratedDocument<BusinessDoc>;
  let restaurant: HydratedDocument<RestaurantDoc>;
  let actorRole: string;
  try {
    try {
      const created = (await session.withTransaction(async () => {
        // Phase 60 — a real, previously-undiscovered race: two concurrent requests for the same
        // caller (double-click, a stale second tab, a network retry) could both pass the outer
        // pre-check above before either committed, each create their OWN real Business+Restaurant,
        // and race to write this caller's businessId — MongoDB's own write-conflict detection
        // aborts and auto-retries the loser's *entire* transaction (via withTransaction), but the
        // retry re-ran this callback against the SAME stale, outer-scope `caller` object, which
        // never saw the winner's already-committed businessId — so the retry created a SECOND
        // real, silently orphaned Business+Restaurant instead of failing cleanly. Re-reading the
        // caller here, scoped to this session, makes the check itself part of the transaction: on
        // a retry, this read sees the new snapshot (the winner's committed write), correctly
        // throws the same 409 the outer pre-check would have given a slightly-slower request, and
        // — critically — throws BEFORE either Business or Restaurant document is created, so a
        // losing retry never creates anything at all.
        const caller = await User.findById(userId).session(session);
        if (!caller) throw ApiError.unauthorized("User no longer exists");
        if (caller.businessId) throw ApiError.conflict("You already have a business set up");

        const [createdBusiness] = await Business.create(
          [{ name, slug, ownerId: caller._id, status: "active" }],
          { session }
        );
        const [createdRestaurant] = await Restaurant.create(
          [
            {
              name,
              slug,
              ownerId: caller._id,
              businessId: createdBusiness._id,
              status: "pending",
              settings: {
                ...(timezone ? { timezone } : {}),
                ...(currency ? { currency } : {}),
              },
            },
          ],
          { session }
        );

        caller.businessId = createdBusiness._id;
        caller.restaurantId = createdRestaurant._id;
        // Mirrors createAgency's exact conditional — never overwrites a more specific existing
        // role (e.g. agency_member) the way an unconditional assignment would.
        if (caller.role === "customer") caller.role = "restaurant_owner";
        await caller.save({ session });

        return { createdBusiness, createdRestaurant, actorRole: caller.role };
      })) as {
        createdBusiness: HydratedDocument<BusinessDoc>;
        createdRestaurant: HydratedDocument<RestaurantDoc>;
        actorRole: string;
      };
      business = created.createdBusiness;
      restaurant = created.createdRestaurant;
      actorRole = created.actorRole;
    } catch (err) {
      if ((err as { code?: number }).code === 11000) {
        throw ApiError.conflict("That restaurant URL is already taken — try another");
      }
      throw err;
    }
  } finally {
    await session.endSession();
  }

  await recordAuditEvent({
    restaurantId: restaurant._id,
    actorUserId: new mongoose.Types.ObjectId(String(userId)),
    actorRole,
    action: "restaurant.created",
    targetType: "restaurant",
    targetId: restaurant._id,
    metadata: { businessId: business._id.toString(), createdViaSelfServeSignup: true },
  });

  return { business, restaurant };
}

/** Throws the same 409 provisionOwnerBusiness would for a taken restaurant URL — for callers that
 *  must check before doing anything irreversible. */
export async function assertRestaurantSlugAvailable(slug: string, session?: ClientSession): Promise<void> {
  const [restaurant, business] = await Promise.all([Restaurant.exists({ slug }).session(session ?? null), Business.exists({ slug }).session(session ?? null)]);
  if (restaurant || business) throw ApiError.conflict("That restaurant URL is already taken — try another");
}
