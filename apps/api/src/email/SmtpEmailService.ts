import nodemailer, { type Transporter } from "nodemailer";
import { logger } from "../common/logger.js";
import type { EmailMessage, EmailService } from "./EmailService.js";

export interface SmtpConfig {
  host: string;
  port: number;
  user?: string;
  password?: string;
  from: string;
}

/**
 * Real, network-capable email delivery via SMTP (Nodemailer) — the extension point
 * docs/commercial-decisions.md left open. Never exercised against a real mailbox in this repo
 * (no SMTP credentials were available when this was written), but the transport itself is
 * standard, well-tested library code, not something written from scratch — unlike
 * SafepayProvider, there is no unverified wire-format risk here, only "has anyone actually typed
 * in real SMTP_HOST/USER/PASSWORD yet" (see docs/commercial-decisions.md's Phase 15 update).
 * ConsoleEmailProvider remains the default in every environment unless EMAIL_PROVIDER=smtp is set
 * explicitly (see email/index.ts).
 *
 * Phase 34 closure — re-verified port/TLS handling against Nodemailer's own docs (WebFetch, no
 * live mailbox available to test against). `secure:false` (every port but 465) does NOT mean
 * plaintext — Nodemailer opportunistically upgrades via STARTTLS when the server advertises it —
 * but without `requireTLS`, a server that fails to (or doesn't) offer STARTTLS silently falls back
 * to an UNENCRYPTED connection rather than erroring. This transport carries password-reset/invite
 * links (see this class's send() comment), so a silent plaintext fallback is a real exposure, not
 * a cosmetic one — added requireTLS below so a misconfigured/non-TLS relay fails loudly instead.
 */
export class SmtpEmailService implements EmailService {
  private readonly transporter: Transporter;
  private readonly from: string;

  constructor(config: SmtpConfig) {
    this.from = config.from;
    const isImplicitTls = config.port === 465;
    this.transporter = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      // 465 is SMTP-over-TLS from the start of the connection; every other port (587, 25, ...)
      // upgrades via STARTTLS instead — nodemailer's `secure` flag controls exactly this.
      secure: isImplicitTls,
      // Only meaningful (and only set) for the STARTTLS path — 465 is already encrypted from
      // connection start, so requiring an upgrade on top of that would be a no-op at best.
      requireTLS: isImplicitTls ? undefined : true,
      auth: config.user && config.password ? { user: config.user, pass: config.password } : undefined,
    });
  }

  async send(message: EmailMessage): Promise<void> {
    try {
      await this.transporter.sendMail({
        from: this.from,
        to: message.to,
        subject: message.subject,
        html: message.html,
        text: message.text,
      });
    } catch (err) {
      // Never logs message.text/html (may carry a reset/invite link) or SMTP credentials — only
      // enough to diagnose a delivery failure from server logs.
      logger.error("smtp send failed", { to: message.to, subject: message.subject, error: (err as Error).message });
      throw err;
    }
  }
}
