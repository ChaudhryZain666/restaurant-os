export interface EmailSenderOverride {
  /** Display name shown with the address, e.g. an agency brand name. Sanitized by the transport. */
  name: string;
  /** A custom "From" address. Set ONLY by emailBranding.service.ts for a verified agency sender;
   *  absent means the platform's own EMAIL_FROM address, with `name` as its display name. */
  address?: string;
}

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
  /** Tenant sender identity (white-label `email_branding`); absent = the platform sender as-is. */
  from?: EmailSenderOverride;
  /** Reply-To; only ever an address on a verified agency domain (emailBranding.service.ts). */
  replyTo?: string;
}

/** Provider-agnostic transactional email. Concrete adapters (SMTP, SES, SendGrid, ...) implement this. */
export interface EmailService {
  send(message: EmailMessage): Promise<void>;
}

/** A display name that can't break out of an address header: no CR/LF or other control
 *  characters, no quotes or angle brackets, collapsed whitespace, at most 78 characters. */
export function sanitizeDisplayName(name: string): string {
  return name
    // Matching control characters is the point here: they're what could inject a header.
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f"<>\\]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 78);
}

/** The bare address inside an EMAIL_FROM value like `GarnishTable <no-reply@example.com>`. */
export function addressOf(from: string): string {
  const match = from.match(/<([^>]+)>/);
  return (match ? match[1] : from).trim();
}
