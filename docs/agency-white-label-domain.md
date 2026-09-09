# Agency white-label domain (Phase 58, Section 12A)

## What exists after this phase

An agency can record a candidate domain (e.g. `mediabymiller.com`) on its own `Agency` document and
verify **ownership** of it, via `POST /agencies/:agencyId/domain` and
`POST /agencies/:agencyId/domain/verify` (Agency Portal → Settings). Verification reuses
`domainVerification.service.ts` exactly as it already works for a restaurant's own custom storefront
domain (`DomainMapping`) — publish a DNS TXT record at `_tablecloth-verify.<domain>` with a
system-generated value, then the platform does a live DNS lookup and compares it. This is a real,
working ownership check, not a fake "Verified ✓" badge — `Agency.domainStatus` only flips to
`"verified"` after a genuine DNS TXT match.

## What this explicitly does NOT do

Verifying ownership of a domain does not, on its own, let the platform send email *from* that
domain, or serve login/invitation pages *branded* as that domain. Concretely, today:

- **Every transactional email the platform sends** — owner invitations, agency team invitations,
  password resets, contact-form notifications, receipts — goes out from exactly one address:
  `env.EMAIL_FROM`, configured once for the whole platform (`SmtpEmailService`/`ConsoleEmailProvider`
  are both single-sender). There is no per-tenant sender identity, no DKIM/SPF delegation, and no
  mechanism to pick a different `from` address per agency.
- **Invitation copy** (`ownerInviteEmail`, agency member invite emails) always names the platform,
  never "Media by Miller has invited you..." — there is no template variable or lookup wired to an
  agency's verified domain today.
- **Login/signup pages** are the platform's own, at the platform's own origin — there is no per-
  agency subdomain or branded login experience.
- **Client-specific addresses** like `elrancho@mediabymiller.com` are not mailboxes, aliases, or
  forwarders of any kind — nothing in this codebase provisions, receives, or forwards mail at all.
  Only the *storefront* custom-domain system (`DomainMapping`, Phase 22) exists, and it maps a
  hostname to one restaurant's public ordering page — not an email identity.

None of this was faked to make the Settings page look more complete than it is. The UI states this
boundary directly (Agency Portal → Settings → White-label domain).

## What would be required to close this gap (deferred, not attempted this phase)

This is a genuinely new architectural subsystem — exactly the kind of thing Phase 58's own Section
40 says to stop and document rather than build a shortcut for:

1. **Per-tenant verified sending identity.** Most transactional-email providers (SES, SendGrid,
   Postmark, etc.) support verifying a customer's own sending domain (SPF/DKIM/DMARC records) and
   sending "as" them. This means either integrating one of those specifically for this use case, or
   extending `EmailService` with a per-agency sender parameter and a provider that actually supports
   it — `SmtpEmailService`'s single generic SMTP relay does not.
2. **Per-tenant email templates carrying agency branding** — name, logo, domain — threaded through
   every transactional email an agency-managed client's owner/staff might receive.
3. **A decision on branded login/subdomain experience** — e.g. `app.mediabymiller.com` proxying to
   the platform, or the platform serving different branding based on the request's hostname. This
   touches auth cookie domains, CORS, and the marketing/admin app's own routing — a materially larger
   change than this phase's scope.
4. **A real answer to "what is `elrancho@mediabymiller.com`"** — if it's meant to be an actual
   mailbox, that's third-party email hosting, out of this platform's problem space entirely. If it's
   meant to be a *login identity* only (a `User.email` value under a domain the agency owns), that's
   achievable without new infrastructure once domain ownership is verified (this phase's own
   deliverable) — but no such login-identity feature was requested narrowly enough to build safely
   without also deciding points 1-3 above, since an unreachable "email address" used only as a login
   name — with no verification email able to reach it — creates its own account-recovery and
   verification problems that need a real product decision, not a silent default.

## Why this scope, not more

Building any of the above without the underlying provider capability would mean either lying about
what the product does (a fake "sent from your domain" claim) or silently degrading (always falling
back to the platform sender with no indication anything was requested) — both worse than being
honest that this phase establishes ownership verification as a real, correct first step and stops
there.
