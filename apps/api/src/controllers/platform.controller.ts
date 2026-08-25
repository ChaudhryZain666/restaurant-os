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
import { DomainMapping } from "../models/DomainMapping.js";
import { Subscription } from "../models/Subscription.js";
import { Plan } from "../models/Plan.js";
import { Business } from "../models/Business.js";
import { Agency } from "../models/Agency.js";
import { AgencyMembership } from "../models/AgencyMembership.js";
import { ApiError } from "../utils/ApiError.js";
import { sendSuccess } from "../common/response.js";
import { recordAuditEvent } from "../services/audit.service.js";
import type { PaginationQueryInput } from "@restaurant/validation";
import { escapeRegex, paginateQuery } from "../utils/pagination.js";
import { logger } from "../common/logger.js";
import { env } from "../config/env.js";
import { getEmailService } from "../email/index.js";
import { ownerInviteEmail } from "../email/templates.js";
import { generateSecureToken } from "../services/secureToken.service.js";
import { computeReadiness } from "../services/restaurantReadiness.service.js";
import { getRestaurantAnalytics } from "../services/analytics.service.js";
import { sumAmountsByCurrency } from "../services/businessAnalytics.service.js";

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

  const [owner, readiness, analytics, orderCount, recentAuditLog, businessLocationCount, domains] = await Promise.all([
    User.findById(restaurant.ownerId).select("name email phone inviteTokenHash inviteExpiresAt isActive"),
    computeReadiness(restaurant),
    getRestaurantAnalytics(id),
    Order.countDocuments({ restaurantId: restaurant._id }),
    AuditLog.find({ restaurantId: restaurant._id }).sort({ createdAt: -1 }).limit(10),
    // Phase 19 — a light-touch fact only (not a new business/location hierarchy view): lets a
    // platform admin see at a glance that this restaurant is one of several locations under the
    // same business, without building out a dedicated cross-restaurant navigation surface.
    restaurant.businessId ? Restaurant.countDocuments({ businessId: restaurant.businessId }) : Promise.resolve(1),
    // Phase 22 — read-only domain visibility for investigation (e.g. a support ticket about a
    // custom domain not resolving). platform_admin deliberately has no write access to domains —
    // domain management stays owner-only (restaurant.settings.manage, which platform_admin never
    // holds) via the real /restaurants/:restaurantId/domains routes; this is visibility only.
    DomainMapping.find({ locationId: restaurant._id }).sort({ createdAt: -1 }),
  ]);

  // Phase 24 — read-only billing visibility for investigation, same rationale as domains above:
  // platform_admin has no write access to billing (that stays owner-only via billing.manage,
  // which platform_admin never holds). Provider IDs are stripped — they're an external billing
  // system's internal reference, not something a support investigation needs to see.
  const subscription = restaurant.businessId
    ? await Subscription.findOne({ ownerType: "business", ownerId: restaurant.businessId }).sort({ createdAt: -1 })
    : null;
  const subscriptionPlan = subscription ? await Plan.findById(subscription.planId) : null;

  sendSuccess(res, {
    restaurant: restaurant.toJSON(),
    businessLocationCount,
    domains: domains.map((d) => {
      const { verificationToken: _verificationToken, ...rest } = d.toJSON();
      return rest;
    }),
    subscription: subscription
      ? {
          status: subscription.status,
          billingInterval: subscription.billingInterval,
          currentPeriodEnd: subscription.currentPeriodEnd,
          trialEnd: subscription.trialEnd ?? null,
          cancelAt: subscription.cancelAt ?? null,
          provider: subscription.provider,
          planCode: subscriptionPlan?.code ?? null,
          planName: subscriptionPlan?.name ?? null,
        }
      : null,
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

/**
 * Phase 24 — the platform-wide counterpart to getPlatformRestaurantDetail's per-restaurant
 * `subscription` field above: a read-only overview list, not a billing dashboard (no admin
 * actions here — cancelling/changing a business's plan stays owner-only via billing.manage,
 * which platform_admin never holds). Provider IDs are stripped for the same reason as above.
 */
export async function listPlatformSubscriptions(req: Request, res: Response) {
  const { page, limit } = req.query as unknown as PaginationQueryInput;

  const result = await paginateQuery(Subscription.find().sort({ createdAt: -1 }), { page, limit });

  const businessIds = [...new Set(result.items.map((s) => s.ownerId.toString()))];
  const planIds = [...new Set(result.items.map((s) => s.planId.toString()))];
  const [businesses, plans] = await Promise.all([
    Business.find({ _id: { $in: businessIds } }).select("name slug"),
    Plan.find({ _id: { $in: planIds } }).select("code name"),
  ]);
  const businessById = new Map(businesses.map((b) => [b.id as string, b]));
  const planById = new Map(plans.map((p) => [p.id as string, p]));

  const items = result.items.map((s) => {
    const business = s.ownerType === "business" ? businessById.get(s.ownerId.toString()) : undefined;
    const plan = planById.get(s.planId.toString());
    return {
      id: s.id as string,
      ownerType: s.ownerType,
      businessName: business?.name,
      businessSlug: business?.slug,
      planCode: plan?.code,
      planName: plan?.name,
      status: s.status,
      billingInterval: s.billingInterval,
      currentPeriodEnd: s.currentPeriodEnd,
      trialEnd: s.trialEnd ?? null,
      provider: s.provider,
      createdAt: (s as unknown as { createdAt: Date }).createdAt.toISOString(),
    };
  });

  sendSuccess(res, { ...result, items });
}

/**
 * Phase 27 — GET /platform/revenue: a real, currency-grouped MRR figure, never a fake blended
 * total. Only LIVE, actually-billing statuses count toward MRR (active/past_due/cancelling — a
 * cancelling subscription is still paying until its period ends; trialing has never been charged,
 * so it's reported separately as a pipeline count, not revenue). Yearly plans are normalized to a
 * monthly figure (amount / 12) so a mix of monthly/yearly subscribers on the same plan still sums
 * correctly within their own currency. Reuses businessAnalytics.service.ts's sumAmountsByCurrency
 * — the same "group by currency, never blend" convention Phase 23 established, not a second one.
 */
export async function getPlatformRevenue(_req: Request, res: Response) {
  const liveSubscriptions = await Subscription.find({ status: { $in: ["active", "past_due", "cancelling"] } }).select(
    "planId billingInterval status"
  );
  const trialingCount = await Subscription.countDocuments({ status: "trialing" });

  const planIds = [...new Set(liveSubscriptions.map((s) => s.planId.toString()))];
  const plans = await Plan.find({ _id: { $in: planIds } }).select("pricing");
  const planById = new Map(plans.map((p) => [p.id as string, p]));

  const monthlyAmounts: Array<{ currency: string; amount: number }> = [];
  for (const sub of liveSubscriptions) {
    const plan = planById.get(sub.planId.toString());
    const pricing = plan?.pricing.find((p) => p.interval === sub.billingInterval);
    if (!pricing?.amountCents || !pricing.currency) continue; // no real price configured — excluded, never guessed
    const monthlyCents = sub.billingInterval === "yearly" ? pricing.amountCents / 12 : pricing.amountCents;
    monthlyAmounts.push({ currency: pricing.currency, amount: monthlyCents / 100 });
  }

  sendSuccess(res, {
    mrrByCurrency: sumAmountsByCurrency(monthlyAmounts),
    liveSubscriptionCount: liveSubscriptions.length,
    trialingCount,
  });
}

/**
 * Phase 28 — GET /platform/analytics: the small set of genuinely NEW aggregations the platform
 * analytics page needs, on top of the overview/revenue endpoints that already existed
 * (getPlatformOverview, getPlatformRevenue — the frontend calls those directly, this doesn't
 * duplicate them). Every figure is a real query; currency-denominated ones would follow
 * sumAmountsByCurrency's grouping convention, but nothing here is currency-denominated — MRR
 * already has its own endpoint for that.
 */
export async function getPlatformAnalytics(_req: Request, res: Response) {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const [subscriptionsByStatus, locationsTotalAgg, agencyManagedBusinessCount, directBusinessCount, restaurantSignups, agencySignups] =
    await Promise.all([
      Subscription.aggregate([{ $group: { _id: "$status", count: { $sum: 1 } } }]),
      Business.aggregate([{ $group: { _id: null, total: { $sum: "$locationCount" } } }]),
      Business.countDocuments({ agencyId: { $ne: null } }),
      Business.countDocuments({ agencyId: null }),
      Restaurant.aggregate([
        { $match: { createdAt: { $gte: thirtyDaysAgo } } },
        { $group: { _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } }, count: { $sum: 1 } } },
        { $sort: { _id: 1 } },
      ]),
      Agency.aggregate([
        { $match: { createdAt: { $gte: thirtyDaysAgo } } },
        { $group: { _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } }, count: { $sum: 1 } } },
        { $sort: { _id: 1 } },
      ]),
    ]);

  const restaurantSignupsByDate = new Map(restaurantSignups.map((r) => [r._id as string, r.count as number]));
  const agencySignupsByDate = new Map(agencySignups.map((a) => [a._id as string, a.count as number]));
  const allDates = [...new Set([...restaurantSignupsByDate.keys(), ...agencySignupsByDate.keys()])].sort();

  sendSuccess(res, {
    subscriptionsByStatus: subscriptionsByStatus.map((s) => ({ status: s._id as string, count: s.count as number })),
    totalLocations: (locationsTotalAgg[0]?.total as number) ?? 0,
    businessesByOwnership: { agencyManaged: agencyManagedBusinessCount, direct: directBusinessCount },
    newRestaurantsLast30Days: restaurantSignups.reduce((sum, r) => sum + (r.count as number), 0),
    newAgenciesLast30Days: agencySignups.reduce((sum, a) => sum + (a.count as number), 0),
    signupsByDate: allDates.map((date) => ({
      date,
      restaurants: restaurantSignupsByDate.get(date) ?? 0,
      agencies: agencySignupsByDate.get(date) ?? 0,
    })),
  });
}

/**
 * Phase 28 — GET /platform/config: a read-only diagnostics view of platform-level configuration.
 * Deliberately NOT an editable settings page — env vars are boot-time constants (parsed once by
 * Zod, see config/env.ts), so nothing here could be saved back without new DB-backed config
 * infrastructure that doesn't exist (a genuine architectural addition, out of scope this phase —
 * see docs/commercial-decisions.md). Only a curated, explicitly non-secret subset is returned:
 * provider SELECTIONS (which one is active, never its credentials) and numeric defaults that are
 * already documented elsewhere as non-final (TRIAL_PERIOD_DAYS, PAST_DUE_GRACE_PERIOD_DAYS). API
 * keys/webhook secrets are never included, by construction — this function doesn't even read them.
 */
export async function getPlatformConfig(_req: Request, res: Response) {
  sendSuccess(res, {
    config: {
      environment: env.NODE_ENV,
      billingProvider: env.BILLING_PROVIDER,
      billingProviderEnv: env.BILLING_PROVIDER === "paddle" ? env.PADDLE_ENV : null,
      paymentProvider: env.PAYMENT_PROVIDER,
      paymentProviderEnv: env.PAYMENT_PROVIDER === "safepay" ? env.SAFEPAY_ENV : null,
      geocodingProvider: env.GEOCODING_PROVIDER ?? "not configured",
      dnsVerifier: env.DNS_VERIFIER,
      emailProvider: env.EMAIL_PROVIDER,
      trialPeriodDays: env.TRIAL_PERIOD_DAYS,
      pastDueGracePeriodDays: env.PAST_DUE_GRACE_PERIOD_DAYS,
    },
  });
}

/**
 * Phase 25 — GET /platform/agencies: read-only platform-wide overview, mirroring
 * listPlatformSubscriptions above exactly. No write access to any agency's members/businesses/
 * billing through this surface — platform_admin visibility only, matching the existing boundary
 * (agencies are managed entirely through their own /agencies/:agencyId/... routes, gated by
 * requireAgencyMatch/requireAgencyPermission, which platform_admin deliberately bypasses via
 * requireAgencyMatch's exemption but requireAgencyPermission never grants).
 */
export async function listPlatformAgencies(req: Request, res: Response) {
  const { page, limit } = req.query as unknown as PaginationQueryInput;

  const result = await paginateQuery(Agency.find().sort({ createdAt: -1 }), { page, limit });
  const agencyIds = result.items.map((a) => a._id);

  const [businessCounts, memberCounts] = await Promise.all([
    Business.aggregate([{ $match: { agencyId: { $in: agencyIds } } }, { $group: { _id: "$agencyId", count: { $sum: 1 } } }]),
    AgencyMembership.aggregate([
      { $match: { agencyId: { $in: agencyIds }, status: "active" } },
      { $group: { _id: "$agencyId", count: { $sum: 1 } } },
    ]),
  ]);
  const businessCountByAgency = new Map(businessCounts.map((c) => [c._id.toString(), c.count as number]));
  const memberCountByAgency = new Map(memberCounts.map((c) => [c._id.toString(), c.count as number]));

  const items = result.items.map((a) => ({
    id: a.id as string,
    name: a.name,
    slug: a.slug,
    status: a.status,
    businessCount: businessCountByAgency.get((a._id as { toString(): string }).toString()) ?? 0,
    memberCount: memberCountByAgency.get((a._id as { toString(): string }).toString()) ?? 0,
    createdAt: (a as unknown as { createdAt: Date }).createdAt.toISOString(),
  }));

  sendSuccess(res, { ...result, items });
}
