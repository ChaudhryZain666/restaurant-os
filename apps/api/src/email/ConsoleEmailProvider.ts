import { logger } from "../common/logger.js";
import type { EmailMessage, EmailService } from "./EmailService.js";

/**
 * The default provider when no real one is configured (EMAIL_PROVIDER unset or "console").
 * Logs the fully-rendered email instead of sending it — this is what makes password reset and
 * staff invites testable/usable in dev without real credentials, and it's what every automated
 * test in this repo reads from to recover a reset/invite link. Never claims delivery succeeded
 * when nothing was actually sent anywhere.
 */
export class ConsoleEmailProvider implements EmailService {
  async send(message: EmailMessage): Promise<void> {
    logger.info("email (console provider — not actually sent)", {
      to: message.to,
      subject: message.subject,
      text: message.text,
    });
  }
}
