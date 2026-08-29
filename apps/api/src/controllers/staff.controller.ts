import bcrypt from "bcryptjs";
import { randomBytes } from "node:crypto";
import type { Request, Response } from "express";
import type { InviteStaffInput, UpdateStaffInput } from "@restaurant/validation";
import { STAFF_ROLES } from "@restaurant/validation";
import { User } from "../models/User.js";
import { Restaurant } from "../models/Restaurant.js";
import { ApiError } from "../utils/ApiError.js";
import { sendSuccess } from "../common/response.js";
import { logger } from "../common/logger.js";
import { env } from "../config/env.js";
import { getEmailService } from "../email/index.js";
import { staffInviteEmail } from "../email/templates.js";
import { generateSecureToken } from "../services/secureToken.service.js";

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

const ROLE_LABELS: Record<string, string> = {
  restaurant_manager: "Manager",
  restaurant_staff: "Staff",
  kitchen_staff: "Kitchen Staff",
};

export async function listStaff(req: Request, res: Response) {
  const { restaurantId } = req.params;
  const staff = await User.find({ restaurantId, role: { $in: STAFF_ROLES } }).sort({ createdAt: 1 });
  sendSuccess(res, { staff: staff.map((s) => s.toJSON()) });
}

/**
 * No password ever passes through this endpoint or an email — the owner names a role, the
 * invitee gets a one-time link (POST /auth/accept-invite) that lets them set their own password.
 * The account is created with a random, immediately-discarded password hash so bcrypt.compare in
 * login() can never succeed against it before the invite is accepted.
 */
export async function inviteStaff(req: Request, res: Response) {
  const { restaurantId } = req.params;
  const { name, email, role, phone } = req.body as InviteStaffInput;

  const existing = await User.findOne({ email });
  if (existing) throw ApiError.conflict("An account with this email already exists");

  const restaurant = await Restaurant.findById(restaurantId);
  if (!restaurant) throw ApiError.notFound("Restaurant not found");
  const inviter = await User.findById(req.user!.id);

  const unusablePassword = randomBytes(32).toString("hex");
  const passwordHash = await bcrypt.hash(unusablePassword, 12);
  const { raw, hash } = generateSecureToken();

  const staff = await User.create({
    name,
    email,
    passwordHash,
    role,
    phone,
    restaurantId,
    // Phase 18, additive — mirrors today's single-location restaurantId assignment exactly
    // (businessId may still be undefined if this restaurant hasn't been migrated yet; locationIds
    // defaults to just this one restaurant, same reach as restaurantId gave before this field
    // existed, extendable later via updateStaff without re-inviting).
    businessId: restaurant.businessId,
    locationIds: [restaurantId],
    isActive: true,
    inviteTokenHash: hash,
    inviteExpiresAt: new Date(Date.now() + INVITE_TTL_MS),
  });

  const acceptUrl = `${env.ADMIN_ORIGIN}/accept-invite?token=${raw}`;
  try {
    await getEmailService().send(
      staffInviteEmail(email, acceptUrl, {
        restaurantName: restaurant.name,
        inviterName: inviter?.name ?? "Your restaurant",
        roleLabel: ROLE_LABELS[role] ?? role,
      })
    );
  } catch (err) {
    logger.error("failed to send staff-invite email", { error: (err as Error).message });
  }

  sendSuccess(res, { staff: staff.toJSON() }, 201);
}

export async function updateStaff(req: Request, res: Response) {
  const { restaurantId, id } = req.params;
  const updates = req.body as UpdateStaffInput;

  // Phase 35 audit fix — CRITICAL: locationIds was previously trusted verbatim from the request
  // body. resolveTenantAccess's staff/kitchen_staff fast path (middleware/tenant.ts) grants access
  // to every restaurant a staff account's locationIds names, with NO further DB check — so an
  // unvalidated locationIds here let any restaurant_owner/manager grant their OWN staff account
  // read/manage access to ANY other restaurant on the platform, just by knowing its id. Every id
  // must be independently confirmed to belong to the SAME business as the caller's own restaurant,
  // exactly like business.controller.ts's cloneFromLocationId already does for the identical class
  // of "id from the request body, must stay inside this business" trust boundary.
  if (updates.locationIds) {
    const callerRestaurant = await Restaurant.findById(restaurantId).select("businessId");
    if (!callerRestaurant) throw ApiError.notFound("Restaurant not found");
    if (!callerRestaurant.businessId) {
      // A legacy, not-yet-multi-location-migrated restaurant has no business to scope within —
      // querying with `businessId: undefined` would silently drop that clause from the filter
      // (Mongoose/Mongo treat an undefined field as "no constraint," not "must be unset"), which
      // would let ANY restaurant id on the platform pass. The only safe grant here is the
      // restaurant's own id, matching inviteStaff's existing single-location default exactly.
      const onlySelf = updates.locationIds.length === 1 && updates.locationIds[0] === restaurantId;
      if (!onlySelf) throw ApiError.badRequest("This restaurant has no business association yet — locationIds can only be its own id");
    } else {
      const validCount = await Restaurant.countDocuments({
        _id: { $in: updates.locationIds },
        businessId: callerRestaurant.businessId,
      });
      if (validCount !== updates.locationIds.length) {
        throw ApiError.badRequest("locationIds must all belong to this staff member's own business");
      }
    }
  }

  // Scoped to STAFF_ROLES so this can never be pointed at the owner account, a platform_admin,
  // or a customer by hand-editing the :id — only real staff rows in this tenant are reachable.
  const staff = await User.findOneAndUpdate(
    { _id: id, restaurantId, role: { $in: STAFF_ROLES } },
    { $set: updates },
    { new: true, runValidators: true }
  );
  if (!staff) throw ApiError.notFound("Staff member not found");
  sendSuccess(res, { staff: staff.toJSON() });
}

/**
 * Mirrors platform.controller.ts's resendOwnerInvite — a fresh token overwrites (invalidates) the
 * old one, so a lost or leaked invite link can never be used after a resend, and refuses once
 * already accepted (inviteTokenHash cleared by acceptInvite) rather than silently resetting a
 * real, already-logged-in staff member's password to an unusable one.
 */
export async function resendStaffInvite(req: Request, res: Response) {
  const { restaurantId, id } = req.params;

  const staff = await User.findOne({ _id: id, restaurantId, role: { $in: STAFF_ROLES } });
  if (!staff) throw ApiError.notFound("Staff member not found");
  if (!staff.inviteTokenHash) {
    throw ApiError.badRequest("This staff member has already accepted their invitation.");
  }

  const restaurant = await Restaurant.findById(restaurantId);
  const inviter = await User.findById(req.user!.id);

  const { raw, hash } = generateSecureToken();
  staff.inviteTokenHash = hash;
  staff.inviteExpiresAt = new Date(Date.now() + INVITE_TTL_MS);
  await staff.save();

  const acceptUrl = `${env.ADMIN_ORIGIN}/accept-invite?token=${raw}`;
  try {
    await getEmailService().send(
      staffInviteEmail(staff.email, acceptUrl, {
        restaurantName: restaurant?.name ?? "Your restaurant",
        inviterName: inviter?.name ?? "Your restaurant",
        roleLabel: ROLE_LABELS[staff.role] ?? staff.role,
      })
    );
  } catch (err) {
    logger.error("failed to send staff-invite resend email", { error: (err as Error).message });
  }

  sendSuccess(res, { staff: staff.toJSON() });
}
