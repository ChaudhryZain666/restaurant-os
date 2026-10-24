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
- The current API production environment file could not be inspected during this task. SSH access was unavailable. No claim is made here about which optional providers are enabled, the exact SMTP host, object-storage provider, MongoDB Atlas region, Redis location, or configured AI provider.
- Code contains a 10-minute Redis cache for address suggestions and a 24-hour geocoding-result cache. Those cache TTLs are **not** a complete personal-data retention schedule.
- The code and documentation do not provide an approved retention schedule for accounts, orders, logs, uploads, billing records, support requests, backups, or deletion propagation.
- The source does not establish a complete list of active subprocessors, all processing countries, or legally sufficient cross-border transfer safeguards.

## Required before publication

- [ ] Confirm the operator's legally accurate identity/trading-name disclosure.
- [ ] Review Terms of Service with Pakistan-qualified counsel, including enforceability of disclaimers/liability limits and governing-law language.
- [ ] Select/approve the dispute-resolution mechanism and any appropriate venue; none has been assumed.
- [ ] Verify the actual production environment (read-only) to identify active database, Redis, object-storage, SMTP, payment, geocoding, AI/menu-extraction and analytics providers.
- [ ] Confirm each active provider's legal name, processing purpose, categories of data, region/country, privacy terms, retention and deletion behavior.
- [ ] Establish and approve a retention schedule for account data, order data, technical/security logs, uploaded files, billing records, support records, backups and deletion propagation.
- [ ] Review international processing and transfers, including actual hosting/data regions and applicable contractual or legal safeguards.
- [ ] Verify stated account/trial/cancellation/refund behavior against current production implementation. Keep case-by-case refund handling and do not publish a made-up refund window.
- [ ] Review customer-order refunds separately from GarnishTable subscription refunds.
- [ ] Verify contact mailboxes are controlled and monitored.
- [ ] Have the founder and counsel approve final wording and confirm it meets Paddle's current domain-review requirements.
- [ ] Only then set the GitHub repository variable `GT_LEGAL_REVIEW_APPROVED=true`, rebuild, inspect rendered pages and metadata, and seek explicit deployment approval.

## Publication safety gate

The marketing build requires all five legal facts **and** `VITE_LEGAL_REVIEW_APPROVED=true` before Terms, Privacy and Refund pages are rendered as published documents or included in the sitemap. The production-image workflow passes the gate from the repository variable `GT_LEGAL_REVIEW_APPROVED`. With the variable unset or false, the pages remain pending/noindexed and `/version.json` reports legalConfigured=false. This flag is a release gate, not a substitute for actual review.

No production environment was read or changed, no site was deployed, and no Paddle setting was changed as part of this preparation.
