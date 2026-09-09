import bcrypt from "bcryptjs";
import { randomBytes } from "node:crypto";
import mongoose from "mongoose";
import type { Request, Response } from "express";
import type { HydratedDocument } from "mongoose";
import type { PaginationQueryInput } from "@restaurant/validation";
import type {
  CreateAgencyBusinessInput,
  CreateAgencyInput,
  ListAgencyBusinessesQueryInput,
  SetAgencyDomainInput,
  SetClientCommercialTermsInput,
  UpdateAgencyInput,
} from "@restaurant/validation";
import type { AgencyAuditLogEntry } from "@restaurant/types";
import { Agency, type AgencyDoc } from "../models/Agency.js";
import { AgencyMembership } from "../models/AgencyMembership.js";
import { AgencyAuditLog } from "../models/AgencyAuditLog.js";
import { Business, type BusinessDoc } from "../models/Business.js";
import { Restaurant, type RestaurantDoc } from "../models/Restaurant.js";
import { Subscription } from "../models/Subscription.js";
import { Plan } from "../models/Plan.js";
import { ClientCommercialTerms } from "../models/ClientCommercialTerms.js";
import { DomainMapping } from "../models/DomainMapping.js";
import { User } from "../models/User.js";
import { ApiError } from "../utils/ApiError.js";
import { sendSuccess } from "../common/response.js";
import { escapeRegex, paginateQuery } from "../utils/pagination.js";
import { logger } from "../common/logger.js";
import { env } from "../config/env.js";
import { getEmailService } from "../email/index.js";
import { ownerInviteEmail } from "../email/templates.js";
import { generateSecureToken, generateTemporaryPassword } from "../services/secureToken.service.js";
import { recordAuditEvent } from "../services/audit.service.js";
import { recordAgencyAuditEvent } from "../services/agencyAudit.service.js";
import { reserveBusinessSlot, getAgencyEntitlements } from "../services/agencyEntitlement.service.js";
import { getSubscriptionForAgency } from "../services/subscription.service.js";
import { computeAvailability } from "../services/restaurantAvailability.service.js";
import { computeReadiness } from "../services/restaurantReadiness.service.js";
import { checkDomainVerification, generateVerificationToken, isSelfClaim, verificationRecordHost } from "../services/domainVerification.service.js";

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
  const { page, limit, search, status, sort, order } = req.query as unknown as ListAgencyBusinessesQueryInput;

  const filter: Record<string, unknown> = { agencyId };

  // "inactive"/"onboarding" map directly onto Business.status. "live"/"owner_pending"/
  // "multi_location" are derived (owner-invite state, live location count — same states
  // businessJourneyStage already computes client-side) and need their matching business ids
  // pre-resolved before the paginated query, since neither is a field stored on Business itself.
  // Every pre-resolution query here is scoped to THIS agency's own businesses only — bounded by one
  // agency's portfolio size, never a platform-wide scan.
  if (status === "inactive") filter.status = "suspended";
  else if (status === "onboarding") filter.status = "pending";
  else if (status === "live" || status === "owner_pending" || status === "multi_location") {
    const scopedBusinesses = await Business.find({ agencyId }).select("_id ownerId");
    if (status === "multi_location") {
      const counts = await Restaurant.aggregate<{ _id: mongoose.Types.ObjectId }>([
        { $match: { businessId: { $in: scopedBusinesses.map((b) => b._id) } } },
        { $group: { _id: "$businessId", count: { $sum: 1 } } },
        { $match: { count: { $gt: 1 } } },
      ]);
      filter._id = { $in: counts.map((c) => c._id) };
    } else {
      const owners = await User.find({ _id: { $in: scopedBusinesses.map((b) => b.ownerId) } }).select("inviteTokenHash");
      const pendingOwnerIds = new Set(owners.filter((o) => o.inviteTokenHash).map((o) => o.id as string));
      const wantPending = status === "owner_pending";
      filter._id = {
        $in: scopedBusinesses
          .filter((b) => pendingOwnerIds.has(b.ownerId.toString()) === wantPending)
          .map((b) => b._id),
      };
      if (status === "live") filter.status = "active";
    }
  }

  if (search) {
    const re = new RegExp(escapeRegex(search), "i");
    const matchingOwners = await User.find({ role: "restaurant_owner", $or: [{ name: re }, { email: re }] }).select("_id");
    const orClauses: Record<string, unknown>[] = [{ name: re }];
    if (matchingOwners.length > 0) orClauses.push({ ownerId: { $in: matchingOwners.map((o) => o._id) } });
    filter.$or = orClauses;
  }

  const result = await paginateQuery(Business.find(filter).sort({ [sort]: order === "asc" ? 1 : -1 }), { page, limit });
  const businessIds = result.items.map((b) => b._id);

  const [locationCounts, subscriptions, owners, domainCounts] = await Promise.all([
    Restaurant.aggregate([{ $match: { businessId: { $in: businessIds } } }, { $group: { _id: "$businessId", count: { $sum: 1 } } }]),
    Subscription.find({ ownerType: "business", ownerId: { $in: businessIds } }),
    User.find({ _id: { $in: result.items.map((b) => b.ownerId) } }).select("name email inviteTokenHash"),
    // Phase 28 — same read-only visibility pattern platform.controller.ts's getPlatformRestaurantDetail
    // already uses for domains: count only, never a write surface here (domain management itself
    // stays owner-only via DomainSettingsPanel.tsx, unchanged).
    DomainMapping.aggregate([{ $match: { businessId: { $in: businessIds } } }, { $group: { _id: "$businessId", count: { $sum: 1 } } }]),
  ]);
  const countByBusiness = new Map(locationCounts.map((c) => [c._id.toString(), c.count as number]));
  const subscriptionByBusiness = new Map(subscriptions.map((s) => [s.ownerId.toString(), s.status]));
  const ownerById = new Map(owners.map((o) => [o.id as string, o]));
  const domainCountByBusiness = new Map(domainCounts.map((c) => [c._id.toString(), c.count as number]));

  const items = result.items.map((b) => {
    const owner = ownerById.get(b.ownerId.toString());
    return {
      ...b.toJSON(),
      locationCount: countByBusiness.get((b._id as { toString(): string }).toString()) ?? 0,
      subscriptionStatus: subscriptionByBusiness.get((b._id as { toString(): string }).toString()) ?? null,
      ownerName: owner?.name,
      ownerEmail: owner?.email,
      ownerInvitePending: Boolean(owner?.inviteTokenHash),
      domainCount: domainCountByBusiness.get((b._id as { toString(): string }).toString()) ?? 0,
    };
  });

  sendSuccess(res, { ...result, items });
}

/**
 * POST /agencies/:agencyId/businesses — mirrors restaurant.controller.ts's createRestaurant
 * transactional shape (owner User + Business + first Restaurant, same accept-invite flow for the
 * default mode). The agency never authenticates AS the owner — no impersonation for the default
 * "invite" mode. The one addition is the atomic business-slot reservation
 * (agencyEntitlement.service.ts), called BEFORE the transaction: a failed reservation must abort
 * the whole operation, not partially commit.
 *
 * Phase 28 — `provisioningMode: "direct"` is a deliberate, audited exception to that no-
 * impersonation principle, confirmed with the product owner: the agency gets a real, system-
 * generated one-time password (never agency-typed — see secureToken.service.ts's
 * generateTemporaryPassword) to relay to the owner out of band, instead of an email invite. The
 * owner still always sets their OWN real password before doing anything else — `mustChangePassword`
 * forces that on first login (see middleware/auth.ts) — the agency's knowledge of a working
 * credential is intentionally short-lived, not a standing capability. The plaintext password is
 * returned exactly once, in this response, never logged, never persisted anywhere but the bcrypt
 * hash.
 */
export async function createAgencyBusiness(req: Request, res: Response) {
  const { agencyId } = req.params;
  const { businessName, businessSlug, ownerName, ownerEmail, locationName, locationSlug, timezone, currency, provisioningMode } =
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

  const isDirect = provisioningMode === "direct";
  const temporaryPassword = isDirect ? generateTemporaryPassword() : randomBytes(32).toString("hex");
  const passwordHash = await bcrypt.hash(temporaryPassword, 12);
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
              // "direct" mode: real access immediately, no invite token, but forced to set a real
              // password before reaching anything else. "invite" mode: unchanged Phase 25 behavior.
              ...(isDirect
                ? { mustChangePassword: true }
                : { inviteTokenHash: hash, inviteExpiresAt: new Date(Date.now() + OWNER_INVITE_TTL_MS) }),
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
      action: isDirect ? "agency.business_owner_access_created" : "agency.business_created",
      targetType: "business",
      targetId: business._id,
      metadata: { businessName, provisioningMode },
    }),
    recordAuditEvent({
      restaurantId: restaurant._id,
      actorUserId: req.user!.id,
      actorRole: req.user!.role,
      action: "restaurant.created",
      targetType: "restaurant",
      targetId: restaurant._id,
      metadata: { agencyId, ownerEmail, provisioningMode },
    }),
  ]);

  if (isDirect) {
    // No email round-trip for this mode — the agency relays the credential out of band. Returned
    // exactly once; nothing about it is persisted or logged anywhere beyond this response and the
    // bcrypt hash already saved above.
    sendSuccess(
      res,
      { business: business.toJSON(), restaurant: restaurant.toJSON(), ownerTemporaryPassword: temporaryPassword },
      201
    );
    return;
  }

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

  const [owner, locations, subscription, domains, commercialTerms] = await Promise.all([
    User.findById(business.ownerId).select("name email inviteTokenHash"),
    Restaurant.find({ businessId }).select("name slug status settings.timezone settings.currency").sort({ createdAt: 1 }),
    Subscription.findOne({ ownerType: "business", ownerId: businessId }).select("status planId currentPeriodEnd"),
    // Phase 28 — read-only visibility only (status/hostname), same reasoning as
    // listAgencyBusinesses's domainCount: management stays owner-only via DomainSettingsPanel.tsx.
    DomainMapping.find({ businessId }).select("hostname status"),
    // Phase 59 — informational only, see ClientCommercialTerms.ts's doc comment. Absence (null) IS
    // "not configured," not an error state.
    ClientCommercialTerms.findOne({ businessId }),
  ]);

  sendSuccess(res, {
    business: business.toJSON(),
    owner: owner ? { name: owner.name, email: owner.email, invitePending: Boolean(owner.inviteTokenHash) } : null,
    locations: locations.map((l) => l.toJSON()),
    subscription: subscription?.toJSON() ?? null,
    domains: domains.map((d) => d.toJSON()),
    commercialTerms: commercialTerms?.toJSON() ?? null,
  });
}

/**
 * PUT /agencies/:agencyId/businesses/:businessId/commercial-terms — Phase 59. Records what THIS
 * agency charges its OWN client; never a payment-collection action (no provider, no webhook, no
 * invoice — see ClientCommercialTerms.ts's doc comment). Upserts so the agency can set-then-adjust
 * terms freely; `agencyId` is re-confirmed against the URL's on every write (never trusted from the
 * body) exactly like every other write in this file. Scoped the same "404, not 403, for a business
 * managed by a different agency" way as getAgencyBusiness/resendAgencyBusinessOwnerInvite, so a
 * caller can never distinguish "doesn't exist" from "belongs to someone else's agency."
 */
export async function setClientCommercialTerms(req: Request, res: Response) {
  const { agencyId, businessId } = req.params;
  const updates = req.body as SetClientCommercialTermsInput;

  const business = await Business.findOne({ _id: businessId, agencyId });
  if (!business) throw ApiError.notFound("Business not found");

  const terms = await ClientCommercialTerms.findOneAndUpdate(
    { businessId },
    { $set: { ...updates, agencyId, businessId } },
    { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true }
  );

  await recordAgencyAuditEvent({
    agencyId,
    actorUserId: req.user!.id,
    actorRole: req.user!.role,
    action: "agency.client_commercial_terms_updated",
    targetType: "business",
    targetId: business._id,
    metadata: { businessName: business.name },
  });

  sendSuccess(res, { commercialTerms: terms.toJSON() });
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

/**
 * GET /agencies/:agencyId/dashboard — Phase 28. Every figure here is a real query, most of them
 * reusing data other endpoints already compute per-row (listAgencyBusinesses' status/owner-invite
 * fields, getSubscriptionForAgency, getAgencyEntitlements) — no new data model, and no blended/fake
 * metric. Modeled directly on platform.controller.ts's getPlatformOverview/getPlatformRevenue
 * pattern, just agency-scoped instead of platform-wide.
 */
export async function getAgencyDashboard(req: Request, res: Response) {
  const { agencyId } = req.params;

  const businesses = await Business.find({ agencyId }).select("name status locationCount ownerId").sort({ createdAt: -1 });
  const businessIds = businesses.map((b) => b._id);
  const ownerIds = businesses.map((b) => b.ownerId);

  const [subscription, usage, pendingMemberInvites, owners, businessIdsWithDomain, locationsTotal] = await Promise.all([
    getSubscriptionForAgency(agencyId),
    getAgencyEntitlements(agencyId),
    AgencyMembership.countDocuments({ agencyId, status: "invited" }),
    User.find({ _id: { $in: ownerIds } }).select("inviteTokenHash"),
    DomainMapping.distinct("businessId", { businessId: { $in: businessIds } }),
    // Portal UX audit (Phase 53) — Business.locationCount deliberately excludes each business's
    // guaranteed first location (see createAgencyBusiness/createBusinessSelfServe's own doc
    // comments: "a brand-new business's first location is never itself limited by a location
    // count"), so summing it here undercounted every agency-created business by exactly one and
    // disagreed with what listAgencyBusinesses' own per-row count (a live Restaurant aggregate)
    // already correctly shows. A live count, not the entitlement counter, is the right source for
    // "how many locations does this agency actually manage" — that counter's job is enforcing a
    // plan limit, not reporting a fact.
    Restaurant.countDocuments({ businessId: { $in: businessIds } }),
  ]);
  const plan = subscription ? await Plan.findById(subscription.planId) : null;
  const inviteByOwnerId = new Map(owners.map((o) => [(o.id as string), Boolean(o.inviteTokenHash)]));

  // Portal UX phase — turns the existing "N still need setup" count into an actionable list: the
  // real businesses behind that number, so the dashboard links straight to what needs attention
  // instead of leaving the agency to go hunt for it in the full Businesses list. Same fields
  // listAgencyBusinesses already computes per-row — no new data model, capped at 5 (most-recent
  // first) since this is a "what's next" surface, not the full list (which already exists at
  // /agency/businesses).
  const attentionBusinesses = businesses
    .filter((b) => b.status === "pending" || inviteByOwnerId.get(b.ownerId.toString()))
    .slice(0, 5)
    .map((b) => ({
      id: b.id as string,
      name: b.name,
      status: b.status,
      ownerInvitePending: inviteByOwnerId.get(b.ownerId.toString()) ?? false,
    }));

  sendSuccess(res, {
    subscription: subscription ? subscription.toJSON() : null,
    plan: plan ? plan.toJSON() : null,
    usage,
    businessCount: businesses.length,
    activeBusinessCount: businesses.filter((b) => b.status === "active").length,
    // "pending" = created but the owner hasn't finished onboarding (accepted invite / set up their
    // own access yet) — distinct from "suspended", which is a different, unrelated state.
    businessesNeedingSetup: businesses.filter((b) => b.status === "pending").length,
    attentionBusinesses,
    locationsTotal,
    domainsConfiguredCount: businessIdsWithDomain.length,
    pendingOwnerInvites: owners.filter((o) => Boolean(o.inviteTokenHash)).length,
    pendingMemberInvites,
  });
}

/**
 * GET /agencies/:agencyId/locations — Portal UX phase. Locations were only ever visible nested
 * inside a single business's own detail page (getAgencyBusiness) — there was no flat "every
 * location I manage" view across the whole client portfolio. Read-only aggregation over the
 * existing Business/Restaurant models (no schema change); `availability` reuses the exact
 * Phase 51 `computeAvailability()` every other read path calls — not a second engine. A curated
 * field selection (not the full Restaurant document), matching the minimal-exposure precedent
 * already set by getAgencyBusiness's own location list.
 */
export async function getAgencyLocations(req: Request, res: Response) {
  const { agencyId } = req.params;
  const { page, limit } = req.query as unknown as PaginationQueryInput;

  const businesses = await Business.find({ agencyId }).select("name");
  const businessIds = businesses.map((b) => b._id);
  const businessNameById = new Map(businesses.map((b) => [(b._id as { toString(): string }).toString(), b.name]));

  const result = await paginateQuery(
    Restaurant.find({ businessId: { $in: businessIds } })
      .select(
        "name slug city businessId status settings.timezone settings.businessHours settings.orderingEnabled settings.temporarilyPaused settings.pausedReason"
      )
      .sort({ createdAt: -1 }),
    { page, limit }
  );

  const items = result.items.map((r) => ({
    id: r.id as string,
    name: r.name,
    slug: r.slug,
    city: r.city,
    status: r.status,
    businessId: r.businessId?.toString(),
    businessName: businessNameById.get(r.businessId?.toString() ?? "") ?? "—",
    timezone: r.settings.timezone,
    availability: computeAvailability(r.settings),
  }));

  sendSuccess(res, { ...result, items });
}

/**
 * GET /agencies/:agencyId/locations/:locationId — Phase 58 Section 14, the location drill-down
 * AgencyLocationsPage's flat list previously had no page to link into. Scoped by resolving the
 * location's OWN businessId and confirming it belongs to this agency (mirrors getAgencyBusiness's
 * "404, not 403, for a location under a different agency" reasoning) — never trusts the location id
 * alone. Deliberately NOT a second Restaurant Owner Portal (Section 14's own warning): portfolio
 * visibility only — identity, availability, setup readiness, owner relationship, storefront link —
 * no menu/order/staff management surfaces.
 */
export async function getAgencyLocationDetail(req: Request, res: Response) {
  const { agencyId, locationId } = req.params;

  const location = await Restaurant.findById(locationId);
  if (!location || !location.businessId) throw ApiError.notFound("Location not found");

  const business = await Business.findOne({ _id: location.businessId, agencyId });
  if (!business) throw ApiError.notFound("Location not found");

  const [owner, readiness] = await Promise.all([
    User.findById(business.ownerId).select("name email inviteTokenHash"),
    computeReadiness(location),
  ]);

  sendSuccess(res, {
    business: { id: business.id as string, name: business.name },
    location: location.toJSON(),
    owner: owner ? { name: owner.name, email: owner.email, invitePending: Boolean(owner.inviteTokenHash) } : null,
    availability: computeAvailability(location.settings),
    readiness,
    storefrontUrl: `${env.CLIENT_ORIGIN}/r/${location.slug}`,
  });
}

/**
 * PATCH /agencies/:agencyId — profile/branding edits only (name/description/logo/contactEmail).
 * Slug is immutable (see updateAgencySchema's doc comment).
 */
export async function updateAgency(req: Request, res: Response) {
  const { agencyId } = req.params;
  const updates = req.body as UpdateAgencyInput;

  const agency = await Agency.findByIdAndUpdate(agencyId, { $set: updates }, { new: true, runValidators: true });
  if (!agency) throw ApiError.notFound("Agency not found");

  await recordAgencyAuditEvent({
    agencyId,
    actorUserId: req.user!.id,
    actorRole: req.user!.role,
    action: "agency.updated",
    targetType: "agency",
    targetId: agency._id,
  });

  sendSuccess(res, { agency: agency.toJSON() });
}

/**
 * POST /agencies/:agencyId/domain — Phase 58 Section 12A. Records a CANDIDATE white-label domain
 * and starts ownership verification, reusing domainVerification.service.ts's exact DNS-TXT
 * mechanism DomainMapping already established for location custom domains — not a new verification
 * system. Setting/verifying this domain does NOT enable sending email from it or branding
 * invitation emails (no per-tenant email-sending infrastructure exists yet — see
 * docs/agency-white-label-domain.md); it establishes ownership only, which is the real prerequisite
 * for that future work, not a substitute for it.
 */
export async function setAgencyDomain(req: Request, res: Response) {
  const { agencyId } = req.params;
  const { domain } = req.body as SetAgencyDomainInput;

  if (isSelfClaim(domain, new URL(env.CLIENT_ORIGIN).hostname) || isSelfClaim(domain, new URL(env.ADMIN_ORIGIN).hostname)) {
    throw ApiError.badRequest("This platform's own domain can't be claimed as a white-label domain");
  }

  const agency = await Agency.findByIdAndUpdate(
    agencyId,
    { $set: { domain, domainStatus: "pending_verification", domainVerificationToken: generateVerificationToken(), domainVerifiedAt: undefined } },
    { new: true, runValidators: true }
  );
  if (!agency) throw ApiError.notFound("Agency not found");

  await recordAgencyAuditEvent({
    agencyId,
    actorUserId: req.user!.id,
    actorRole: req.user!.role,
    action: "agency.domain_set",
    targetType: "agency",
    targetId: agency._id,
    metadata: { domain },
  });

  sendSuccess(res, { agency: agency.toJSON(), verificationRecordHost: verificationRecordHost(domain) }, 201);
}

/** POST /agencies/:agencyId/domain/verify — idempotent, safe to call any number of times; never
 *  activates email-sending or anything beyond flipping domainStatus (see setAgencyDomain's comment
 *  on exactly what verification does and doesn't unlock). */
export async function verifyAgencyDomain(req: Request, res: Response) {
  const { agencyId } = req.params;

  const agency = await Agency.findById(agencyId);
  if (!agency) throw ApiError.notFound("Agency not found");
  if (!agency.domain || !agency.domainVerificationToken) {
    throw ApiError.badRequest("No domain has been configured for this agency yet");
  }

  const verified = await checkDomainVerification(agency.domain, agency.domainVerificationToken);
  if (verified && agency.domainStatus !== "verified") {
    agency.domainStatus = "verified";
    agency.domainVerifiedAt = new Date();
    await agency.save();
    await recordAgencyAuditEvent({
      agencyId,
      actorUserId: req.user!.id,
      actorRole: req.user!.role,
      action: "agency.domain_verified",
      targetType: "agency",
      targetId: agency._id,
      metadata: { domain: agency.domain },
    });
  }

  sendSuccess(res, { verified, agency: agency.toJSON() });
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
