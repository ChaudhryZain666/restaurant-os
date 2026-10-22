import bcrypt from "bcryptjs";
import { randomBytes } from "node:crypto";
import type { HydratedDocument } from "mongoose";
import type { InviteStaffInput } from "@restaurant/validation";
import { User, type UserDoc } from "../models/User.js";
import type { RestaurantDoc } from "../models/Restaurant.js";
import { ApiError } from "../utils/ApiError.js";
import { logger } from "../common/logger.js";
import { env } from "../config/env.js";
import { getEmailService } from "../email/index.js";
import { staffInviteEmail } from "../email/templates.js";
import { generateSecureToken } from "./secureToken.service.js";

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

const ROLE_LABELS: Record<string, string> = {
  restaurant_manager: "Manager",
  restaurant_staff: "Staff",
  kitchen_staff: "Kitchen Staff",
};

/**
 * No password ever passes through here or an email — the inviter names a role, the invitee gets a
 * one-time link (POST /auth/accept-invite) that lets them set their own password. The account is
 * created with a random, immediately-discarded password hash so bcrypt.compare in login() can never
 * succeed against it before the invite is accepted.
 *
 * Shared by the owner-facing POST /restaurants/:id/staff (staff.controller.ts) and the demo-access
 * script (productionDemo.service.ts's inviteDemoManager). `emailSent` is false when the invite
 * email failed to send — the account still exists and the owner can resend it.
 */
export async function createStaffInvite(
  restaurant: HydratedDocument<RestaurantDoc>,
  { name, email, role, phone }: InviteStaffInput,
  inviterName: string
): Promise<{ staff: HydratedDocument<UserDoc>; emailSent: boolean }> {
  const existing = await User.findOne({ email });
  if (existing) throw ApiError.conflict("An account with this email already exists");

  const passwordHash = await bcrypt.hash(randomBytes(32).toString("hex"), 12);
  const { raw, hash } = generateSecureToken();

  // Phase 49 — the pre-check above narrows the common case, but can't close a genuine race: two
  // concurrent invites (or an invite racing a self-registration) for the same email can both pass
  // it before either insert commits. User.email's unique index is the real backstop; this
  // translates its raw duplicate-key error into the same clean 409 the pre-check would have given
  // a slightly-slower request, rather than letting it surface as an unhandled 500.
  let staff: HydratedDocument<UserDoc>;
  try {
    staff = await User.create({
      name,
      email,
      passwordHash,
      role,
      phone,
      restaurantId: restaurant._id,
      // Phase 18, additive — mirrors today's single-location restaurantId assignment exactly
      // (businessId may still be undefined if this restaurant hasn't been migrated yet; locationIds
      // defaults to just this one restaurant, same reach as restaurantId gave before this field
      // existed, extendable later via updateStaff without re-inviting).
      businessId: restaurant.businessId,
      locationIds: [restaurant._id],
      isActive: true,
      inviteTokenHash: hash,
      inviteExpiresAt: new Date(Date.now() + INVITE_TTL_MS),
    });
  } catch (err) {
    if ((err as { code?: number }).code === 11000) {
      throw ApiError.conflict("An account with this email already exists");
    }
    throw err;
  }

  const acceptUrl = `${env.ADMIN_ORIGIN}/accept-invite?token=${raw}`;
  let emailSent = true;
  try {
    await getEmailService().send(
      staffInviteEmail(email, acceptUrl, {
        restaurantName: restaurant.name,
        inviterName,
        roleLabel: ROLE_LABELS[role] ?? role,
      })
    );
  } catch (err) {
    emailSent = false;
    logger.error("failed to send staff-invite email", { error: (err as Error).message });
  }

  return { staff, emailSent };
}

export { INVITE_TTL_MS, ROLE_LABELS };
