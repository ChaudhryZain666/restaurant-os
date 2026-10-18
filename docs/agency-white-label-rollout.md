# Agency White-Label Rollout

## Current scope: persisted agency brand settings

This phase adds the first configuration layer to the existing agency model:

- `brandName`: public-facing name, independent of the agency's internal name.
- `brandPrimaryColor`: optional six-digit hex color.
- `logo`: optional logo URL (existing Agency field, now editable in settings).
- `whiteLabelEnabled`: explicit opt-in flag; defaults to `false` for existing and newly created agencies.

The agency owner can edit these values under Agency settings. The API validates the color and name and persists changes through the existing permission-protected `PATCH /agencies/:agencyId` route.

**Important:** saving these settings does not yet rebrand customer-facing pages. The toggle is configuration only until the later integration phases below are implemented. Do not market the platform as fully white-labelled based on this phase alone.

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
