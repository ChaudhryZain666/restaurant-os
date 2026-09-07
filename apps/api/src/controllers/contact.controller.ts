import type { Request, Response } from "express";
import type { ContactFormInput } from "@restaurant/validation";
import { sendSuccess } from "../common/response.js";
import { getEmailService } from "../email/index.js";
import { contactFormNotificationEmail } from "../email/templates.js";
import { env } from "../config/env.js";
import { logger } from "../common/logger.js";

/**
 * POST /public/contact — genuinely unauthenticated, mirrors publicPlan.controller.ts's "no auth at
 * all" shape. Backs BOTH of the marketing site's lead-capture forms (Contact page's own form, and
 * LeadForm.tsx's "Request a guided demo") — see contactFormSchema's own comment for why one shared
 * endpoint. Same best-effort send pattern every other transactional email in this codebase already
 * uses (auth.controller.ts's sendVerificationEmail etc.): a delivery failure is logged, never
 * thrown, so a visitor's honestly-labeled "we'll follow up" submission always succeeds from their
 * side regardless of email infrastructure health.
 */
export async function submitContactForm(req: Request, res: Response) {
  const fields = req.body as ContactFormInput;

  try {
    await getEmailService().send(contactFormNotificationEmail(env.CONTACT_NOTIFICATION_EMAIL, fields));
  } catch (err) {
    logger.error("failed to send contact-form notification email", { error: (err as Error).message });
  }

  sendSuccess(res, { received: true }, 201);
}
