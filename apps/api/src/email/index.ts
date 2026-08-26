import { env } from "../config/env.js";
import { ConsoleEmailProvider } from "./ConsoleEmailProvider.js";
import { SmtpEmailService } from "./SmtpEmailService.js";
import type { EmailService } from "./EmailService.js";

export type { EmailMessage, EmailService } from "./EmailService.js";

let instance: EmailService | null = null;

/**
 * "smtp" (Phase 15) is real, network-capable code (SmtpEmailService, Nodemailer) — but has never
 * been run against a live mailbox in this environment (no SMTP credentials available). Selecting
 * it without SMTP_HOST throws a clear config error rather than silently falling back to the
 * console provider, so a misconfiguration is loud instead of quietly losing real
 * password-reset/invite emails in production.
 */
export function getEmailService(): EmailService {
  if (instance) return instance;

  if (env.EMAIL_PROVIDER === "smtp") {
    if (!env.SMTP_HOST || !env.SMTP_PORT) {
      throw new Error("EMAIL_PROVIDER=smtp requires SMTP_HOST and SMTP_PORT to be set.");
    }
    if (!env.EMAIL_FROM) {
      throw new Error("EMAIL_PROVIDER=smtp requires EMAIL_FROM to be set.");
    }
    instance = new SmtpEmailService({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      user: env.SMTP_USER,
      password: env.SMTP_PASSWORD,
      from: env.EMAIL_FROM,
    });
    return instance;
  }

  instance = new ConsoleEmailProvider();
  return instance;
}

/** Test-only reset — mirrors resetGeocodingServiceForTests; without this, a test file that
 *  imports after another has already called getEmailService() would silently reuse that earlier
 *  instance instead of picking up its own env setup. */
export function resetEmailServiceForTests(): void {
  instance = null;
}
