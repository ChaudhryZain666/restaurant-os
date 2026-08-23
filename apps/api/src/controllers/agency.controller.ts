import bcrypt from "bcryptjs";
import { randomBytes } from "node:crypto";
import mongoose from "mongoose";
import type { Request, Response } from "express";
import type { HydratedDocument } from "mongoose";
import type { PaginationQueryInput } from "@restaurant/validation";
import type { CreateAgencyBusinessInput, CreateAgencyInput } from "@restaurant/validation";
import type { AgencyAuditLogEntry } from "@restaurant/types";
import { Agency, type AgencyDoc } from "../models/Agency.js";
import { AgencyMembership } from "../models/AgencyMembership.js";
import { AgencyAuditLog } from "../models/AgencyAuditLog.js";
import { Business, type BusinessDoc } from "../models/Business.js";
import { Restaurant, type RestaurantDoc } from "../models/Restaurant.js";
import { Subscription } from "../models/Subscription.js";
import { User } from "../models/User.js";
import { ApiError } from "../utils/ApiError.js";
import { sendSuccess } from "../common/response.js";
import { paginateQuery } from "../utils/pagination.js";
import { logger } from "../common/logger.js";
import { env } from "../config/env.js";
import { getEmailService } from "../email/index.js";
import { ownerInviteEmail } from "../email/templates.js";
import { generateSecureToken } from "../services/secureToken.service.js";
import { recordAuditEvent } from "../services/audit.service.js";
import { recordAgencyAuditEvent } from "../services/agencyAudit.service.js";
import { reserveBusinessSlot } from "../services/agencyEntitlement.service.js";

const OWNER_INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days — matches staff/restaurant invite TTL

/**
 * Self-serve agency creation: any authenticated account without an already-specialized role
 * (customer, or already an agency_member of another agency — Section 3's "belong to multiple
 * agencies") can create one and immediately becomes its agency_owner. A restaurant-scoped role
 * (owner/manager/staff/kitchen_staff) or platform_admin creating an agency in the same identity is
 * a real product question deferred, not silently allowed — see docs' Phase 25 "deliberately out of
 * scope" list. Transactional (Agency + AgencyMembership + optional User.role flip) for the same
 * consistency reason restaurant.controller.ts's createRestaurant is.
 */
export async function createAgency(req: Request, res: Response) {
  const { name, slug, contactEmail, description } = req.body as CreateAgencyInput;

  if (!["customer", "agency_member"].includes(req.user!.role)) {
    throw ApiError.badRequest("This account type cannot create an agency");
  }

  const existingSlug = await Agency.findOne({ slug });
  if (existingSlug) throw ApiError.conflict("That agency slug is already taken");

  const session = await mongoose.startSession();
  let agency: HydratedDocument<AgencyDoc>;
  try {
    try {
      agency = (await session.withTransaction(async () => {
        const [createdAgency] = await Agency.create([{ name, slug, contactEmail, description, status: "active" }], { session });
        await AgencyMembership.create(
          [{ agencyId: createdAgency._id, userId: req.user!.id, role: "agency_owner", status: "active", acceptedAt: new Date() }],
          { session }
        );
        if (req.user!.role === "customer") {
          await User.findByIdAndUpdate(req.user!.id, { $set: { role: "agency_member" } }, { session });
        }
        return createdAgency;
      })) as HydratedDocument<AgencyDoc>;
    } catch (err) {
      if ((err as { code?: number }).code === 11000) throw ApiError.conflict("That agency slug is already taken");
      throw err;
    }
  } finally {
    await session.endSession();
  }

  await recordAgencyAuditEvent({
    agencyId: agency._id,
    actorUserId: req.user!.id,
    actorRole: req.user!.role,
    action: "agency.created",
    targetType: "agency",
    targetId: agency._id,
  });

  // The caller's JWT still reflects their PRE-creation role/agencyMemberships — the frontend must
  // call POST /auth/refresh (which re-derives both fresh) before this new agency/role is usable,
  // same staleness contract every other claim in this codebase already has.
  sendSuccess(res, { agency: agency.toJSON() }, 201);
}

/** GET /agencies/me — every agency this account has an ACTIVE membership in, from the JWT claim
 *  (no DB read for the membership list itself; one bounded read to hydrate the Agency documents). */
export async function getMyAgencies(req: Request, res: Response) {
  const memberships = req.user!.agencyMemberships ?? [];
  const agencies = await Agency.find({ _id: { $in: memberships.map((m) => m.agencyId) } });
  const roleByAgencyId = new Map(memberships.map((m) => [m.agencyId, m.role]));
  sendSuccess(res, {
    agencies: agencies.map((a) => ({ ...a.toJSON(), myRole: roleByAgencyId.get(a.id as string) })),
  });
}

/** GET /agencies/:agencyId — requireAgencyMatch already confirmed access at the route level. */
export async function getAgency(req: Request, res: Response) {
  const { agencyId } = req.params;
  const agency = await Agency.findById(agencyId);
  if (!agency) throw ApiError.notFound("Agency not found");
  sendSuccess(res, { agency: agency.toJSON(), myRole: req.agencyRole });
}

/**
 * GET /agencies/:agencyId/businesses — FOUNDATION ONLY per the brief's explicit allowance
 * (Section 19): per-business summaries (location count, subscription status), never a blended
 * cross-business revenue rollup — that's genuinely new per-currency/per-timezone aggregation work
 * on the scale of Phase 23's business analytics, deliberately deferred, not attempted here.
 */
export async function listAgencyBusinesses(req: Request, res: Response) {
  const { agencyId } = req.params;
  const { page, limit } = req.query as unknown as PaginationQueryInput;

  const result = await paginateQuery(Business.find({ agencyId }).sort({ createdAt: -1 }), { page, limit });
  const businessIds = result.items.map((b) => b._id);

  const [locationCounts, subscriptions, owners] = await Promise.all([
    Restaurant.aggregate([{ $match: { businessId: { $in: businessIds } } }, { $group: { _id: "$businessId", count: { $sum: 1 } } }]),
    Subscription.find({ ownerType: "business", ownerId: { $in: businessIds } }),
    User.find({ _id: { $in: result.items.map((b) => b.ownerId) } }).select("name email inviteTokenHash"),
  ]);
  const countByBusiness = new Map(locationCounts.map((c) => [c._id.toString(), c.count as number]));
  const subscriptionByBusiness = new Map(subscriptions.map((s) => [s.ownerId.toString(), s.status]));
  const ownerById = new Map(owners.map((o) => [o.id as string, o]));

  const items = result.items.map((b) => {
    const owner = ownerById.get(b.ownerId.toString());
    return {
      ...b.toJSON(),
      locationCount: countByBusiness.get((b._id as { toString(): string }).toString()) ?? 0,
      subscriptionStatus: subscriptionByBusiness.get((b._id as { toString(): string }).toString()) ?? null,
      ownerName: owner?.name,
      ownerEmail: owner?.email,
      ownerInvitePending: Boolean(owner?.inviteTokenHash),
    };
  });

  sendSuccess(res, { ...result, items });
}

/**
 * POST /agencies/:agencyId/businesses — mirrors restaurant.controller.ts's createRestaurant
 * transactional shape (owner User + Business + first Restaurant, unusable password + invite
 * token, same accept-invite flow). The agency never authenticates AS the owner — no impersonation,
 * explicit authorization the whole way (see docs' Phase 25 section). The one addition is the
 * atomic business-slot reservation (agencyEntitlement.service.ts), called BEFORE the transaction:
 * a failed reservation must abort the whole operation, not partially commit.
 */
export async function createAgencyBusiness(req: Request, res: Response) {
  const { agencyId } = req.params;
  const { businessName, businessSlug, ownerName, ownerEmail, locationName, locationSlug, timezone, currency } =
    req.body as CreateAgencyBusinessInput;

  const [existingBusinessSlug, existingLocationSlug, existingOwnerEmail] = await Promise.all([
    Business.findOne({ slug: businessSlug }),
    Restaurant.findOne({ slug: locationSlug }),
    User.findOne({ email: ownerEmail }),
  ]);
  if (existingBusinessSlug) throw ApiError.conflict("That business slug is already taken");
  if (existingLocationSlug) throw ApiError.conflict("That location slug is already taken");
  if (existingOwnerEmail) throw ApiError.conflict("An account with this email already exists");

  await reserveBusinessSlot(agencyId);

  const unusablePassword = randomBytes(32).toString("hex");
  const passwordHash = await bcrypt.hash(unusablePassword, 12);
  const { raw, hash } = generateSecureToken();

  const session = await mongoose.startSession();
  let business: HydratedDocument<BusinessDoc>;
  let restaurant: HydratedDocument<RestaurantDoc>;
  try {
    try {
      const result = (await session.withTransaction(async () => {
        const [createdOwner] = await User.create(
          [
            {
              name: ownerName,
              email: ownerEmail,
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
          [{ name: businessName, slug: businessSlug, ownerId: createdOwner._id, agencyId, status: "pending" }],
          { session }
        );

        const [createdRestaurant] = await Restaurant.create(
          [
            {
              name: locationName,
              slug: locationSlug,
              ownerId: createdOwner._id,
              businessId: createdBusiness._id,
              status: "pending",
              settings: { ...(timezone ? { timezone } : {}), ...(currency ? { currency } : {}) },
            },
          ],
          { session }
        );

        createdOwner.restaurantId = createdRestaurant._id;
        createdOwner.businessId = createdBusiness._id;
        await createdOwner.save({ session });

        return { business: createdBusiness, restaurant: createdRestaurant };
      })) as { business: HydratedDocument<BusinessDoc>; restaurant: HydratedDocument<RestaurantDoc> };
      business = result.business;
      restaurant = result.restaurant;
    } catch (err) {
      // The slot was already reserved above — release it since the business was never actually
      // created, otherwise a failed attempt would permanently cost the agency a real slot.
      await Agency.findByIdAndUpdate(agencyId, { $inc: { businessCount: -1 } });
      if ((err as { code?: number }).code === 11000) {
        throw ApiError.conflict("That business/location slug or owner email is already in use");
      }
      throw err;
    }
  } finally {
    await session.endSession();
  }

  await Promise.all([
    recordAgencyAuditEvent({
      agencyId,
      actorUserId: req.user!.id,
      actorRole: req.user!.role,
      action: "agency.business_created",
      targetType: "business",
      targetId: business._id,
      metadata: { businessName },
    }),
    recordAuditEvent({
      restaurantId: restaurant._id,
      actorUserId: req.user!.id,
      actorRole: req.user!.role,
      action: "restaurant.created",
      targetType: "restaurant",
      targetId: restaurant._id,
      metadata: { agencyId, ownerEmail },
    }),
  ]);

  const acceptUrl = `${env.ADMIN_ORIGIN}/accept-invite?token=${raw}`;
  try {
    await getEmailService().send(ownerInviteEmail(ownerEmail, acceptUrl, { restaurantName: businessName }));
  } catch (err) {
    logger.error("failed to send agency-business owner-invite email", { error: (err as Error).message });
  }

  sendSuccess(res, { business: business.toJSON(), restaurant: restaurant.toJSON() }, 201);
}

/**
 * GET /agencies/:agencyId/businesses/:businessId — Phase 26, the entry point for "Manage this
 * business": fuller detail than the list endpoint's per-row summary (full location list, not just
 * a count). Scoped to `agencyId` in the query itself (not just requireAgencyMatch) so a business
 * that belongs to a DIFFERENT agency 404s exactly like "doesn't exist" rather than leaking that it
 * exists under someone else's agency.
 */
export async function getAgencyBusiness(req: Request, res: Response) {
  const { agencyId, businessId } = req.params;

  const business = await Business.findOne({ _id: businessId, agencyId });
  if (!business) throw ApiError.notFound("Business not found");

  const [owner, locations, subscription] = await Promise.all([
    User.findById(business.ownerId).select("name email inviteTokenHash"),
    Restaurant.find({ businessId }).select("name slug status settings.timezone settings.currency").sort({ createdAt: 1 }),
    Subscription.findOne({ ownerType: "business", ownerId: businessId }).select("status planId currentPeriodEnd"),
  ]);

  sendSuccess(res, {
    business: business.toJSON(),
    owner: owner ? { name: owner.name, email: owner.email, invitePending: Boolean(owner.inviteTokenHash) } : null,
    locations: locations.map((l) => l.toJSON()),
    subscription: subscription?.toJSON() ?? null,
  });
}

/**
 * POST /agencies/:agencyId/businesses/:businessId/resend-owner-invite — mirrors
 * platform.controller.ts's resendOwnerInvite / staff.controller.ts's resendStaffInvite exactly
 * (fresh token invalidates the old one; refuses once already accepted). The one difference: the
 * owner here is looked up via Business.ownerId, not a Restaurant's — an agency-created business's
 * owner invite is a business-level concept, even though the email content still names the first
 * location (ownerInviteEmail's existing shape, unchanged from creation time).
 */
export async function resendAgencyBusinessOwnerInvite(req: Request, res: Response) {
  const { agencyId, businessId } = req.params;

  const business = await Business.findOne({ _id: businessId, agencyId });
  if (!business) throw ApiError.notFound("Business not found");

  const owner = await User.findById(business.ownerId);
  if (!owner) throw ApiError.notFound("This business's owner account no longer exists");
  if (!owner.inviteTokenHash) {
    throw ApiError.badRequest("This business's owner has already accepted their invitation.");
  }

  const { raw, hash } = generateSecureToken();
  owner.inviteTokenHash = hash;
  owner.inviteExpiresAt = new Date(Date.now() + OWNER_INVITE_TTL_MS);
  await owner.save();

  const acceptUrl = `${env.ADMIN_ORIGIN}/accept-invite?token=${raw}`;
  try {
    await getEmailService().send(ownerInviteEmail(owner.email, acceptUrl, { restaurantName: business.name }));
  } catch (err) {
    logger.error("failed to send agency-business owner-invite resend email", { error: (err as Error).message });
  }

  await recordAgencyAuditEvent({
    agencyId,
    actorUserId: req.user!.id,
    actorRole: req.user!.role,
    action: "agency.business_owner_invite_resent",
    targetType: "business",
    targetId: business._id,
    metadata: { ownerEmail: owner.email },
  });

  sendSuccess(res, { message: `Invitation resent to ${owner.email}.` });
}

export async function getAgencyAuditLog(req: Request, res: Response) {
  const { agencyId } = req.params;
  const { page, limit } = req.query as unknown as PaginationQueryInput;

  const result = await paginateQuery(AgencyAuditLog.find({ agencyId }).sort({ createdAt: -1 }), { page, limit });

  const actorIds = [...new Set(result.items.map((e) => e.actorUserId.toString()))];
  const actors = await User.find({ _id: { $in: actorIds } }).select("name");
  const actorNameById = new Map(actors.map((a) => [a.id as string, a.name]));

  const items: AgencyAuditLogEntry[] = result.items.map((e) => ({
    ...(e.toJSON() as unknown as Omit<AgencyAuditLogEntry, "actorName">),
    actorName: actorNameById.get(e.actorUserId.toString()),
  }));

  sendSuccess(res, { ...result, items });
}
