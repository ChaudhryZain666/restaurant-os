import { Router } from "express";
import rateLimit from "express-rate-limit";
import { acceptAgencyInviteSchema, inviteAgencyMemberSchema, updateAgencyMembershipSchema } from "@restaurant/validation";
import { asyncHandler } from "../utils/asyncHandler.js";
import { requireAuth } from "../middleware/auth.js";
import { requireAgencyMatch, requireAgencyPermission } from "../middleware/agency.js";
import { jsonRateLimitHandler } from "../middleware/rateLimitHandler.js";
import { validateBody } from "../middleware/validate.js";
import {
  acceptAgencyInvite,
  inviteMember,
  listMembers,
  resendMemberInvite,
  updateMember,
} from "../controllers/agencyMembership.controller.js";

/** Mounted at /agencies/:agencyId/members. */
export const agencyMembershipRouter = Router({ mergeParams: true });

agencyMembershipRouter.use(requireAuth, requireAgencyMatch());
agencyMembershipRouter.get("/", asyncHandler(listMembers));
agencyMembershipRouter.post(
  "/",
  requireAgencyPermission("agency.members.manage"),
  validateBody(inviteAgencyMemberSchema),
  asyncHandler(inviteMember)
);
agencyMembershipRouter.patch(
  "/:membershipId",
  requireAgencyPermission("agency.members.manage"),
  validateBody(updateAgencyMembershipSchema),
  asyncHandler(updateMember)
);
agencyMembershipRouter.post(
  "/:membershipId/resend-invite",
  requireAgencyPermission("agency.members.manage"),
  asyncHandler(resendMemberInvite)
);

/**
 * Mounted at /agencies/accept-invite — top-level, NOT nested under :agencyId (the token alone
 * identifies everything) and deliberately public, mirroring /auth/accept-invite exactly: a
 * brand-new invitee has no session yet. Same rate-limit posture as authLimiter (auth.routes.ts) —
 * this accepts an arbitrary bearer-style token from an unauthenticated caller, the same class of
 * endpoint that needs throttling against brute-forcing.
 */
export const agencyAcceptInviteRouter = Router();
const acceptInviteLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  handler: jsonRateLimitHandler,
});
agencyAcceptInviteRouter.post("/", acceptInviteLimiter, validateBody(acceptAgencyInviteSchema), asyncHandler(acceptAgencyInvite));
