import type { Request, Response } from "express";
import { Business } from "../models/Business.js";
import { Restaurant } from "../models/Restaurant.js";
import { ApiError } from "../utils/ApiError.js";
import { sendSuccess } from "../common/response.js";

/**
 * Phase 18 — the first, deliberately minimal proof surface for the Business/Location foundation.
 * No admin/storefront UI consumes these yet (see docs/multi-tenant-storefront-architecture.md's
 * Phase 18 section) — they exist to prove the JWT-claim -> middleware -> DB-lookup path works over
 * a real HTTP round trip, not just in a unit test of the middleware function.
 */

export async function getMyBusiness(req: Request, res: Response) {
  if (!req.user!.businessId) {
    throw ApiError.notFound("No business is associated with this account yet");
  }
  const business = await Business.findById(req.user!.businessId);
  if (!business) throw ApiError.notFound("Business not found");
  sendSuccess(res, { business: business.toJSON() });
}

export async function listBusinessLocations(req: Request, res: Response) {
  const { businessId } = req.params;
  const locations = await Restaurant.find({ businessId }).sort({ createdAt: 1 });
  sendSuccess(res, { locations: locations.map((l) => l.toJSON()) });
}

export async function getBusinessLocation(req: Request, res: Response) {
  const { businessId, locationId } = req.params;
  // requireLocationAccess already confirmed the caller can reach locationId — this additionally
  // confirms locationId actually belongs to businessId as claimed by the URL itself, the same
  // "never trust the URL's own internal consistency" discipline other nested routes already apply
  // (e.g. modifier routes checking a menuItemId truly belongs to the URL's restaurantId).
  const location = await Restaurant.findOne({ _id: locationId, businessId });
  if (!location) throw ApiError.notFound("Location not found");
  sendSuccess(res, { location: location.toJSON() });
}
