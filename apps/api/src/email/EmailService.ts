export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
}

/** Provider-agnostic transactional email. Concrete adapters (SMTP, SES, SendGrid, ...) implement this. */
export interface EmailService {
  send(message: EmailMessage): Promise<void>;
}
