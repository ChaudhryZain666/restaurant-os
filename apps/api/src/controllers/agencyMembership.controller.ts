import bcrypt from "bcryptjs";
import { randomBytes } from "node:crypto";
import type { Request, Response } from "express";
import type { AcceptAgencyInviteInput, InviteAgencyMemberInput, UpdateAgencyMembershipInput } from "@restaurant/validation";
import { Agency } from "../models/Agency.js";
import { AgencyMembership } from "../models/AgencyMembership.js";
import { User } from "../models/User.js";
import { ApiError } from "../utils/ApiError.js";
import { sendSuccess } from "../common/response.js";
import { logger } from "../common/logger.js";
import { env } from "../config/env.js";
import { getEmailService } from "../email/index.js";
import { agencyMemberInviteEmail } from "../email/templates.js";
import { generateSecureToken, hashToken } from "../services/secureToken.service.js";
import { recordAgencyAuditEvent } from "../services/agencyAudit.service.js";
import { getActiveAgencyMemberships } from "../services/agencyMembership.service.js";
import { issueSession, toPublicUser } from "./auth.controller.js";

const MEMBER_INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days — matches staff/owner invite TTL

const AGENCY_ROLE_LABELS: Record<string, string> = {
  agency_owner: "Owner",
  agency_admin: "Admin",
  agency_staff: "Staff",
};

export async function listMembers(req: Request, res: Response) {
  const { agencyId } = req.params;
  const memberships = await AgencyMembership.find({ agencyId, status: { $ne: "revoked" } }).sort({ createdAt: 1 });
  const users = await User.find({ _id: { $in: memberships.map((m) => m.userId) } }).select("name email");
  const userById = new Map(users.map((u) => [u.id as string, u]));

  const members = memberships.map((m) => {
    const user = userById.get(m.userId.toString());
    return { ...m.toJSON(), name: user?.name, email: user?.email };
  });
  sendSuccess(res, { members });
}

/**
 * Looks up the invitee by email first — attaches to an EXISTING account rather than creating a
 * duplicate when one exists (a person could already be a platform user). Only accounts with role
 * "customer" or already "agency_member" (of another agency — Section 3's "belong to multiple
 * agencies") can be invited, same restriction agency.controller.ts's createAgency applies to
 * self-serve creation — mixing a restaurant-scoped or platform_admin identity with agency
 * membership is a real product question deferred, not silently allowed.
 *
 * A brand-new person reuses the standard unusable-password + User.inviteTokenHash mechanism
 * (exactly like staff/owner invites) using the SAME raw token this function returns, so ONE accept
 * call can set both their password and activate the membership. An existing account only ever gets
 * the membership's OWN inviteTokenHash touched — their password/User document is untouched.
 */
export async function inviteMember(req: Request, res: Response) {
  const { agencyId } = req.params;
  const { name, email, role } = req.body as InviteAgencyMemberInput;

  const agency = await Agency.findById(agencyId);
  if (!agency) throw ApiError.notFound("Agency not found");

  let user = await User.findOne({ email });
  if (user && !["customer", "agency_member"].includes(user.role)) {
    throw ApiError.badRequest("This account type cannot be added as an agency member");
  }

  const { raw, hash } = generateSecureToken();
  const inviteExpiresAt = new Date(Date.now() + MEMBER_INVITE_TTL_MS);
  const isNewAccount = !user;

  if (!user) {
    const unusablePassword = randomBytes(32).toString("hex");
    const passwordHash = await bcrypt.hash(unusablePassword, 12);
    user = await User.create({
      name,
      email,
      passwordHash,
      role: "agency_member",
      isActive: true,
      inviteTokenHash: hash,
      inviteExpiresAt,
    });
  }

  const existingMembership = await AgencyMembership.findOne({ agencyId, userId: user._id });
  if (existingMembership && ["invited", "active"].includes(existingMembership.status)) {
    throw ApiError.conflict("This person is already a member of (or has a pending invite for) this agency");
  }

  if (existingMembership) {
    existingMembership.role = role;
    existingMembership.status = "invited";
    existingMembership.invitedBy = req.user!.id as unknown as typeof existingMembership.invitedBy;
    existingMembership.inviteTokenHash = hash;
    existingMembership.inviteExpiresAt = inviteExpiresAt;
    await existingMembership.save();
  } else {
    await AgencyMembership.create({
      agencyId,
      userId: user._id,
      role,
      status: "invited",
      invitedBy: req.user!.id,
      inviteTokenHash: hash,
      inviteExpiresAt,
    });
  }

  const inviter = await User.findById(req.user!.id).select("name");
  const acceptUrl = `${env.ADMIN_ORIGIN}/accept-agency-invite?token=${raw}`;
  try {
    await getEmailService().send(
      agencyMemberInviteEmail(email, acceptUrl, {
        agencyName: agency.name,
        inviterName: inviter?.name ?? "A team member",
        roleLabel: AGENCY_ROLE_LABELS[role] ?? role,
        isNewAccount,
      })
    );
  } catch (err) {
    logger.error("failed to send agency-member-invite email", { error: (err as Error).message });
  }

  await recordAgencyAuditEvent({
    agencyId,
    actorUserId: req.user!.id,
    actorRole: req.user!.role,
    action: "agency.member_invited",
    targetType: "agency_membership",
    targetId: user._id,
    metadata: { email, role },
  });

  sendSuccess(res, { message: `Invitation sent to ${email}.` }, 201);
}

/**
 * POST /agencies/:agencyId/members/:membershipId/resend-invite — Phase 28, mirrors
 * agency.controller.ts's resendAgencyBusinessOwnerInvite exactly (fresh token invalidates the old
 * one, refuses once already accepted). Closes the asymmetry that existed since Phase 25: a
 * business-owner invite could already be resent, a member invite couldn't.
 */
export async function resendMemberInvite(req: Request, res: Response) {
  const { agencyId, membershipId } = req.params;

  const membership = await AgencyMembership.findOne({ _id: membershipId, agencyId });
  if (!membership) throw ApiError.notFound("Membership not found");
  if (membership.status !== "invited") {
    throw ApiError.badRequest("This invitation has already been accepted (or is no longer pending).");
  }

  const user = await User.findById(membership.userId);
  if (!user) throw ApiError.notFound("This member's account no longer exists");

  const { raw, hash } = generateSecureToken();
  const inviteExpiresAt = new Date(Date.now() + MEMBER_INVITE_TTL_MS);

  membership.inviteTokenHash = hash;
  membership.inviteExpiresAt = inviteExpiresAt;
  await membership.save();

  // A brand-new account (never accepted anything yet) still has its own User-level invite token
  // from inviteMember — keep it in sync so accept-invite's isNewAccount branch still works.
  if (user.inviteTokenHash) {
    user.inviteTokenHash = hash;
    user.inviteExpiresAt = inviteExpiresAt;
    await user.save();
  }

  const agency = await Agency.findById(agencyId);
  const inviter = await User.findById(req.user!.id).select("name");
  const acceptUrl = `${env.ADMIN_ORIGIN}/accept-agency-invite?token=${raw}`;
  try {
    await getEmailService().send(
      agencyMemberInviteEmail(user.email, acceptUrl, {
        agencyName: agency?.name ?? "your agency",
        inviterName: inviter?.name ?? "A team member",
        roleLabel: AGENCY_ROLE_LABELS[membership.role] ?? membership.role,
        isNewAccount: Boolean(user.inviteTokenHash),
      })
    );
  } catch (err) {
    logger.error("failed to send agency-member-invite resend email", { error: (err as Error).message });
  }

  await recordAgencyAuditEvent({
    agencyId,
    actorUserId: req.user!.id,
    actorRole: req.user!.role,
    action: "agency.member_invite_resent",
    targetType: "agency_membership",
    targetId: membership._id,
    metadata: { email: user.email },
  });

  sendSuccess(res, { message: `Invitation resent to ${user.email}.` });
}

/**
 * POST /agencies/accept-invite — top-level (not nested under :agencyId), since the token alone
 * identifies everything. Mirrors auth.controller.ts's acceptInvite double-accept protection
 * exactly (atomic findOneAndUpdate, match+invalidate in one op) for BOTH documents it may touch.
 */
export async function acceptAgencyInvite(req: Request, res: Response) {
  const { token, password } = req.body as AcceptAgencyInviteInput;
  const hash = hashToken(token);

  const membership = await AgencyMembership.findOne({ inviteTokenHash: hash, inviteExpiresAt: { $gt: new Date() } });
  if (!membership) throw ApiError.badRequest("This invitation link is invalid or has expired");

  const user = await User.findById(membership.userId);
  if (!user) throw ApiError.badRequest("This invitation link is invalid or has expired");

  const isNewAccount = Boolean(user.inviteTokenHash);
  if (isNewAccount) {
    if (!password) throw ApiError.badRequest("A password is required to accept this invitation");
    const passwordHash = await bcrypt.hash(password, 12);
    const updatedUser = await User.findOneAndUpdate(
      { _id: user._id, inviteTokenHash: user.inviteTokenHash },
      { $set: { passwordHash }, $unset: { inviteTokenHash: "", inviteExpiresAt: "" } }
    );
    if (!updatedUser) throw ApiError.badRequest("This invitation link is invalid or has expired");
  }

  const updatedMembership = await AgencyMembership.findOneAndUpdate(
    { _id: membership._id, inviteTokenHash: hash },
    { $set: { status: "active", acceptedAt: new Date() }, $unset: { inviteTokenHash: "", inviteExpiresAt: "" } },
    { new: true }
  );
  if (!updatedMembership) throw ApiError.badRequest("This invitation link is invalid or has expired");

  if (user.role === "customer") {
    await User.findByIdAndUpdate(user._id, { $set: { role: "agency_member" } });
  }

  await recordAgencyAuditEvent({
    agencyId: membership.agencyId,
    actorUserId: user._id,
    actorRole: user.role,
    action: "agency.member_accepted",
    targetType: "agency_membership",
    targetId: membership._id,
  });

  const freshUser = (await User.findById(user._id))!;
  const agencyMemberships = await getActiveAgencyMemberships(freshUser.id as string);
  const accessToken = await issueSession(res, freshUser, agencyMemberships);
  sendSuccess(res, { user: toPublicUser(freshUser, agencyMemberships), accessToken });
}

/**
 * One PATCH endpoint covers role change, business-assignment change (agency_staff's businessIds —
 * see AgencyMembership.ts), and revoke/deactivate — rather than several near-identical endpoints,
 * per the brief's "do not create excessive roles/endpoints without justification." Guards against
 * an agency ever being left with zero active owners (would permanently lock everyone out).
 */
export async function updateMember(req: Request, res: Response) {
  const { agencyId, membershipId } = req.params;
  const updates = req.body as UpdateAgencyMembershipInput;

  const membership = await AgencyMembership.findOne({ _id: membershipId, agencyId });
  if (!membership) throw ApiError.notFound("Membership not found");

  const demotingOrRemovingAnOwner =
    membership.role === "agency_owner" && ((updates.role && updates.role !== "agency_owner") || (updates.status && updates.status !== "active"));
  if (demotingOrRemovingAnOwner) {
    const ownerCount = await AgencyMembership.countDocuments({ agencyId, role: "agency_owner", status: "active" });
    if (ownerCount <= 1) throw ApiError.badRequest("An agency must always have at least one active owner");
  }

  if (updates.role) membership.role = updates.role;
  if (updates.status) membership.status = updates.status;
  if (updates.businessIds) membership.businessIds = updates.businessIds as unknown as typeof membership.businessIds;
  await membership.save();

  await recordAgencyAuditEvent({
    agencyId,
    actorUserId: req.user!.id,
    actorRole: req.user!.role,
    action: updates.status === "revoked" ? "agency.member_removed" : "agency.member_role_changed",
    targetType: "agency_membership",
    targetId: membership._id,
    metadata: updates as Record<string, unknown>,
  });

  sendSuccess(res, { membership: membership.toJSON() });
}
