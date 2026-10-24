# GarnishTable legal-page readiness review

Status: **BLOCKED — draft only; not approved for publication or Paddle domain review.**
Prepared: 24 October 2026
Branch: `chore/paddle-live-readiness`

## Founder-supplied values

- Operator/legal name supplied: `GarnishTable`
- Structure supplied: individual / sole proprietor (not a registered company)
- Jurisdiction supplied: Pakistan
- Terms/legal contact: `admin@garnishtable.com`
- Privacy contact: `hello@garnishtable.com`
- Billing/refund contact: `admin@garnishtable.com`
- Refund preference: case-by-case review; no fixed discretionary refund window approved
- Dispute mechanism: not selected; legal review requested

**Identity caution:** “GarnishTable” may be a brand/trading name rather than the proprietor's legally recognized personal name. Confirm the legally appropriate operator disclosure with the proprietor and Pakistan-qualified counsel. Do not describe GarnishTable as a registered company unless it is registered.

## What the repository establishes

- The production API template specifies MongoDB Atlas, Redis, S3-compatible object storage, SMTP email, optional LocationIQ geocoding, optional Stripe/Safepay restaurant payments, and Paddle platform subscription billing when enabled.
- Code supports Anthropic or OpenAI for AI-assisted menu extraction when configured.
- Production architecture documentation describes MongoDB Atlas and configurable hosting, Redis, object storage, and other integrations. It does **not** establish the live vendor/region for every data store or service.
- *(Superseded by the production audit below: the environment was inspected read-only on 24 October 2026.)*
- Code contains a 10-minute Redis cache for address suggestions and a 24-hour geocoding-result cache. Those cache TTLs are **not** a complete personal-data retention schedule.
- The code and documentation do not provide an approved retention schedule for accounts, orders, logs, uploads, billing records, support requests, backups, or deletion propagation.
- The source does not establish a complete list of active subprocessors, all processing countries, or legally sufficient cross-border transfer safeguards.

## Production audit — 24 October 2026 (read-only)

Method: SSH to the production server reading configuration *names and non-secret settings only*
(connection URLs reduced to host names, every key reported only as present/absent), DigitalOcean
instance metadata, count-only database queries, public DNS/RDAP records, MongoDB's published IP
geofeed, and the source code at `c9ceca3`. Nothing was changed. Production runs `b6b0f3e`.

| Area | Verified fact | Evidence |
| --- | --- | --- |
| Hosting | DigitalOcean droplet, region **fra1 (Frankfurt, Germany)** | droplet metadata |
| Cache | Redis 7 container **on the same droplet** (not a third-party service) | running containers, `REDIS_URL` host |
| Database | **MongoDB Atlas on AWS, region `AP_SOUTH_1` (Mumbai, India)**, AZ `aps1-az2` | Atlas's own replica-set member tags (`hello`, 25 Oct 2026); consistent with DNS/RDAP/MongoDB geofeed |
| Email (sending) | **Brevo** SMTP relay, port 2525; sender domain garnishtable.com | `SMTP_HOST`, `EMAIL_PROVIDER=smtp` |
| Domain, DNS, mailboxes | **Hostinger** (registrar Hostinger operations, UAB; Hostinger nameservers and MX) | RDAP, DNS NS/MX/SPF |
| AI menu import | **Anthropic**, live (`claude-sonnet-4-6`); OpenAI not configured | `MENU_EXTRACTION_PROVIDER_MODE=live`, key presence |
| Object storage | **Not configured** (no `STORAGE_*`) — production file uploads fail rather than use a provider | `api.env`, `storage/index.ts` |
| Geocoding | **Not configured** (LocationIQ inactive) | `api.env` |
| Payments | `PAYMENT_PROVIDER=mock`; no Stripe/Safepay keys; **0** restaurant payment accounts; **0** payments | `api.env`, DB counts |
| Subscription billing | `BILLING_PROVIDER=mock`; no Paddle keys; **0** subscriptions | `api.env`, DB counts |
| Marketplaces / delivery | mock; **0** marketplace connections, **0** delivery-provider accounts | `api.env`, DB counts |
| Analytics / trackers | **None** configured or in the frontends | `edge.env`, source search |
| Browser-loaded third parties | Google Fonts (website + dashboard), Paddle.js (dashboard), OpenStreetMap tiles (dashboard map) | `index.html`, `MapPreview.tsx`, live HTML |
| Backups | Daily (03:18 UTC timer), kept **30 days** (`GT_BACKUP_KEEP_DAYS=30`), **on the production server only** — no off-site copy (`GT_BACKUP_OFFSITE_CMD` unset, no `rclone.conf`) | systemd timers, `edge.env`, `backups/` (36 files, newest today) |
| Logs | Docker json-file logs rotated at 10 MB × 3 per container | `/etc/docker/daemon.json` |
| Account deletion | Customers can self-delete: name, email, phone, saved addresses scrubbed, sign-in disabled; order records keep their delivery details; owner/staff accounts can't self-delete | `auth.controller.ts deleteMe` |
| Trial / cancellation | No-card trial; expires (no charge) unless a paid subscription is started; starting one mid-trial ends the trial and charges immediately; trial/past-due cancel immediately, active cancels at period end; expired/cancelled keeps data, removes paid features | `subscription.service.ts` |
| Failed payments | `past_due` keeps access; GarnishTable does not cancel after a fixed period (`PAST_DUE_GRACE_PERIOD_DAYS=7` is display-only) — cancellation depends on Paddle's dunning settings | code; Paddle Live not configured |

Corrections made to the drafts from this evidence:

- **Privacy §4** now names the providers actually configured (above) and the browser-loaded third parties, instead of a list of possible integrations; Paddle/order payment providers are described as not yet active.
- **Privacy §5** states the verified backup retention (about 30 days) and log rotation.
- **Privacy §7** states what self-deletion removes and that order records keep their details; fixed a wrong cross-reference (Section 10 → 11).
- **Privacy §8** names Frankfurt, Germany for the servers and, since 25 Oct 2026 (Atlas member tags), Mumbai, India for the database.
- **Refund §1** no longer says a trial "proceeds" to a paid plan or that nothing is ever charged during it: a no-card trial expires, and starting a paid plan mid-trial charges immediately.
- **Refund §5** failed-payment sentence flagged as unverified (depends on Paddle dunning).
- **Terms §6** cross-reference fixed (payment providers are Section 8, not 10).

Operational findings outside the legal text:

- Backups exist only on the production server — a server loss loses them too. Configure `GT_BACKUP_OFFSITE_CMD` (decision needed: where).
- Object storage is unconfigured, so production uploads (logos, images) fail.
- Paddle.js loads on every dashboard page although billing is not live.

## Required before publication

- [ ] Confirm the operator's legally accurate identity/trading-name disclosure.
- [ ] Review Terms of Service with Pakistan-qualified counsel, including enforceability of disclaimers/liability limits and governing-law language.
- [ ] Select/approve the dispute-resolution mechanism and any appropriate venue; none has been assumed.
- [x] Verify the actual production environment (read-only) to identify active database, Redis, object-storage, SMTP, payment, geocoding, AI/menu-extraction and analytics providers. *(Done 24 Oct 2026 — see the audit above.)*
- [ ] Confirm each active provider's legal name, processing purpose, categories of data, region/country, privacy terms, retention and deletion behavior. *(Providers and purposes identified; contracting entities, DPAs and regions other than DigitalOcean fra1 still open; confirm the Atlas region in the console.)*
- [ ] Establish and approve a retention schedule for account data, order data, technical/security logs, uploaded files, billing records, support records, backups and deletion propagation.
- [ ] Review international processing and transfers, including actual hosting/data regions and applicable contractual or legal safeguards.
- [ ] Verify stated account/trial/cancellation/refund behavior against current production implementation. Keep case-by-case refund handling and do not publish a made-up refund window. *(Trial, cancellation and deletion verified against code and corrected; failed-payment wording waits on Paddle's dunning setting.)*
- [ ] Review customer-order refunds separately from GarnishTable subscription refunds.
- [ ] Verify contact mailboxes are controlled and monitored.
- [ ] Have the founder and counsel approve final wording and confirm it meets Paddle's current domain-review requirements.
- [ ] Only then set the GitHub repository variable `GT_LEGAL_REVIEW_APPROVED=true`, rebuild, inspect rendered pages and metadata, and seek explicit deployment approval.

## Publication safety gate

The marketing build requires all five legal facts **and** `VITE_LEGAL_REVIEW_APPROVED=true` before Terms, Privacy and Refund pages are rendered as published documents or included in the sitemap. The production-image workflow passes the gate from the repository variable `GT_LEGAL_REVIEW_APPROVED`. With the variable unset or false, the pages remain pending/noindexed and `/version.json` reports legalConfigured=false. This flag is a release gate, not a substitute for actual review.

No production environment was read or changed, no site was deployed, and no Paddle setting was changed as part of this preparation.
