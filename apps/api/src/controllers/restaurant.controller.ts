import bcrypt from "bcryptjs";
import { randomBytes } from "node:crypto";
import mongoose from "mongoose";
import type { Request, Response } from "express";
import type { HydratedDocument } from "mongoose";
import type { CreateRestaurantInput, UpdateRestaurantInput } from "@restaurant/validation";
import { Restaurant, type RestaurantDoc } from "../models/Restaurant.js";
import { Business, type BusinessDoc } from "../models/Business.js";
import { User } from "../models/User.js";
import { ApiError } from "../utils/ApiError.js";
import { sendSuccess } from "../common/response.js";
import { computeAvailability } from "../services/restaurantAvailability.service.js";
import { computeReadiness } from "../services/restaurantReadiness.service.js";
import { getSupportIdentity } from "../services/supportIdentity.service.js";
import { recordAuditEvent } from "../services/audit.service.js";
import { generateSecureToken } from "../services/secureToken.service.js";
import { logger } from "../common/logger.js";
import { env } from "../config/env.js";
import { getEmailService } from "../email/index.js";
import { ownerInviteEmail } from "../email/templates.js";

const OWNER_INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days — matches staff.controller.ts's invite TTL

/**
 * Provisions a restaurant AND its first owner atomically — closing the chicken-and-egg gap the
 * Phase 13 audit found (the old ownerId-based shape required a user to already exist with no
 * restaurant, but nothing in the UI could ever create that user first). Follows the exact
 * unusable-password + invite-token pattern staff.controller.ts's inviteStaff already uses, so the
 * owner accepts through the SAME existing /auth/accept-invite flow — no new auth architecture.
 *
 * New restaurants start in "pending" status (not "active"): a restaurant must not be publicly
 * orderable before its owner has actually set anything up. getRestaurantBySlug already only
 * resolves status:"active" restaurants, so this is enforced for free — no separate gating logic
 * needed on the public read path.
 *
 * Phase 18 — `businessId` in the body branches this into a second mode: instead of creating a new
 * Business + owner (the default, unchanged behavior below), it attaches a new Restaurant (location)
 * to an EXISTING Business. No owner is created/invited in that mode — the existing Business's owner
 * already has implicit access to every location under their businessId (see
 * middleware/businessLocation.ts's requireLocationAccess), so there's nothing to invite. This is
 * the concrete proof that a business can have multiple locations; no UI calls it yet this phase.
 */
export async function createRestaurant(req: Request, res: Response) {
  const { name, slug, timezone, currency, owner, businessId } = req.body as CreateRestaurantInput;

  const existingSlug = await Restaurant.findOne({ slug });
  if (existingSlug) throw ApiError.conflict("That restaurant slug is already taken");

  let existingBusiness: HydratedDocument<BusinessDoc> | null = null;
  if (businessId) {
    existingBusiness = await Business.findById(businessId);
    if (!existingBusiness) throw ApiError.notFound("Business not found");
  } else {
    const existingOwnerEmail = await User.findOne({ email: owner!.email });
    if (existingOwnerEmail) throw ApiError.conflict("An account with this email already exists");
  }

  const unusablePassword = randomBytes(32).toString("hex");
  const passwordHash = await bcrypt.hash(unusablePassword, 12);
  const { raw, hash } = generateSecureToken();

  const session = await mongoose.startSession();
  let restaurant: HydratedDocument<RestaurantDoc>;
  try {
    try {
      restaurant = (await session.withTransaction(async () => {
        if (existingBusiness) {
          // Second-location-under-an-existing-business branch: no owner created, the business's
          // existing owner already covers this location via requireLocationAccess's businessId
          // bypass.
          const [createdRestaurant] = await Restaurant.create(
            [
              {
                name,
                slug,
                ownerId: existingBusiness!.ownerId,
                businessId: existingBusiness!._id,
                status: "pending",
                settings: {
                  ...(timezone ? { timezone } : {}),
                  ...(currency ? { currency } : {}),
                },
              },
            ],
            { session }
          );
          return createdRestaurant;
        }

        // Default branch — unchanged from before Phase 18, plus a new Business created alongside.
        // Owner created first: User.restaurantId is optional, so this needs no placeholder value —
        // unlike Restaurant.ownerId, which is required and can be set correctly on the very first
        // write once the owner's _id exists.
        const [createdOwner] = await User.create(
          [
            {
              name: owner!.name,
              email: owner!.email,
              passwordHash,
              role: "restaurant_owner",
              isActive: true,
              inviteTokenHash: hash,
              inviteExpiresAt: new Date(Date.now() + OWNER_INVITE_TTL_MS),
            },
          ],
          { session }
        );

        const [createdBusiness] = await Business.create(
          [{ name, slug, ownerId: createdOwner._id, status: "pending" }],
          { session }
        );

        const [createdRestaurant] = await Restaurant.create(
          [
            {
              name,
              slug,
              ownerId: createdOwner._id,
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

        createdOwner.restaurantId = createdRestaurant._id;
        createdOwner.businessId = createdBusiness._id;
        await createdOwner.save({ session });

        return createdRestaurant;
      })) as HydratedDocument<RestaurantDoc>;
    } catch (err) {
      // The pre-checks above (slug/email/business lookups) narrow the common case to a clean 409,
      // but can't close a genuine race: two concurrent requests for the same slug/email can both
      // pass those checks before either transaction commits. The unique indexes on Restaurant.slug,
      // Business.slug, and User.email are the real backstop — this just translates their raw
      // duplicate-key error into the same clean 409 the pre-check would have given a
      // slightly-slower request.
      if ((err as { code?: number }).code === 11000) {
        throw ApiError.conflict("That restaurant slug or owner email is already in use");
      }
      throw err;
    }
  } finally {
    await session.endSession();
  }

  await recordAuditEvent({
    restaurantId: restaurant._id,
    actorUserId: req.user!.id,
    actorRole: req.user!.role,
    action: "restaurant.created",
    targetType: "restaurant",
    targetId: restaurant._id,
    metadata: existingBusiness ? { addedToExistingBusinessId: existingBusiness._id.toString() } : { ownerEmail: owner!.email },
  });

  // Only the "create a new owner" branch has anyone to invite — the existing-business branch
  // attaches a location to an owner who already has an account and access.
  if (!existingBusiness) {
    const acceptUrl = `${env.ADMIN_ORIGIN}/accept-invite?token=${raw}`;
    try {
      await getEmailService().send(ownerInviteEmail(owner!.email, acceptUrl, { restaurantName: name }));
    } catch (err) {
      logger.error("failed to send owner-invite email", { error: (err as Error).message });
    }
  }

  sendSuccess(res, { restaurant: restaurant.toJSON() }, 201);
}

/**
 * GET /restaurants/:restaurantId/readiness — informational only (the publish endpoint below
 * re-runs this same check server-side rather than trusting a client-cached result). Lets the
 * owner-facing setup page show live progress without attempting (and getting rejected by) an
 * actual publish call.
 */
export async function getRestaurantReadiness(req: Request, res: Response) {
  const restaurant = await Restaurant.findById(req.params.restaurantId);
  if (!restaurant) throw ApiError.notFound("Restaurant not found");
  const readiness = await computeReadiness(restaurant);
  sendSuccess(res, readiness);
}

/**
 * PATCH /restaurants/:restaurantId/publish — the only path from "pending" to "active". Requires
 * restaurant.settings.manage (owner-only, same as every other settings-shaped mutation), and
 * re-validates readiness server-side — the frontend disabling its own Publish button is a UX
 * nicety, not the enforcement point.
 */
export async function publishRestaurant(req: Request, res: Response) {
  const restaurant = await Restaurant.findById(req.params.restaurantId);
  if (!restaurant) throw ApiError.notFound("Restaurant not found");
  if (restaurant.status === "suspended") {
    throw ApiError.badRequest("A suspended restaurant can't be published — contact platform support.");
  }
  if (restaurant.status === "active") {
    sendSuccess(res, { restaurant: restaurant.toJSON() });
    return;
  }

  const readiness = await computeReadiness(restaurant);
  if (!readiness.ready) {
    throw ApiError.badRequest("This restaurant isn't ready to publish yet.", { checks: readiness.checks });
  }

  restaurant.status = "active";
  await restaurant.save();

  await recordAuditEvent({
    restaurantId: restaurant._id,
    actorUserId: req.user!.id,
    actorRole: req.user!.role,
    action: "restaurant.published",
    targetType: "restaurant",
    targetId: restaurant._id,
  });

  sendSuccess(res, { restaurant: restaurant.toJSON() });
}

/**
 * PATCH /restaurants/:restaurantId/unpublish — deliberately restricted to reversing an owner's
 * OWN publish action (active -> pending), never touches "suspended" — that status is exclusively
 * platform_admin's lever (see platform.controller.ts's updateRestaurantStatus) and must not be
 * reachable or clearable from here.
 */
export async function unpublishRestaurant(req: Request, res: Response) {
  const restaurant = await Restaurant.findById(req.params.restaurantId);
  if (!restaurant) throw ApiError.notFound("Restaurant not found");
  if (restaurant.status !== "active") {
    throw ApiError.badRequest("Only a published restaurant can be unpublished.");
  }

  restaurant.status = "pending";
  await restaurant.save();

  await recordAuditEvent({
    restaurantId: restaurant._id,
    actorUserId: req.user!.id,
    actorRole: req.user!.role,
    action: "restaurant.unpublished",
    targetType: "restaurant",
    targetId: restaurant._id,
  });

  sendSuccess(res, { restaurant: restaurant.toJSON() });
}

/**
 * Public storefront resolution (Phase 8's `/r/:restaurantSlug` routing resolves through this) —
 * unauthenticated, so the response is deliberately a lean, customer-safe projection rather than
 * the full document `getMyRestaurant` returns to authenticated staff. `ownerId` is the one field
 * with no legitimate public use (an internal User reference, never read by any storefront code)
 * and is stripped; everything else here is already information a customer needs to browse and
 * order (name, branding, location, ordering-channel availability, tax/fee display, hours).
 */
function toPublicRestaurant(restaurant: HydratedDocument<RestaurantDoc>) {
  const { ownerId: _ownerId, ...publicFields } = restaurant.toJSON();
  return publicFields;
}

export async function getRestaurantBySlug(req: Request, res: Response) {
  const restaurant = await Restaurant.findOne({ slug: req.params.slug, status: "active" });
  if (!restaurant) throw ApiError.notFound("Restaurant not found");
  sendSuccess(res, {
    restaurant: toPublicRestaurant(restaurant),
    availability: computeAvailability(restaurant.settings),
    supportIdentity: getSupportIdentity(restaurant),
  });
}

/**
 * GET /restaurants/by-slug/:slug/preview — authenticated equivalent of the public by-slug lookup
 * above, minus the `status: "active"` filter, so an owner (or platform_admin) can see their own
 * pending/unpublished storefront exactly as a customer eventually will — WITHOUT that storefront
 * ever being reachable by an actual anonymous customer (getRestaurantBySlug's filter is untouched;
 * a pending restaurant still 404s there). Keyed by slug rather than :restaurantId because that's
 * all apps/web's route has to resolve from; tenant match is done here explicitly (there's no
 * :restaurantId URL param for requireTenantMatch() to compare against) since the caller's own
 * restaurantId must match the restaurant this slug resolves to, not just any restaurant they own.
 */
export async function previewRestaurantBySlug(req: Request, res: Response) {
  const restaurant = await Restaurant.findOne({ slug: req.params.slug });
  if (!restaurant) throw ApiError.notFound("Restaurant not found");

  const isOwnTenant = req.user!.role === "platform_admin" || req.user!.restaurantId === restaurant.id;
  if (!isOwnTenant) throw ApiError.forbidden("You do not have access to this restaurant");

  sendSuccess(res, {
    restaurant: toPublicRestaurant(restaurant),
    availability: computeAvailability(restaurant.settings),
    supportIdentity: getSupportIdentity(restaurant),
  });
}

export async function getMyRestaurant(req: Request, res: Response) {
  if (!req.user?.restaurantId) throw ApiError.notFound("You are not associated with a restaurant");
  const restaurant = await Restaurant.findById(req.user.restaurantId);
  if (!restaurant) throw ApiError.notFound("Restaurant not found");
  sendSuccess(res, {
    restaurant: restaurant.toJSON(),
    availability: computeAvailability(restaurant.settings),
    supportIdentity: getSupportIdentity(restaurant),
  });
}

/**
 * Builds a dot-notation $set/$unset pair so a partial `settings` update only touches the fields
 * actually supplied — a plain `{ $set: { settings: partialInput } }` would replace the whole
 * settings subdocument, silently wiping out every setting the caller didn't mention. A top-level
 * field explicitly sent as `null` (e.g. clearing latitude/longitude) is $unset rather than $set,
 * so it disappears from the document instead of persisting as a stored `null`.
 */
function buildRestaurantUpdateOps(input: UpdateRestaurantInput): { set: Record<string, unknown>; unset: Record<string, ""> } {
  const { settings, ...profileFields } = input;
  const set: Record<string, unknown> = {};
  const unset: Record<string, ""> = {};
  for (const [key, value] of Object.entries(profileFields)) {
    if (value === null) unset[key] = "";
    else if (value !== undefined) set[key] = value;
  }
  if (settings) {
    for (const [key, value] of Object.entries(settings)) {
      if (value !== undefined) set[`settings.${key}`] = value;
    }
  }
  return { set, unset };
}

export async function updateRestaurant(req: Request, res: Response) {
  const { restaurantId } = req.params;
  const updates = req.body as UpdateRestaurantInput;

  const { set, unset } = buildRestaurantUpdateOps(updates);

  const filter: Record<string, unknown> = { _id: restaurantId };
  if (updates.settings && (updates.settings.cashEnabled !== undefined || updates.settings.onlinePaymentEnabled !== undefined)) {
    const cashEnabledExpr = updates.settings.cashEnabled !== undefined ? updates.settings.cashEnabled : "$settings.cashEnabled";
    const onlineEnabledExpr =
      updates.settings.onlinePaymentEnabled !== undefined ? updates.settings.onlinePaymentEnabled : "$settings.onlinePaymentEnabled";
    // Re-checked atomically against the STORED value at write time, not just a separate read
    // beforehand — two concurrent requests each disabling a different payment method could
    // otherwise both pass a plain pre-check (each seeing the other method still enabled) before
    // either write actually committed, leaving both disabled. See docs/payment-provider-decision.md.
    filter.$expr = { $or: [{ $eq: [cashEnabledExpr, true] }, { $eq: [onlineEnabledExpr, true] }] };
  }

  const restaurant = await Restaurant.findOneAndUpdate(
    filter,
    { ...(Object.keys(set).length ? { $set: set } : {}), ...(Object.keys(unset).length ? { $unset: unset } : {}) },
    { new: true, runValidators: true }
  );

  if (!restaurant) {
    const exists = await Restaurant.exists({ _id: restaurantId });
    if (!exists) throw ApiError.notFound("Restaurant not found");
    throw ApiError.badRequest("At least one payment method (cash or online) must stay enabled.");
  }
  sendSuccess(res, { restaurant: restaurant.toJSON(), availability: computeAvailability(restaurant.settings) });
}
