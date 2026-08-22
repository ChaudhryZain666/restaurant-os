import type { Request, Response } from "express";
import type {
  ListPlatformRestaurantsQueryInput,
  ListPlatformUsersQueryInput,
  UpdateRestaurantStatusInput,
  UpdateUserStatusInput,
} from "@restaurant/validation";
import type { PlatformRestaurantSummary, PlatformUserSummary } from "@restaurant/types";
import { Restaurant } from "../models/Restaurant.js";
import { User } from "../models/User.js";
import { Order } from "../models/Order.js";
import { SupportTicket } from "../models/SupportTicket.js";
import { AuditLog } from "../models/AuditLog.js";
import { ApiError } from "../utils/ApiError.js";
import { sendSuccess } from "../common/response.js";
import { recordAuditEvent } from "../services/audit.service.js";
import { escapeRegex, paginateQuery } from "../utils/pagination.js";
import { logger } from "../common/logger.js";
import { env } from "../config/env.js";
import { getEmailService } from "../email/index.js";
import { ownerInviteEmail } from "../email/templates.js";
import { generateSecureToken } from "../services/secureToken.service.js";
import { computeReadiness } from "../services/restaurantReadiness.service.js";
import { getRestaurantAnalytics } from "../services/analytics.service.js";

const OWNER_INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Every number here comes straight from a count/aggregate query — there is no cross-restaurant
 * analytics service yet (analytics.service.ts is strictly single-restaurant), so this stays a
 * handful of real counts rather than pretending to be a full platform analytics engine.
 *
 * Phase 12: paginated, and the owner/order-count lookups now only ever run against the ONE
 * page of restaurants being returned — the previous version ran a full Order aggregation across
 * every order on the platform on every single load of this list, regardless of how many
 * restaurants were actually shown.
 */
export async function listPlatformRestaurants(req: Request, res: Response) {
  const { page, limit, search, status, sort, order } = req.query as unknown as ListPlatformRestaurantsQueryInput;

  const filter: Record<string, unknown> = {};
  if (status) filter.status = status;
  if (search) {
    const re = new RegExp(escapeRegex(search), "i");
    filter.$or = [{ name: re }, { slug: re }, { city: re }];
  }

  const result = await paginateQuery(Restaurant.find(filter).sort({ [sort]: order === "asc" ? 1 : -1 }), { page, limit });

  const restaurants = result.items;
  const ownerIds = [...new Set(restaurants.map((r) => r.ownerId.toString()))];
  const restaurantIds = restaurants.map((r) => r._id);
  const [owners, orderCounts] = await Promise.all([
    User.find({ _id: { $in: ownerIds } }).select("name email inviteTokenHash"),
    Order.aggregate([{ $match: { restaurantId: { $in: restaurantIds } } }, { $group: { _id: "$restaurantId", count: { $sum: 1 } } }]),
  ]);
  const ownerById = new Map(owners.map((o) => [o.id as string, o]));
  const orderCountByRestaurant = new Map(orderCounts.map((c) => [c._id.toString(), c.count as number]));

  const items: PlatformRestaurantSummary[] = restaurants.map((r) => {
    const owner = ownerById.get(r.ownerId.toString());
    return {
      id: r.id as string,
      name: r.name,
      slug: r.slug,
      status: r.status,
      city: r.city ?? undefined,
      state: r.state ?? undefined,
      country: r.country ?? undefined,
      ownerName: owner?.name,
      ownerEmail: owner?.email,
      ownerInvitePending: Boolean(owner?.inviteTokenHash),
      orderCount: orderCountByRestaurant.get((r._id as { toString(): string }).toString()) ?? 0,
      createdAt: (r.createdAt as Date).toISOString(),
    };
  });

  sendSuccess(res, { ...result, items });
}

export async function listPlatformUsers(req: Request, res: Response) {
  const { page, limit, search, role, isActive, sort, order } = req.query as unknown as ListPlatformUsersQueryInput;

  const filter: Record<string, unknown> = {};
  if (role) filter.role = role;
  if (isActive !== undefined) filter.isActive = isActive;
  if (search) {
    const re = new RegExp(escapeRegex(search), "i");
    filter.$or = [{ name: re }, { email: re }];
  }

  const result = await paginateQuery(User.find(filter).sort({ [sort]: order === "asc" ? 1 : -1 }), { page, limit });

  const users = result.items;
  const restaurantIds = [...new Set(users.filter((u) => u.restaurantId).map((u) => u.restaurantId!.toString()))];
  const restaurants = await Restaurant.find({ _id: { $in: restaurantIds } }).select("name");
  const restaurantById = new Map(restaurants.map((r) => [r.id as string, r.name]));

  const items: PlatformUserSummary[] = users.map((u) => ({
    id: u.id as string,
    name: u.name,
    email: u.email,
    role: u.role,
    restaurantName: u.restaurantId ? restaurantById.get(u.restaurantId.toString()) : undefined,
    isActive: u.isActive !== false,
    createdAt: (u as unknown as { createdAt: Date }).createdAt.toISOString(),
  }));

  sendSuccess(res, { ...result, items });
}

export async function getPlatformOverview(_req: Request, res: Response) {
  const [totalRestaurants, activeRestaurants, totalUsers, totalOrders, openSupportTickets, recent] = await Promise.all([
    Restaurant.countDocuments(),
    Restaurant.countDocuments({ status: "active" }),
    User.countDocuments(),
    Order.countDocuments(),
    SupportTicket.countDocuments({ status: { $in: ["open", "in_progress", "waiting_customer"] } }),
    Restaurant.find().sort({ createdAt: -1 }).limit(5).select("name status createdAt"),
  ]);

  sendSuccess(res, {
    overview: {
      totalRestaurants,
      activeRestaurants,
      totalUsers,
      totalOrders,
      openSupportTickets,
      recentRestaurants: recent.map((r) => ({
        id: r.id as string,
        name: r.name,
        status: r.status,
        createdAt: (r.createdAt as Date).toISOString(),
      })),
    },
  });
}

/**
 * The single-restaurant counterpart to listPlatformRestaurants — Phase 16's "useful overview page
 * instead of forcing platform admins to work only from list pages." Deliberately its OWN endpoint
 * under /platform rather than routing platform_admin through the owner-permission-gated
 * /restaurants/:id/readiness or /restaurants/:id/analytics routes: those require
 * restaurant.settings.manage / restaurant.analytics.read, which platform_admin does not and should
 * not hold (that would hand platform_admin owner-level WRITE access to every restaurant's
 * settings, not just read access to an overview). This endpoint reuses the exact same underlying
 * services (computeReadiness, getRestaurantAnalytics) in read-only fashion instead, gated only by
 * platform.restaurants.manage — explicit, auditable (every mutating action platform_admin can take
 * from here — status change, invite resend — already records an audit event), and scoped to
 * exactly what a platform admin needs to see, not a blanket permission grant.
 */
export async function getPlatformRestaurantDetail(req: Request, res: Response) {
  const { id } = req.params;
  const restaurant = await Restaurant.findById(id);
  if (!restaurant) throw ApiError.notFound("Restaurant not found");

  const [owner, readiness, analytics, orderCount, recentAuditLog, businessLocationCount] = await Promise.all([
    User.findById(restaurant.ownerId).select("name email phone inviteTokenHash inviteExpiresAt isActive"),
    computeReadiness(restaurant),
    getRestaurantAnalytics(id),
    Order.countDocuments({ restaurantId: restaurant._id }),
    AuditLog.find({ restaurantId: restaurant._id }).sort({ createdAt: -1 }).limit(10),
    // Phase 19 — a light-touch fact only (not a new business/location hierarchy view): lets a
    // platform admin see at a glance that this restaurant is one of several locations under the
    // same business, without building out a dedicated cross-restaurant navigation surface.
    restaurant.businessId ? Restaurant.countDocuments({ businessId: restaurant.businessId }) : Promise.resolve(1),
  ]);

  sendSuccess(res, {
    restaurant: restaurant.toJSON(),
    businessLocationCount,
    owner: owner
      ? {
          id: owner.id as string,
          name: owner.name,
          email: owner.email,
          phone: owner.phone,
          invitePending: Boolean(owner.inviteTokenHash),
          inviteExpiresAt: owner.inviteExpiresAt ?? undefined,
          isActive: owner.isActive !== false,
        }
      : null,
    readiness,
    analytics,
    orderCountLifetime: orderCount,
    recentAuditLog: recentAuditLog.map((a) => a.toJSON()),
  });
}

/**
 * Suspending is the real "disable a tenant" lever: every customer/staff-facing lookup in this
 * codebase already filters on `status: "active"` (menu, by-slug resolution, delivery checks,
 * createOrder, ...), so flipping this to "suspended" makes the restaurant's entire storefront and
 * ordering flow disappear immediately — no separate enforcement needed here, this endpoint is
 * only the missing admin ACTION on top of enforcement that already existed.
 */
export async function updateRestaurantStatus(req: Request, res: Response) {
  const { id } = req.params;
  const { status } = req.body as UpdateRestaurantStatusInput;

  const restaurant = await Restaurant.findById(id);
  if (!restaurant) throw ApiError.notFound("Restaurant not found");

  const previousStatus = restaurant.status;
  restaurant.status = status;
  await restaurant.save();

  await recordAuditEvent({
    restaurantId: restaurant._id,
    actorUserId: req.user!.id,
    actorRole: req.user!.role,
    action: "restaurant.status_changed",
    targetType: "restaurant",
    targetId: restaurant._id,
    metadata: { from: previousStatus, to: status },
  });

  sendSuccess(res, { restaurant: restaurant.toJSON() });
}

/**
 * Regenerates and resends the owner's invite token — the owner may have lost the original email,
 * or its 7-day TTL may have lapsed. A fresh token INVALIDATES the old one (they're the same field,
 * overwritten), so an old, possibly-leaked invite link can never be used after a resend, and only
 * one accept link is ever valid at a time. Refuses once the invite has already been accepted
 * (inviteTokenHash cleared by acceptInvite) — resending at that point would silently reset a real,
 * already-logged-in owner's password to an unusable one, locking them out of their own account.
 */
export async function resendOwnerInvite(req: Request, res: Response) {
  const { id } = req.params;

  const restaurant = await Restaurant.findById(id);
  if (!restaurant) throw ApiError.notFound("Restaurant not found");

  const owner = await User.findById(restaurant.ownerId);
  if (!owner) throw ApiError.notFound("This restaurant's owner account no longer exists");
  if (!owner.inviteTokenHash) {
    throw ApiError.badRequest("This restaurant's owner has already accepted their invitation.");
  }

  const { raw, hash } = generateSecureToken();
  owner.inviteTokenHash = hash;
  owner.inviteExpiresAt = new Date(Date.now() + OWNER_INVITE_TTL_MS);
  await owner.save();

  const acceptUrl = `${env.ADMIN_ORIGIN}/accept-invite?token=${raw}`;
  try {
    await getEmailService().send(ownerInviteEmail(owner.email, acceptUrl, { restaurantName: restaurant.name }));
  } catch (err) {
    logger.error("failed to send owner-invite resend email", { error: (err as Error).message });
  }

  await recordAuditEvent({
    restaurantId: restaurant._id,
    actorUserId: req.user!.id,
    actorRole: req.user!.role,
    action: "restaurant.owner_invite_resent",
    targetType: "restaurant",
    targetId: restaurant._id,
  });

  sendSuccess(res, { message: `Invitation resent to ${owner.email}.` });
}

/**
 * Deactivating already has real teeth without any further change here: login() rejects
 * isActive:false accounts outright, and an already-signed-in session gets logged out on its very
 * next request via apiClient's onSessionExpired (refresh fails once the account is inactive) —
 * see auth.controller.ts and packages/utils/src/apiClient.ts.
 */
export async function updateUserStatus(req: Request, res: Response) {
  const { id } = req.params;
  const { isActive } = req.body as UpdateUserStatusInput;

  if (id === req.user!.id) {
    throw ApiError.badRequest("You cannot change your own account's active status");
  }

  const user = await User.findById(id);
  if (!user) throw ApiError.notFound("User not found");

  user.isActive = isActive;
  await user.save();

  // Only restaurant-scoped users have a restaurant to attach the audit entry to — a platform
  // admin or a customer's status change has no tenant it belongs to, so it's logged to the
  // server log instead of forced into a restaurant's audit trail it isn't part of.
  if (user.restaurantId) {
    await recordAuditEvent({
      restaurantId: user.restaurantId,
      actorUserId: req.user!.id,
      actorRole: req.user!.role,
      action: "user.status_changed",
      targetType: "user",
      targetId: user._id,
      metadata: { isActive },
    });
  }

  sendSuccess(res, { user: user.toJSON() });
}
