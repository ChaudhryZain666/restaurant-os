import type { Request, Response } from "express";
import type { ClaimGuestCheckoutForUserInput, ClaimGuestCheckoutInput, StartGuestCheckoutInput } from "@restaurant/validation";
import { sendSuccess } from "../common/response.js";
import { CURRENT_LEGAL_VERSION, issueSession, sendVerificationEmail, toPublicUser } from "./auth.controller.js";
import { getActiveAgencyMemberships } from "../services/agencyMembership.service.js";
import { claimGuestCheckout, claimGuestCheckoutForUser, getGuestCheckoutConfig, getGuestCheckoutStatus, startGuestCheckout } from "../services/guestCheckout.service.js";
import { readCheckoutHandoff } from "../services/checkoutHandoff.service.js";
import { ApiError } from "../utils/ApiError.js";

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

/** The in-app Subscribe checkout handed to garnishtable.com/checkout (services/checkoutHandoff.service.ts):
 *  what that page needs to open Paddle's form for this owner and plan. */
export async function getCheckoutHandoffHandler(req: Request, res: Response) {
  const handoff = await readCheckoutHandoff((req.body as { token: string }).token);
  if (!handoff) throw ApiError.notFound("This checkout link has expired. Go back to Billing in your GarnishTable account and choose Subscribe again.");
  sendSuccess(res, handoff);
}
