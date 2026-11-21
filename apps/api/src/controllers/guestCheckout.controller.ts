import type { Request, Response } from "express";
import type { ClaimGuestCheckoutForUserInput, ClaimGuestCheckoutInput, StartGuestCheckoutInput } from "@restaurant/validation";
import { sendSuccess } from "../common/response.js";
import { CURRENT_LEGAL_VERSION, issueSession, sendVerificationEmail, toPublicUser } from "./auth.controller.js";
import { getActiveAgencyMemberships } from "../services/agencyMembership.service.js";
import { claimGuestCheckout, claimGuestCheckoutForUser, getGuestCheckoutConfig, getGuestCheckoutStatus, startGuestCheckout } from "../services/guestCheckout.service.js";

/** Launch, 2026-11-21 — the public pay-now checkout. See services/guestCheckout.service.ts. */

export async function startGuestCheckoutHandler(req: Request, res: Response) {
  sendSuccess(res, await startGuestCheckout(req.body as StartGuestCheckoutInput), 201);
}

export async function getGuestCheckoutConfigHandler(_req: Request, res: Response) {
  sendSuccess(res, { paddle: getGuestCheckoutConfig() });
}

export async function getGuestCheckoutStatusHandler(req: Request, res: Response) {
  sendSuccess(res, await getGuestCheckoutStatus((req.body as { token: string }).token));
}

/** Creates the account and signs it in, like /auth/register. */
export async function claimGuestCheckoutHandler(req: Request, res: Response) {
  const body = req.body as ClaimGuestCheckoutInput;
  const { user, viaEmail } = await claimGuestCheckout({ ...body, legalVersion: CURRENT_LEGAL_VERSION });
  // The checkout-page link doesn't prove the inbox; the emailed one does (claimGuestCheckout).
  if (!viaEmail) await sendVerificationEmail(req, user);
  const accessToken = await issueSession(res, user, []);
  sendSuccess(res, { user: toPublicUser(user), accessToken }, 201);
}

/** Attaches the purchase to the signed-in account, then re-issues the session (it now has a business). */
export async function claimGuestCheckoutForUserHandler(req: Request, res: Response) {
  const body = req.body as ClaimGuestCheckoutForUserInput;
  const user = await claimGuestCheckoutForUser({ ...body, userId: req.user!.id, legalVersion: CURRENT_LEGAL_VERSION });
  const memberships = await getActiveAgencyMemberships(user.id as string);
  const accessToken = await issueSession(res, user, memberships);
  sendSuccess(res, { user: toPublicUser(user, memberships), accessToken });
}
