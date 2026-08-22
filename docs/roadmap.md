# Roadmap

## Phase 0 — Foundation (complete)

Multi-tenant data model, RBAC, versioned API with a consistent response envelope, Swagger docs,
structured logging, BullMQ + Socket.IO + storage foundations, Docker dev environment, test
setup, lint/format config, docs. Explicitly *not* built: full menu/product management UI, cart,
checkout UI beyond what already existed, the full order engine, payments, delivery, promotions,
AI features, WhatsApp, analytics dashboards, subscription billing, white-labeling.

## Phase 1 — Core restaurant & ordering foundation (complete)

Category + ModifierGroup models, restaurant settings (address/contact/business hours/tax/
delivery fee), real menu management UI in `apps/admin`, server-authoritative order pricing,
atomic per-restaurant order numbers, an explicit order status state machine, storefront category
browsing + modifier selection + checkout, tenant isolation and price-manipulation tests
end-to-end. See `docs/post-phase-0-audit.md` for the audit that preceded it and the follow-up
audit (test-pollution fix, Redis/Jest teardown race, minSelect/maxSelect validation, Playwright
auth-refresh flakiness) that followed it.

## Phase 2 — Restaurant operations & production foundation (complete)

Restaurant "temporarily paused" ordering toggle with a computed availability status (open/
closed/paused) surfaced on the storefront; customer self-service order cancellation (pending
orders only); manual payment-status tracking for staff; customer contact info surfaced on
staff-facing order views; a staff-only endpoint for the full menu item list (fixed a real Phase 1
gap where hiding an item made it disappear from the admin's own management screen with no way to
show it again); category/item sort-order and active/inactive controls in `apps/admin`; a
restaurant settings UI covering address, business hours, and the pause toggle. Deliberately did
NOT touch business-hours-based order blocking (kept informational/display-only, to avoid making
order availability depend on wall-clock time — see `computeAvailability`'s doc comment), and did
not add an E2E test that mutates the shared demo-restaurant's availability flags (covered at the
Jest level instead, to avoid racing the other E2E specs' order-placement flows against the same
shared fixture).

## Known Phase 0 simplifications (carried forward on purpose, not oversights)

- **Storefront serves one hardcoded restaurant** (`apps/web`'s `RestaurantContext` resolves a
  restaurant by a fixed slug from `VITE_RESTAURANT_SLUG`). Real multi-restaurant storefront
  routing — custom domains, `restaurant.platform.com/menu`-style paths, or a restaurant picker —
  is Phase 1+ work; building it now would be UI work ahead of the business logic that needs it.
- **No self-service restaurant onboarding.** `platform_admin` creates restaurants and assigns
  owners manually via the API. A real onboarding flow (signup → restaurant creation → owner
  role granted automatically) is future work.
- **`apps/admin` is routing + role-gating only** — every page is a placeholder. Building real
  dashboard UI before the underlying data model (categories, products, modifiers, delivery
  zones, promotions, staff invites) exists would mean building it twice.
- **BullMQ and Socket.IO are proven-working infrastructure, not features.** One demo job, no
  business events. They get used as each feature that needs async work or real-time push is
  actually built.
- **File storage is configured but unused** — no feature needs uploads yet (menu items still use
  a plain `imageUrl` string).

## Known Phase 1/2 simplifications (carried forward on purpose, not oversights)

- **Storefront still serves one hardcoded restaurant** (`VITE_RESTAURANT_SLUG`). Real
  multi-restaurant storefront routing is still future work.
- **No self-service restaurant onboarding.** `platform_admin` still creates restaurants and
  assigns owners manually via the API.
- **Business hours are stored and editable but not enforced.** `computeAvailability` only
  considers `orderingEnabled` and `temporarilyPaused` — a restaurant can still accept orders
  outside its configured hours. Layering in real hours-based enforcement is future work (it
  needs timezone handling and a real "closes in N minutes" UX, not just a boolean check).
- **`platform_admin` cannot manage an individual restaurant's menu/orders/settings** even though
  `requireTenantMatch` exempts it — `ROLE_PERMISSIONS.platform_admin` doesn't grant any
  `restaurant.*` permission. Documented since the Phase 0 audit, still not fixed (would need a
  deliberate decision about whether platform admins should have blanket restaurant access or an
  explicit impersonation/support-access flow).

## Future roadmap (explicitly out of scope until named otherwise)

Customer mobile app, restaurant tablet app (KDS/printer integration), live GPS delivery
tracking, digital/printable/PDF receipts, the agency/partner commission system, the full
theme/branding system, a generic website builder, payments processing beyond the current mock
provider, billing/subscriptions, commissions/payouts, multi-location, full white-label, and custom
domain implementation. The storefront's component structure is kept reusable and
configuration-driven specifically so the future theme system doesn't require a rewrite.

**SEO is no longer fully in this list** — see `docs/multi-tenant-storefront-architecture.md`'s SEO
section: sitemap, robots.txt, canonical URLs, Twitter Cards, and Restaurant/Menu JSON-LD
structured data now exist (Phase 10/12). What remains genuinely out of scope: true SSR/
prerendering (documented there as a next-phase architectural decision, not attempted — the current
client-side-injected metadata works for JS-executing crawlers like Google but not
non-JS-executing ones like most social-link-preview bots).

## Phases 3–11 (see individual architecture docs, not fully backfilled here)

This file stopped being updated per-phase after Phase 2; later phases are documented in their own
focused docs instead (`docs/delivery-architecture.md`, `docs/qr-dine-in-architecture.md`,
`docs/multi-tenant-storefront-architecture.md`, `docs/payment-provider-decision.md`,
`docs/authentication.md`) rather than backfilled here retroactively.

## Phase 12 — Scalability, authorization architecture & production completeness (complete)

Shared server-side pagination/filter/sort convention (see
`docs/pagination-and-rbac-architecture.md`), applied to customer order history, a new real
backend-aggregated admin Customers endpoint (replacing the old fetch-everything-and-group
client-side version), platform Restaurants, platform Users, and the audit log. Frontend RBAC
(route guards + nav visibility in `apps/admin`) now derives from the same `ROLE_PERMISSIONS`
table the backend enforces instead of hand-maintained role arrays; closed a real gap where
`restaurant_staff` saw interactive menu-editing controls that always 403'd on click. Customer
self-service account security: password change, two-step email change (verification link to the
new address), and account deletion (customer role only — anonymization, not hard deletion;
restaurant-scoped roles are explicitly refused pending a product decision on ownership/staffing —
see below). A real restaurant-wide audit log page (backend already existed; this phase built the
first UI for it). SEO: JSON-LD structured data, Twitter Cards, and a generalized `noindex` hook
applied to every private page (previously only one QR route had a noindex tag; everything else
relied on `robots.txt` alone, which stops crawling but not indexing of a linked-but-disallowed
URL).

**Still open, deliberately not decided in this phase:**
- `platform_admin` still cannot manage an individual restaurant's menu/orders/settings (see the
  Phase 1/2 simplification above — unchanged).
- What happens when a `restaurant_owner`/staff account wants to delete itself (restaurant
  ownership transfer, staff removal) — refused outright with a clear message rather than guessed
  at; needs a product decision on data retention/ownership transfer before it's safe to implement.
- True SSR/prerendering for non-JS-executing crawlers (see the SEO section referenced above).

## Suggested next phase

With scalability (pagination), authorization architecture (permission-derived RBAC), and account
self-service now solid, reasonable next candidates are: (1) the SEO SSR/prerendering decision
(framework migration vs. a bot-detecting edge function), (2) operational maturity (notification
preferences, platform-admin UX), or (3) the product decisions flagged above and in
`docs/commercial-decisions.md` (restaurant discovery, platform-admin support access, custom
domains, multi-location, billing). Recommend deciding explicitly rather than drifting into more
than one at once.
