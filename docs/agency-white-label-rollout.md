# Agency White-Label

An agency runs many client restaurants centrally. White-label lets it present its own brand to
those clients' customers instead of GarnishTable's. It is opt-in at two levels, and every
capability's real readiness is computed on the server — a selection alone never makes anything live.

## How it's switched on

1. **Agency settings** (agency owner, `agency.manage`): brand name, https logo, primary color,
   optional support email and https help URL, the white-label mode switch, and which of the six
   capabilities the agency offers (`whiteLabelOfferings`). Turning white-label off keeps the
   offerings and every client's choices; they read as *suspended* until it's turned back on.
2. **Client page** (`agency.businesses.manage`): which offered capabilities each client gets
   (`Business.whiteLabelFeatures`). The API refuses a capability the agency doesn't offer, and
   refuses any change to a business of another agency (it reads as not found).

Both changes are audited on the agency audit log (`agency.updated`, `agency.client_white_label_updated`).

## Capability states

`GET /agencies/:agencyId/businesses/:businessId/white-label` returns each capability's state,
a one-line summary, and the exact blockers. The client page shows exactly this.

| State | Meaning |
|---|---|
| `not_offered` | The agency doesn't offer it (or white-label mode is off) and it isn't selected. |
| `off` | Offered, not selected for this client. |
| `pending_setup` | Selected; a prerequisite isn't met yet. `blockers` lists what's missing. |
| `active` | Selected and every prerequisite is verified — customers see it. |
| `failed` | Selected; a prerequisite that was met has since failed (e.g. the plan lapsed). |
| `suspended` | Selected, but the agency stopped offering it, turned white-label off, or is suspended. |

A capability is *in force* (affects customers) only when the agency is `active`, white-label mode
is on, the capability is offered, and it's selected (`isFeatureInForce`,
`apps/api/src/services/whiteLabelStatus.service.ts`). Every customer-facing surface checks this.

## The six capabilities

| Capability | What customers see when active | Prerequisites to be `active` |
|---|---|---|
| `storefront_branding` | Agency name and logo bar, agency color as the theme primary, `og:site_name` = agency brand. The restaurant keeps its own name, menu, prices and theme. | In force. |
| `hide_platform_branding` | No "Powered by" line in any theme footer; no platform credit in branded emails; `og:site_name` = the restaurant's name. Legal, payment and security notices are unchanged. | In force. |
| `support_branding` | Help widget and ticket form show the agency's support name, plus its support email and help URL when set. | In force (the contact is optional). |
| `custom_domain` | The client's storefront on its own hostname — including its sign-in, account, order-tracking and support pages; customer order-tracking links in email point there. | A location's `DomainMapping` is verified (DNS TXT) and activated; the platform serves it now (`resolveCustomDomain`: restaurant active, plan includes `custom_domains`); `CUSTOM_DOMAIN_CNAME_TARGET` is configured; and a CNAME to that target is found. |
| `branded_login` | Agency name, logo and color on the customer log in / create account / forgot / reset password pages. | A live custom domain as above. Branding is only ever applied when the storefront resolved the restaurant **through that verified domain** — never on `/r/:slug` or the shared platform host. |
| `email_branding` | Order emails (new order, confirmation, cancelled, payment received/failed, refund) and owner/staff invitations carry the agency brand; the sender name is the agency brand. | In force. A custom sender address is a separate, optional step (below). |

### What deliberately stays platform-branded

Password reset, email verification and email-change emails, platform billing emails, and the
operator sign-in at the admin origin. Security email links always use the platform's own
origins: a tenant controls its own domain's DNS, so putting a reset or verification token on a
tenant hostname would let that tenant capture it.

## Branded email and the custom sender

Production email is SMTP (`EMAIL_PROVIDER=smtp` is required in production; see
`apps/api/src/config/env.ts`). The repository does not record which SMTP provider is behind
`SMTP_HOST`, and generic SMTP has no API for verifying a sending domain, so no automatic
verification is claimed. Instead:

- **Without a custom sender** (the default), branded emails are sent from the platform's own
  `EMAIL_FROM` address with the agency brand as the display name. Deliverability is unchanged.
- **With a custom sender**, the agency requests an address on its own domain
  (`PUT /agencies/:agencyId/email-sender`). Its status moves:
  `pending_domain` (agency domain not DNS-verified) → `pending_authorization` (verified; waiting
  for the platform) → `verified` (a platform admin confirmed it in **Platform → Agencies**) or
  `failed` (rejected, with a reason the agency sees).
- The address is used as `From` **only** while `verified`, and that is re-checked at every send:
  the address must still be on the agency's DNS-verified domain, and no other agency may have that
  domain verified. A domain can be verified by only one agency, and changing the agency's domain
  sends the sender back to `pending_domain`.
- Reply-To is the agency's support email only when the sender is verified and the support email
  is on the same verified domain.
- The display name is the agency brand name, never free text, and the SMTP adapter strips CR/LF,
  quotes and angle brackets from it before it reaches a header.

### Before authorizing a sender (platform team, outside the repository)

At the SMTP provider behind production `SMTP_HOST`:

1. Add the agency's domain as a sending domain (or verify the sender address) with the provider.
2. Have the agency publish the SPF include and DKIM records the provider gives, and a DMARC policy.
3. Confirm the provider shows the domain as verified, and send one test message from it.
4. Only then press **Authorize** in Platform → Agencies.

If the provider can't send for arbitrary customer domains, reject the request with that reason —
branded emails keep working from the platform address.

## Custom domains (restaurant storefronts)

This reuses the existing restaurant custom-domain system end to end (`DomainMapping`,
`domain.controller.ts`, `customDomain.service.ts`, Caddy on-demand TLS — see
`docs/custom-domains-operations.md`). Agency admins can already operate a client location's
domain: the location domain routes use `requireTenantPermission("restaurant.settings.manage")`,
which agency owners/admins hold for their clients' locations.

The white-label status adds one live check the domain system didn't do: a CNAME lookup for each
served hostname (`DnsVerifier.resolveCname`). A hostname behind CNAME flattening or a proxy that
returns A records will read as "DNS not pointing here yet" even if traffic works — a known
limitation; the domain itself keeps being served.

The agency's **own** verified domain (Agency settings) is ownership-only: it authorizes a custom
email sender. It does not route any customer traffic — see `docs/agency-white-label-domain.md`.

## Public data

The storefront response (`GET /restaurants/by-slug/:slug`, `/by-domain/:hostname`) carries only
`whiteLabelBrand` (brand name, https logo, hex color, three booleans) and `supportIdentity`
(name, and the support email/URL only under `support_branding`). It never includes the agency's
internal name, contact email, domain, verification token, sender settings, offerings or members.

## Not built (and shown as such)

- Agency-domain routing — e.g. an agency portal or client subdomains on the agency's own domain.
  Each client's storefront domain is configured per location instead.
- A branded operator (restaurant staff / agency) sign-in. Only customer sign-in is branded.
- Provider-API sender verification. If the production SMTP provider offers a domain API, it can
  replace the manual authorization step behind the same `emailSender.status` field.

## Deployment checklist (none of this is done by the code)

- `CUSTOM_DOMAIN_CNAME_TARGET` must be set in production for `custom_domain`/`branded_login` to
  ever become active (the Phase 86 Caddy setup already sets it).
- `DNS_VERIFIER=node` in production, so domain ownership and CNAME checks are real.
- Custom senders: provider-side domain setup as described above, per agency.
- No migration is needed: every new field is optional, and existing agencies/businesses read as
  white-label off.
