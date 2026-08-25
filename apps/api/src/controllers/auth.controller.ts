import bcrypt from "bcryptjs";
import type { Request, Response } from "express";
import type { HydratedDocument } from "mongoose";
import type {
  AcceptInviteInput,
  ChangePasswordInput,
  ConfirmEmailChangeInput,
  DeleteMeInput,
  LoginInput,
  RegisterInput,
  RequestEmailChangeInput,
  RequestPasswordResetInput,
  ResetPasswordInput,
  UpdateProfileInput,
} from "@restaurant/validation";
import { User, type UserDoc } from "../models/User.js";
import { ApiError } from "../utils/ApiError.js";
import { sendSuccess } from "../common/response.js";
import { logger } from "../common/logger.js";
import { env } from "../config/env.js";
import { getEmailService } from "../email/index.js";
import { emailChangeVerificationEmail, passwordResetEmail } from "../email/templates.js";
import type { AgencyMembershipRole } from "@restaurant/types";
import { generateSecureToken, hashToken } from "../services/secureToken.service.js";
import {
  issueRefreshToken,
  isRefreshTokenActive,
  revokeAllRefreshTokens,
  revokeRefreshToken,
  signAccessToken,
  verifyRefreshToken,
} from "../services/token.service.js";
import { getActiveAgencyMemberships } from "../services/agencyMembership.service.js";

const PASSWORD_RESET_TTL_MS = 60 * 60 * 1000; // 1 hour
const EMAIL_CHANGE_TTL_MS = 60 * 60 * 1000; // 1 hour

/** Only ever trusts an Origin that's actually one of our own two frontends, so an email link can
 *  never be pointed at an attacker-controlled host via a spoofed request header. */
function resolveAppOrigin(req: Request): string {
  const origin = req.headers.origin;
  if (origin === env.ADMIN_ORIGIN) return env.ADMIN_ORIGIN;
  return env.CLIENT_ORIGIN;
}

const REFRESH_COOKIE = "refreshToken";

function setRefreshCookie(res: Response, token: string) {
  res.cookie(REFRESH_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/api/v1/auth",
    maxAge: 30 * 24 * 60 * 60 * 1000,
  });
}

/** Exported (Phase 25) — agencyMembership.controller.ts's acceptInvite reuses this exact shape so
 *  accepting an agency invite logs the person in the same way accepting a staff/owner invite does. */
export function toPublicUser(user: HydratedDocument<UserDoc>, agencyMemberships: Array<{ agencyId: string; role: AgencyMembershipRole }> = []) {
  return {
    id: user.id as string,
    name: user.name,
    email: user.email,
    role: user.role,
    restaurantId: user.restaurantId?.toString(),
    businessId: user.businessId?.toString(),
    locationIds: user.locationIds?.map((id) => id.toString()),
    agencyMemberships,
    phone: user.phone,
    mustChangePassword: user.mustChangePassword ?? false,
  };
}

/** Exported (Phase 25) — reused by agencyMembership.controller.ts's acceptInvite. */
export async function issueSession(
  res: Response,
  user: HydratedDocument<UserDoc>,
  agencyMemberships: Array<{ agencyId: string; role: AgencyMembershipRole }>
) {
  const accessToken = signAccessToken({
    sub: user.id as string,
    role: user.role,
    restaurantId: user.restaurantId?.toString(),
    // Phase 18, additive — re-derived from the CURRENT user document every time a session is
    // issued (login, refresh, accept-invite, ...), never carried forward from an old token, so a
    // location grant change (see staff.controller.ts's updateStaff) takes effect on next
    // login/refresh rather than never.
    businessId: user.businessId?.toString(),
    locationIds: user.locationIds?.map((id) => id.toString()),
    // Phase 25 — same reasoning, re-queried fresh by the caller (getActiveAgencyMemberships) every
    // time a session is issued, never carried forward.
    agencyMemberships,
    mustChangePassword: user.mustChangePassword ?? false,
  });
  const refreshToken = await issueRefreshToken(user.id);
  setRefreshCookie(res, refreshToken);
  return accessToken;
}

export async function register(req: Request, res: Response) {
  const { name, email, password, phone } = req.body as RegisterInput;

  const existing = await User.findOne({ email });
  if (existing) throw ApiError.conflict("An account with this email already exists");

  const passwordHash = await bcrypt.hash(password, 12);
  const user = await User.create({ name, email, passwordHash, phone });

  // A brand-new account can't have any agency memberships yet — skip the query.
  const accessToken = await issueSession(res, user, []);
  sendSuccess(res, { user: toPublicUser(user), accessToken }, 201);
}

export async function login(req: Request, res: Response) {
  const { email, password } = req.body as LoginInput;

  const user = await User.findOne({ email });
  if (!user) throw ApiError.unauthorized("Invalid email or password");

  const valid = await bcrypt.compare(password, user.passwordHash as string);
  if (!valid) throw ApiError.unauthorized("Invalid email or password");

  if (user.isActive === false) throw ApiError.forbidden("This account has been deactivated");

  const agencyMemberships = await getActiveAgencyMemberships(user.id as string);
  const accessToken = await issueSession(res, user, agencyMemberships);
  sendSuccess(res, { user: toPublicUser(user, agencyMemberships), accessToken });
}

export async function refresh(req: Request, res: Response) {
  const token = req.cookies?.[REFRESH_COOKIE];
  if (!token) throw ApiError.unauthorized("Missing refresh token");

  let payload;
  try {
    payload = verifyRefreshToken(token);
  } catch {
    throw ApiError.unauthorized("Invalid or expired refresh token");
  }

  const active = await isRefreshTokenActive(payload.sub, payload.jti);
  if (!active) throw ApiError.unauthorized("Refresh token has been revoked");

  const user = await User.findById(payload.sub);
  if (!user) throw ApiError.unauthorized("User no longer exists");
  if (user.isActive === false) throw ApiError.forbidden("This account has been deactivated");

  await revokeRefreshToken(payload.sub, payload.jti);
  const agencyMemberships = await getActiveAgencyMemberships(user.id as string);
  const accessToken = await issueSession(res, user, agencyMemberships);
  sendSuccess(res, { accessToken });
}

export async function me(req: Request, res: Response) {
  const user = await User.findById(req.user!.id);
  if (!user) throw ApiError.unauthorized("User no longer exists");
  const agencyMemberships = await getActiveAgencyMemberships(user.id as string);
  sendSuccess(res, { user: toPublicUser(user, agencyMemberships) });
}

export async function updateMe(req: Request, res: Response) {
  const updates = req.body as UpdateProfileInput;
  const user = await User.findByIdAndUpdate(req.user!.id, { $set: updates }, { new: true, runValidators: true });
  if (!user) throw ApiError.unauthorized("User no longer exists");
  const agencyMemberships = await getActiveAgencyMemberships(user.id as string);
  sendSuccess(res, { user: toPublicUser(user, agencyMemberships) });
}

export async function requestPasswordReset(req: Request, res: Response) {
  const { email } = req.body as RequestPasswordResetInput;
  const user = await User.findOne({ email });

  // Identical response whether or not the account exists — the one thing this endpoint must
  // never reveal is which emails are registered.
  if (user) {
    const { raw, hash } = generateSecureToken();
    user.passwordResetTokenHash = hash;
    user.passwordResetExpiresAt = new Date(Date.now() + PASSWORD_RESET_TTL_MS);
    await user.save();

    const resetUrl = `${resolveAppOrigin(req)}/reset-password?token=${raw}`;
    try {
      await getEmailService().send(passwordResetEmail(user.email, resetUrl));
    } catch (err) {
      logger.error("failed to send password-reset email", { error: (err as Error).message });
    }
  }

  sendSuccess(res, { message: "If an account with that email exists, a reset link has been sent." });
}

export async function resetPassword(req: Request, res: Response) {
  const { token, password } = req.body as ResetPasswordInput;
  const passwordHash = await bcrypt.hash(password, 12);

  // Atomic find-and-clear — same reasoning as acceptInvite: the token match and its invalidation
  // happen in one DB operation, so two concurrent requests presenting the same still-valid token
  // can't both succeed. The old findOne-then-save left a window where both requests' findOne
  // succeeded before either save() cleared the token, making the token replayable.
  const user = await User.findOneAndUpdate(
    { passwordResetTokenHash: hashToken(token), passwordResetExpiresAt: { $gt: new Date() } },
    { $set: { passwordHash }, $unset: { passwordResetTokenHash: "", passwordResetExpiresAt: "" } },
    { new: true }
  );
  if (!user) throw ApiError.badRequest("This reset link is invalid or has expired");

  // A password reset is exactly the moment every existing session should stop working —
  // revokeAllRefreshTokens already existed for this purpose but had no caller until now.
  await revokeAllRefreshTokens(user.id as string);

  sendSuccess(res, { message: "Password updated. Please sign in again." });
}

export async function acceptInvite(req: Request, res: Response) {
  const { token, password } = req.body as AcceptInviteInput;
  const passwordHash = await bcrypt.hash(password, 12);

  // Atomic find-and-clear: the token match and its invalidation happen in the same DB operation,
  // so two concurrent requests presenting the same still-valid token (a double-click, or a
  // replay racing a legitimate accept) can't both succeed — only the one whose update actually
  // matched a document wins; the loser sees the exact same "invalid or expired" response a
  // sequential replay would get. A plain findOne-then-save (this codebase's older pattern, see
  // resetPassword) leaves a window where both requests' findOne succeeds before either save()
  // clears the token.
  const user = await User.findOneAndUpdate(
    { inviteTokenHash: hashToken(token), inviteExpiresAt: { $gt: new Date() } },
    { $set: { passwordHash }, $unset: { inviteTokenHash: "", inviteExpiresAt: "" } },
    { new: true }
  );
  if (!user) throw ApiError.badRequest("This invitation link is invalid or has expired");

  const agencyMemberships = await getActiveAgencyMemberships(user.id as string);
  const accessToken = await issueSession(res, user, agencyMemberships);
  sendSuccess(res, { user: toPublicUser(user, agencyMemberships), accessToken });
}

/**
 * Self-service password change (Phase 12) — re-authenticates with the CURRENT password (an
 * already-valid access token alone isn't enough for a security-sensitive change like this; the
 * same bar the codebase already holds resetPassword/acceptInvite to). Every OTHER session is
 * revoked exactly like resetPassword already does, but unlike resetPassword this issues a fresh
 * session immediately after — the tab that just changed the password shouldn't be forced to log
 * back in for its own action, only every OTHER session should stop working.
 */
export async function changePassword(req: Request, res: Response) {
  const { currentPassword, newPassword } = req.body as ChangePasswordInput;

  const user = await User.findById(req.user!.id);
  if (!user) throw ApiError.unauthorized("User no longer exists");

  const valid = await bcrypt.compare(currentPassword, user.passwordHash as string);
  if (!valid) throw ApiError.badRequest("Current password is incorrect");

  user.passwordHash = await bcrypt.hash(newPassword, 12);
  // Phase 28 — this is also how a temporary-password (agency-provisioned "direct access") account
  // clears mustChangePassword: the same re-authenticate-then-set-a-new-password flow works whether
  // "current password" is a real long-term password or a one-time temporary one. No separate
  // endpoint needed.
  user.mustChangePassword = false;
  await user.save();
  await revokeAllRefreshTokens(user.id as string);

  const agencyMemberships = await getActiveAgencyMemberships(user.id as string);
  const accessToken = await issueSession(res, user, agencyMemberships);
  sendSuccess(res, { user: toPublicUser(user, agencyMemberships), accessToken });
}

/**
 * Step 1 of 2 for a self-service email change: re-authenticates with the current password (same
 * reasoning as changePassword above), then emails a verification link to the NEW address — never
 * the old one — because confirming the account holder actually controls that inbox is the entire
 * point. `email` itself is untouched until confirmEmailChange actually uses that link; a user who
 * never clicks it keeps logging in with their original address indefinitely.
 */
export async function requestEmailChange(req: Request, res: Response) {
  const { newEmail, currentPassword } = req.body as RequestEmailChangeInput;

  const user = await User.findById(req.user!.id);
  if (!user) throw ApiError.unauthorized("User no longer exists");

  const valid = await bcrypt.compare(currentPassword, user.passwordHash as string);
  if (!valid) throw ApiError.badRequest("Current password is incorrect");

  if (newEmail === user.email) throw ApiError.badRequest("That's already your current email address");

  const existing = await User.findOne({ email: newEmail });
  if (existing) throw ApiError.conflict("An account with this email already exists");

  const { raw, hash } = generateSecureToken();
  user.pendingEmail = newEmail;
  user.emailChangeTokenHash = hash;
  user.emailChangeExpiresAt = new Date(Date.now() + EMAIL_CHANGE_TTL_MS);
  await user.save();

  const confirmUrl = `${resolveAppOrigin(req)}/confirm-email-change?token=${raw}`;
  try {
    await getEmailService().send(emailChangeVerificationEmail(newEmail, confirmUrl));
  } catch (err) {
    logger.error("failed to send email-change verification email", { error: (err as Error).message });
  }

  sendSuccess(res, { message: `A confirmation link has been sent to ${newEmail}.` });
}

export async function confirmEmailChange(req: Request, res: Response) {
  const { token } = req.body as ConfirmEmailChangeInput;

  const user = await User.findOne({
    emailChangeTokenHash: hashToken(token),
    emailChangeExpiresAt: { $gt: new Date() },
  });
  if (!user || !user.pendingEmail) throw ApiError.badRequest("This confirmation link is invalid or has expired");

  // Re-checked here, not just at request time — another account could have taken this address in
  // the interim between requesting and confirming.
  const stillAvailable = await User.findOne({ email: user.pendingEmail, _id: { $ne: user._id } });
  if (stillAvailable) throw ApiError.conflict("An account with this email already exists");

  user.email = user.pendingEmail;
  user.pendingEmail = undefined;
  user.emailChangeTokenHash = undefined;
  user.emailChangeExpiresAt = undefined;
  await user.save();

  sendSuccess(res, { message: "Your email address has been updated.", email: user.email });
}

/**
 * Self-service account deletion — customer accounts only. Restaurant-scoped roles (owner/manager/
 * staff/kitchen_staff) are refused outright: an owner "deleting themselves" raises real questions
 * (what happens to the restaurant? its staff? its orders?) that are a product decision, not
 * something safe to guess at here — see docs/roadmap.md. A customer account has no such
 * dependents, but their Orders/AuditLog entries still reference this User's id and must keep
 * resolving for the restaurant's own order/audit history, so this ANONYMIZES the document rather
 * than removing it: passwordHash is overwritten with an unguessable, un-hashable-back value
 * (login() would reject it as an incorrect password even if isActive/deletedAt checks somehow
 * didn't), isActive becomes false (the same flag that already blocks a staff-deactivated login),
 * and every PII field is scrubbed.
 */
export async function deleteMe(req: Request, res: Response) {
  const { currentPassword } = req.body as DeleteMeInput;

  const user = await User.findById(req.user!.id);
  if (!user) throw ApiError.unauthorized("User no longer exists");

  if (user.role !== "customer") {
    throw ApiError.badRequest(
      "Restaurant staff and owner accounts can't be self-deleted here — contact platform support to transfer ownership or remove your staff access first."
    );
  }

  const valid = await bcrypt.compare(currentPassword, user.passwordHash as string);
  if (!valid) throw ApiError.badRequest("Current password is incorrect");

  user.name = "Deleted user";
  user.email = `deleted-${user.id}@deleted.invalid`;
  user.passwordHash = await bcrypt.hash(generateSecureToken().raw, 12);
  user.phone = undefined;
  user.addresses = [];
  user.isActive = false;
  user.deletedAt = new Date();
  user.pendingEmail = undefined;
  user.emailChangeTokenHash = undefined;
  user.emailChangeExpiresAt = undefined;
  user.passwordResetTokenHash = undefined;
  user.passwordResetExpiresAt = undefined;
  await user.save();
  await revokeAllRefreshTokens(user.id as string);

  res.clearCookie(REFRESH_COOKIE, { path: "/api/v1/auth" });
  sendSuccess(res, { message: "Your account has been deleted." });
}

export async function logout(req: Request, res: Response) {
  const token = req.cookies?.[REFRESH_COOKIE];
  if (token) {
    try {
      const payload = verifyRefreshToken(token);
      await revokeRefreshToken(payload.sub, payload.jti);
    } catch {
      // token already invalid/expired — nothing to revoke
    }
  }
  res.clearCookie(REFRESH_COOKIE, { path: "/api/v1/auth" });
  res.status(204).send();
}
