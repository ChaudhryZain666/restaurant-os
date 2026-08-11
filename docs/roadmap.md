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
tracking, digital/printable/PDF receipts, the agency/partner commission system, SEO
(indexable pages, structured data, sitemaps), the full theme/branding system, a generic website
builder, and payments processing. The storefront's component structure is kept reusable and
configuration-driven specifically so the future theme system doesn't require a rewrite.

## Suggested next phase

With ordering, menu management, and day-to-day restaurant operations now solid, reasonable
Phase 3 candidates are: (1) payments (the biggest remaining gap between this and a restaurant
actually being able to use it commercially), (2) real business-hours enforcement + scheduled
ordering, or (3) self-service restaurant onboarding. Recommend deciding explicitly rather than
drifting into more than one at once.
