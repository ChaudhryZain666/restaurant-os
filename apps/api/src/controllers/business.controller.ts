import mongoose from "mongoose";
import type { Request, Response } from "express";
import type { HydratedDocument } from "mongoose";
import type { CreateLocationInput } from "@restaurant/validation";
import { Business } from "../models/Business.js";
import { Restaurant, type RestaurantDoc } from "../models/Restaurant.js";
import { ApiError } from "../utils/ApiError.js";
import { sendSuccess } from "../common/response.js";
import { recordAuditEvent } from "../services/audit.service.js";
import { cloneMenuToRestaurant } from "../services/menuClone.service.js";

/**
 * Phase 18 — the first, deliberately minimal proof surface for the Business/Location foundation.
 * Phase 19 wires the first real UI on top of these (an admin "Locations" page) and adds the
 * owner-facing creation endpoint below.
 */

export async function getMyBusiness(req: Request, res: Response) {
  if (!req.user!.businessId) {
    throw ApiError.notFound("No business is associated with this account yet");
  }
  const business = await Business.findById(req.user!.businessId);
  if (!business) throw ApiError.notFound("Business not found");
  sendSuccess(res, { business: business.toJSON() });
}

/**
 * Phase 19 fix: staff/kitchen_staff only ever see the locations they're actually scoped to via
 * locationIds — requireBusinessMatch only checks businessId equality (correctly, that's its one
 * job), so without this filter a staff member explicitly restricted to one location could still
 * see every sibling location's name/slug/address here, even though every other route correctly
 * denies them access to actually operate those locations. Owner/manager/platform_admin keep
 * seeing every location under the business, matching their implicit business-wide access
 * elsewhere (see middleware/tenant.ts's requireTenantMatch).
 */
export async function listBusinessLocations(req: Request, res: Response) {
  const { businessId } = req.params;
  const isScopedStaff = req.user!.role === "restaurant_staff" || req.user!.role === "kitchen_staff";
  const filter = isScopedStaff ? { businessId, _id: { $in: req.user!.locationIds ?? [] } } : { businessId };
  const locations = await Restaurant.find(filter).sort({ createdAt: 1 });
  sendSuccess(res, { locations: locations.map((l) => l.toJSON()) });
}

export async function getBusinessLocation(req: Request, res: Response) {
  const { businessId, locationId } = req.params;
  // requireTenantMatch('locationId') already confirmed the caller can reach locationId — this
  // additionally confirms locationId actually belongs to businessId as claimed by the URL itself,
  // the same "never trust the URL's own internal consistency" discipline other nested routes
  // already apply (e.g. modifier routes checking a menuItemId truly belongs to the URL's
  // restaurantId).
  const location = await Restaurant.findOne({ _id: locationId, businessId });
  if (!location) throw ApiError.notFound("Location not found");
  sendSuccess(res, { location: location.toJSON() });
}

/**
 * POST /businesses/:businessId/locations — the owner-facing counterpart to
 * restaurant.controller.ts's createRestaurant businessId-branch. Deliberately a separate route
 * rather than widening POST /restaurants (platform_admin-only, a different trust model — that
 * route also handles onboarding an entirely new business from scratch) to accept owner callers.
 * requireBusinessMatch + requirePermission("restaurant.settings.manage") on the route already
 * guarantee :businessId is the caller's own business and the caller holds the owner-only
 * permission — this function never re-derives authorization from the request body.
 *
 * No owner is created or invited: the business's existing owner already has implicit access to
 * every location under their businessId (see middleware/tenant.ts's requireTenantMatch), so
 * there's nothing to invite. This intentionally duplicates, rather than imports,
 * createRestaurant's existing-business Restaurant.create block — the two call sites have
 * different input shapes and different surrounding concerns (owner creation, invite email), and
 * the shared logic is small enough that a forced abstraction would cost more clarity than it saves.
 *
 * Phase 19 — an optional `cloneFromLocationId` copies another location's menu into this new one
 * (see menuClone.service.ts) inside the SAME transaction as the location's own creation, so a
 * failure partway through rolls back cleanly rather than leaving a half-set-up location with an
 * empty menu and no retry path. cloneFromLocationId is independently re-verified to actually
 * belong to this same business — never trusted from the request body alone, since a client could
 * otherwise name an arbitrary restaurantId and clone a completely unrelated business's menu.
 */
export async function createLocationForBusiness(req: Request, res: Response) {
  const { businessId } = req.params;
  const { name, slug, timezone, currency, cloneFromLocationId } = req.body as CreateLocationInput;

  const business = await Business.findById(businessId);
  if (!business) throw ApiError.notFound("Business not found");

  const existingSlug = await Restaurant.findOne({ slug });
  if (existingSlug) throw ApiError.conflict("That restaurant slug is already taken");

  let cloneSourceId: mongoose.Types.ObjectId | null = null;
  if (cloneFromLocationId) {
    const cloneSource = await Restaurant.findOne({ _id: cloneFromLocationId, businessId: business._id });
    if (!cloneSource) throw ApiError.badRequest("cloneFromLocationId must be one of this business's own locations");
    cloneSourceId = cloneSource._id;
  }

  const session = await mongoose.startSession();
  let restaurant: HydratedDocument<RestaurantDoc>;
  try {
    try {
      restaurant = (await session.withTransaction(async () => {
        const [createdRestaurant] = await Restaurant.create(
          [
            {
              name,
              slug,
              ownerId: business.ownerId,
              businessId: business._id,
              status: "pending",
              settings: {
                ...(timezone ? { timezone } : {}),
                ...(currency ? { currency } : {}),
              },
            },
          ],
          { session }
        );
        if (cloneSourceId) {
          await cloneMenuToRestaurant(cloneSourceId, createdRestaurant._id, session);
        }
        return createdRestaurant;
      })) as HydratedDocument<RestaurantDoc>;
    } catch (err) {
      if ((err as { code?: number }).code === 11000) {
        throw ApiError.conflict("That restaurant slug is already in use");
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
    metadata: { businessId: business._id.toString(), createdViaOwnerLocationRoute: true, clonedMenuFrom: cloneSourceId?.toString() },
  });

  sendSuccess(res, { restaurant: restaurant.toJSON() }, 201);
}
