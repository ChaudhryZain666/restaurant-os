# Agency White-Label Rollout

## Current scope: persisted agency brand settings

This phase adds the first configuration layer to the existing agency model:

- `brandName`: public-facing name, independent of the agency's internal name.
- `brandPrimaryColor`: optional six-digit hex color.
- `logo`: optional logo URL (existing Agency field, now editable in settings).
- `whiteLabelEnabled`: explicit opt-in flag; defaults to `false` for existing and newly created agencies.

The agency owner can edit these values under Agency settings. The API validates the color and name and persists changes through the existing permission-protected `PATCH /agencies/:agencyId` route.

**Important:** saving these settings does not yet rebrand customer-facing pages. The toggle is configuration only until the later integration phases below are implemented. Do not market the platform as fully white-labelled based on this phase alone.

## Optional agency defaults and per-client choices

White-labeling is deliberately opt-in. `whiteLabelEnabled` defaults to false, and `whiteLabelOfferings` defaults to an empty list. The agency owner chooses which capabilities it offers in Agency Settings.

For each managed business, the agency can select a subset of those offered capabilities in the client's detail page. The API enforces all three boundaries:

- white-label mode must be enabled for the agency before any client features can be assigned;
- a client can only be assigned capabilities included in the agency's offering list;
- the endpoint is scoped to the agency/business pair and requires `agency.businesses.manage`, with audit logging.

This is a configuration and permission layer. A selected option does not imply its customer-facing integration is complete: storefront branding, email sender setup, branded login, and agency-level domain routing still require the relevant follow-up work below. If white-label is off, the normal GarnishTable experience remains the intended fallback.

## Required follow-up phases

1. **Customer-facing storefront identity**
   - Resolve the agency attached to a restaurant's Business and expose a minimal, public-safe brand projection only when white-label mode is enabled.
   - Keep the restaurant's own identity, theme, menu, pricing, and location settings separate from the agency's platform identity.
   - Apply agency branding consistently to storefront chrome, customer support identity, and customer-facing system copy without leaking internal agency data.
2. **Agency custom-domain routing**
   - Extend hostname resolution deliberately: today restaurant custom domains map to a single location, while an agency domain is only ownership-verified.
   - Define whether an agency domain serves a branded agency portal, redirects to a location, or acts as a domain namespace for location subdomains before implementing routing.
   - Preserve existing restaurant custom-domain behavior and certificate issuance safeguards.
3. **Agency-branded authentication and onboarding**
   - Decide the supported branded login/signup flow, tenant selection, invitation copy, password reset copy, cookie/CORS boundaries, and account recovery behavior.
   - Never claim email is sent from an agency domain unless the sending provider has verified that domain and the actual sending identity is configured.
4. **Transactional email**
   - Add an explicit per-agency brand context to applicable templates.
   - Keep sender identity controlled by a provider-backed verified configuration; do not set arbitrary `From` addresses from user input.
5. **Isolation and regression coverage**
   - Add tests proving one agency's settings cannot affect another agency or an unrelated restaurant.
   - Cover unset/disabled settings, invalid colors, public response field allowlists, domain collisions, and fallback to existing GarnishTable behavior.
   - Run API/admin/web builds and targeted E2E tests before merging or deploying.

## Safety boundaries

- No production environment variables, DNS records, email provider configuration, database migrations, or deployment settings are changed by this phase.
- Existing agency data remains valid because all new fields are optional and the toggle defaults off.
- Keep this work on a feature branch until CI and a review of the full customer-facing integration are complete.


## Runtime integration status (branch: feat/agency-white-label-runtime)

The runtime branch now adds a safe, public-only agency brand projection to the existing restaurant slug and restaurant custom-domain responses. It resolves the restaurant's Business and active Agency, then requires agency white-label mode plus the intersection of agency offerings and that client's selected features. It does not expose contact email, verification tokens, membership, or internal agency fields.

Implemented in this branch:
- Branded support identity when `support_branding` is both offered and selected.
- Agency primary color when `storefront_branding` is both offered and selected.
- Footer platform-credit suppression when `hide_platform_branding` is offered and selected.
- Agency name/logo/color on the customer login screen when `branded_login` is offered and selected and the restaurant resolves on an active restaurant custom domain.
- Client configuration UI labels pending capabilities and does not save `email_branding` or `custom_domain` as active client features.

Still not implemented / not active:
- Full agency logo/name integration throughout all storefront themes and SEO metadata.
- Agency-owned domain routing. The existing agency domain flow proves DNS ownership only; it does not route customer traffic.
- Per-agency transactional email templates and sender identities, provider-side sender/domain verification, and delivery/readiness status.
- Global suppression audit across every customer-facing surface.

### Transactional email provider inspection

The repository supports `EMAIL_PROVIDER=console` (default) and `EMAIL_PROVIDER=smtp`. SMTP requires `SMTP_HOST`, `SMTP_PORT`, and `EMAIL_FROM`; optional credentials use `SMTP_USER` and `SMTP_PASSWORD`. The source default is console, which logs email rather than delivering it. The production process environment is not readable through the GitHub repository connector, so this branch does not assume SMTP is configured live and does not change deployment secrets. Generic SMTP does not provide a provider API for sender-domain verification; email branding stays pending until the live configured sender and a verifiable per-agency sender setup are established.

No deployment, DNS, live sender configuration, or production secret was changed. Build/test verification is still required before merging.
